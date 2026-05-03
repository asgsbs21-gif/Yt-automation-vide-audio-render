import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { addLog } from "./data.js";

const SCALE_FILTER =
  "scale=1080:1920:force_original_aspect_ratio=decrease," +
  "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black," +
  "setsar=1";

// ── Concatenate videos and overlay audio ─────────────────────────────────────
//
// Output: 9:16 vertical 1080×1920, original video audio muted,
// downloaded audio overlaid, trimmed to audio length.

export async function mergeVideoWithAudio(
  videoPaths: string[],
  audioPath: string,
  outputPath: string,
  onProgress?: (progress: number, message: string) => void
): Promise<string> {
  addLog("process", "info", `Merging ${videoPaths.length} clip(s) with audio…`);
  onProgress?.(5, `Setting up FFmpeg pipeline (${videoPaths.length} clips)…`);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    for (const vp of videoPaths) cmd.input(vp);
    cmd.input(audioPath);

    const n = videoPaths.length;
    const audioIdx = n;

    if (n === 1) {
      cmd.outputOptions([
        `-vf ${SCALE_FILTER}`,
        `-map 0:v:0`,
        `-map ${audioIdx}:a:0`,
        `-c:v libx264`,
        `-preset fast`,
        `-crf 23`,
        `-c:a aac`,
        `-b:a 128k`,
        `-shortest`,
        `-movflags +faststart`,
        `-avoid_negative_ts make_zero`,
      ]);
    } else {
      const videoInputs = videoPaths.map((_, i) => `[${i}:v]`).join("");
      const filterComplex =
        `${videoInputs}concat=n=${n}:v=1:a=0[concatv];` +
        `[concatv]${SCALE_FILTER}[outv]`;

      cmd
        .complexFilter(filterComplex)
        .outputOptions([
          `-map [outv]`,
          `-map ${audioIdx}:a:0`,
          `-c:v libx264`,
          `-preset fast`,
          `-crf 23`,
          `-c:a aac`,
          `-b:a 128k`,
          `-shortest`,
          `-movflags +faststart`,
          `-avoid_negative_ts make_zero`,
        ]);
    }

    cmd
      .output(outputPath)
      .on("start", (cmdLine: string) => {
        addLog("process", "info", `FFmpeg started`, cmdLine.slice(0, 300));
        onProgress?.(10, "FFmpeg encoding started…");
      })
      .on("progress", (p: { percent?: number; timemark?: string }) => {
        const pct = Math.min(95, 10 + Math.round((p.percent ?? 0) * 0.85));
        const msg = `Encoding… ${p.percent?.toFixed(1) ?? "?"}% (${p.timemark ?? ""})`;
        onProgress?.(pct, msg);
      })
      .on("end", () => {
        addLog("process", "success", `Merge complete → ${path.basename(outputPath)}`);
        onProgress?.(100, "Done!");
        resolve(outputPath);
      })
      .on("error", (err: Error, _stdout: string, stderr: string) => {
        addLog("process", "error", "FFmpeg error", stderr?.slice(-500) || err.message);
        reject(err);
      })
      .run();
  });
}

// ── Get video duration using ffprobe ─────────────────────────────────────────

export async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return; }
      resolve(metadata.format.duration ?? 0);
    });
  });
}
