import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { addLog } from "./data.js";

const SCALE_FILTER =
  "scale=1080:1920:force_original_aspect_ratio=decrease," +
  "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black," +
  "setsar=1";

// ── Probe a video/audio file duration using ffprobe ───────────────────────────

export async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return; }
      resolve(metadata.format.duration ?? 0);
    });
  });
}

// ── Concatenate videos and overlay audio ──────────────────────────────────────
//
// Outputs 9:16 vertical 1080×1920. Video audio is muted; downloaded audio is
// overlaid. The output is trimmed to exactly `audioDuration` seconds so that
// the result matches the audio track length precisely.
//
// Both the single-clip path and the multi-clip concat path apply the same
// scale/pad filter so every clip becomes 1080×1920 before concat.
//
// Parameters:
//   videoPaths    – ordered list of local video file paths (already downloaded)
//   audioPath     – local audio file path
//   outputPath    – where to write the result
//   onProgress    – optional callback for progress updates (0-100, message)
//   audioDuration – exact audio duration in seconds; output is trimmed to this.
//                   When omitted the encode falls back to -shortest (safe but
//                   may be slightly off if container duration is imprecise).

export interface VideoMergeOptions {
  watermarkPath?: string | null;
  speedMultiplier?: number;
  normalizeVolume?: boolean;
  audioTrimStart?: number | null;
  audioTrimEnd?: number | null;
}

export async function mergeVideoWithAudio(
  videoPaths: string[],
  audioPath: string,
  outputPath: string,
  onProgress?: (progress: number, message: string) => void,
  audioDuration?: number,
  opts: VideoMergeOptions = {}
): Promise<string> {
  if (videoPaths.length === 0) throw new Error("No video paths provided to mergeVideoWithAudio");

  const {
    watermarkPath = null,
    speedMultiplier = 1.0,
    normalizeVolume = false,
    audioTrimStart = null,
    audioTrimEnd = null,
  } = opts;

  const hasWatermark = !!(watermarkPath && fs.existsSync(watermarkPath));
  const hasSpeed = speedMultiplier > 1.0 && speedMultiplier <= 4.0;
  const n = videoPaths.length;

  addLog(
    "process",
    "info",
    `Merging ${n} clip(s) with audio (target ${audioDuration?.toFixed(1) ?? "?"}s, ` +
    `speed=${speedMultiplier}x, watermark=${hasWatermark}, loudnorm=${normalizeVolume})`
  );
  onProgress?.(5, `Setting up FFmpeg pipeline (${n} clip(s))…`);

  // Per-clip video filter: optional speed + scale/pad to 1080×1920
  const speedPart = hasSpeed ? `setpts=PTS/${speedMultiplier},` : "";
  const clipVideoFilter = `${speedPart}${SCALE_FILTER}`;

  const audioIdx = n;           // audio input index
  const wmIdx = n + 1;          // watermark input index (only when hasWatermark)

  const trimOpts =
    audioDuration && audioDuration > 0
      ? [`-t ${audioDuration.toFixed(3)}`]
      : ["-shortest"];

  const codecOpts = [
    `-c:v libx264`,
    `-preset fast`,
    `-crf 23`,
    `-c:a aac`,
    `-b:a 128k`,
    ...trimOpts,
    `-movflags +faststart`,
    `-avoid_negative_ts make_zero`,
  ];

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    for (const vp of videoPaths) cmd.input(vp);
    cmd.input(audioPath);
    if (hasWatermark) cmd.input(watermarkPath!);

    if (n === 1 && !hasWatermark) {
      // ── Simplest path: single clip, no watermark — use -vf ─────────────────
      cmd.outputOptions([
        `-vf ${clipVideoFilter}`,
        `-map 0:v:0`,
        `-map ${audioIdx}:a:0`,
        ...codecOpts,
      ]);
    } else {
      // ── Complex filter path (multi-clip or watermark) ─────────────────────
      let filterComplex: string;

      if (n === 1) {
        // Single clip + watermark
        filterComplex =
          `[0:v]${clipVideoFilter}[scaled];` +
          `[scaled][${wmIdx}:v]overlay=W-w-20:H-h-20:alpha=0.7[outv]`;
      } else if (!hasWatermark) {
        // Multi-clip, no watermark
        const scaleFilters = videoPaths.map((_, i) => `[${i}:v]${clipVideoFilter}[v${i}]`).join(";");
        const labels = videoPaths.map((_, i) => `[v${i}]`).join("");
        filterComplex = `${scaleFilters};${labels}concat=n=${n}:v=1:a=0[outv]`;
      } else {
        // Multi-clip + watermark
        const scaleFilters = videoPaths.map((_, i) => `[${i}:v]${clipVideoFilter}[v${i}]`).join(";");
        const labels = videoPaths.map((_, i) => `[v${i}]`).join("");
        filterComplex =
          `${scaleFilters};` +
          `${labels}concat=n=${n}:v=1:a=0[concatv];` +
          `[concatv][${wmIdx}:v]overlay=W-w-20:H-h-20:alpha=0.7[outv]`;
      }

      cmd.complexFilter(filterComplex).outputOptions([
        `-map [outv]`,
        `-map ${audioIdx}:a:0`,
        ...codecOpts,
      ]);
    }

    // ── Audio filters: trim + loudnorm ─────────────────────────────────────
    const audioFilters: string[] = [];
    if (audioTrimStart != null || audioTrimEnd != null) {
      const parts: string[] = [];
      if (audioTrimStart != null) parts.push(`start=${audioTrimStart}`);
      if (audioTrimEnd != null) parts.push(`end=${audioTrimEnd}`);
      audioFilters.push(`atrim=${parts.join(":")}`);
      audioFilters.push("asetpts=PTS-STARTPTS");
    }
    if (normalizeVolume) audioFilters.push("loudnorm");
    if (audioFilters.length > 0) cmd.audioFilters(audioFilters);

    cmd
      .output(outputPath)
      .on("start", (cmdLine: string) => {
        addLog("process", "info", "FFmpeg started", cmdLine.slice(0, 400));
        onProgress?.(10, "FFmpeg encoding started…");
      })
      .on("progress", (p: { percent?: number; timemark?: string }) => {
        const pct = Math.min(95, 10 + Math.round((p.percent ?? 0) * 0.85));
        onProgress?.(pct, `Encoding… ${p.percent?.toFixed(1) ?? "?"}% (${p.timemark ?? ""})`);
      })
      .on("end", () => {
        addLog("process", "success", `Merge complete → ${path.basename(outputPath)}`);
        onProgress?.(100, "Done!");
        resolve(outputPath);
      })
      .on("error", (err: Error, _stdout: string, stderr: string) => {
        addLog("process", "error", "FFmpeg error", stderr?.slice(-800) || err.message);
        reject(err);
      })
      .run();
  });
}

// ── Extract a thumbnail frame at 30% of video duration ────────────────────────
//
// Probes the duration first, then seeks to 30% and extracts one JPEG frame.
// The output quality is controlled by -q:v 2 (highest JPEG quality in FFmpeg).

export async function extractThumbnail(
  videoPath: string,
  outputPath: string
): Promise<void> {
  const duration = await getVideoDuration(videoPath);
  const seekTime = duration > 0 ? duration * 0.3 : 5;

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(seekTime)
      .outputOptions(["-vframes 1", "-q:v 2"])
      .output(outputPath)
      .on("end", () => {
        addLog("process", "info", `Thumbnail extracted → ${path.basename(outputPath)}`);
        resolve();
      })
      .on("error", (err: Error) => {
        addLog("process", "warn", "Thumbnail extraction failed (non-fatal)", err.message);
        reject(err);
      })
      .run();
  });
}

// ── Mute a video (strip audio stream, stream-copy video — fast, no re-encode) ─

export async function muteVideo(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: number, message: string) => void
): Promise<string> {
  addLog("process", "info", `Muting audio: ${path.basename(inputPath)}`);
  onProgress?.(5, "Stripping audio track…");

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v copy",
        "-an",
        "-movflags +faststart",
      ])
      .output(outputPath)
      .on("start", (cmdLine: string) => {
        addLog("process", "info", "FFmpeg mute started", cmdLine.slice(0, 200));
        onProgress?.(20, "Removing audio stream…");
      })
      .on("progress", (p: { percent?: number; timemark?: string }) => {
        const pct = Math.min(90, 20 + Math.round((p.percent ?? 0) * 0.7));
        onProgress?.(pct, `Muting… ${p.timemark ?? ""}`);
      })
      .on("end", () => {
        addLog("process", "success", `Muted → ${path.basename(outputPath)}`);
        onProgress?.(100, "Muted successfully");
        resolve(outputPath);
      })
      .on("error", (err: Error, _stdout: string, stderr: string) => {
        addLog("process", "error", "FFmpeg mute error", stderr?.slice(-400) || err.message);
        reject(err);
      })
      .run();
  });
}
