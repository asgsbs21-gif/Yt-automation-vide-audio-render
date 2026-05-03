import { Router } from "express";
import os from "os";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import {
  getAudios,
  getRandomUnusedAudio,
  pickVideosForDuration,
  pickAdditionalVideos,
  markVideosUsed,
  markAudioUsed,
  addQueueItem,
  addLog,
  getSettings,
  type Video,
} from "../services/data.js";
import { mergeVideoWithAudio, getVideoDuration, extractThumbnail } from "../services/ffmpeg.js";
import { composeThumbnailWithText } from "../services/thumbnail.js";
import { downloadFromDrive, uploadFileToDrive } from "../services/drive.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

const OUTPUT_DIR = path.resolve(process.cwd(), "data", "output");
const WATERMARK_PATH = path.resolve(process.cwd(), "data", "watermark.png");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Helper: download a video to tmpDir ───────────────────────────────────────

async function downloadVideoFile(
  video: Video,
  tmpDir: string,
  prefix: string,
  auth: ReturnType<typeof createAuthenticatedClient> | null
): Promise<{ localPath: string; actualDuration: number }> {
  const dest = path.join(tmpDir, `${prefix}_${video.filename}`);
  if (auth && !video.driveId.startsWith("/")) {
    await downloadFromDrive(auth, video.driveId, dest);
  } else {
    fs.copyFileSync(video.driveId, dest);
  }
  const actualDuration = await getVideoDuration(dest);
  return { localPath: dest, actualDuration };
}

// ── POST /api/process/preview ─────────────────────────────────────────────────

router.post("/process/preview", (req, res) => {
  const { audioId, categoryFilter } = req.body as {
    audioId?: string | null;
    categoryFilter?: string | null;
  };

  const audio = audioId
    ? getAudios().find((a) => a.id === audioId) ?? null
    : getRandomUnusedAudio(categoryFilter);

  if (!audio) { res.status(404).json({ error: "No audio available" }); return; }

  const effectiveDuration = (audio.trimEnd ?? audio.duration) - (audio.trimStart ?? 0);
  const videos = pickVideosForDuration(categoryFilter ?? null, effectiveDuration);
  res.json({
    audio,
    videos,
    estimatedDuration: effectiveDuration,
    videoCount: videos.length,
    trimStart: audio.trimStart,
    trimEnd: audio.trimEnd,
  });
});

// ── POST /api/process ─────────────────────────────────────────────────────────

router.post("/process", async (req, res) => {
  const {
    audioId,
    categoryFilter,
    addToQueue = true,
    speedMultiplier,
    normalizeVolume,
    watermarkEnabled,
  } = req.body as {
    audioId?: string | null;
    categoryFilter?: string | null;
    addToQueue?: boolean;
    speedMultiplier?: number;
    normalizeVolume?: boolean;
    watermarkEnabled?: boolean;
  };

  const settings = getSettings();

  const audio = audioId
    ? getAudios().find((a) => a.id === audioId) ?? null
    : getRandomUnusedAudio(categoryFilter);

  if (!audio) { res.status(404).json({ error: "No audio available" }); return; }

  // Effective duration = after trim
  const audioTrimStart = audio.trimStart ?? null;
  const audioTrimEnd = audio.trimEnd ?? null;
  const effectiveAudioDuration = (audioTrimEnd ?? audio.duration) - (audioTrimStart ?? 0);

  const initialVideos = pickVideosForDuration(categoryFilter ?? null, effectiveAudioDuration);
  if (initialVideos.length === 0) {
    res.status(404).json({ error: "No videos available for the selected category" });
    return;
  }

  // Resolve watermark: use request override if provided, otherwise fall back to settings
  const useWatermark =
    (watermarkEnabled !== undefined ? watermarkEnabled : settings.watermarkEnabled) &&
    fs.existsSync(WATERMARK_PATH);

  const finalSpeedMultiplier = speedMultiplier ?? settings.speedMultiplier ?? 1.0;
  const finalNormalizeVolume = normalizeVolume !== undefined ? normalizeVolume : (settings.normalizeVolume ?? false);

  const jobId = uuidv4();
  addLog(
    "process",
    "info",
    `Process [${jobId}]: ${initialVideos.length} clip(s) + "${audio.title}" (${effectiveAudioDuration.toFixed(1)}s, ` +
    `speed=${finalSpeedMultiplier}x, wm=${useWatermark}, loudnorm=${finalNormalizeVolume})`
  );
  res.json({ jobId, message: "Processing started", status: "started" });
  emitJobUpdate({
    jobId, jobType: "process", status: "running",
    message: `Starting: ${initialVideos.length} clip(s) + "${audio.title}"`,
    progress: 2,
  });

  (async () => {
    const tokens = getSessionTokens(req);
    const tmpDir = path.join(os.tmpdir(), `process_${jobId}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const auth = tokens ? createAuthenticatedClient(tokens) : null;

    try {
      // ── Step 1: Download initial video set ──────────────────────────────────
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Downloading video clips…", progress: 5 });

      const videoPaths: string[] = [];
      const usedVideoIds = new Set<string>();
      let totalActualDuration = 0;

      for (let i = 0; i < initialVideos.length; i++) {
        const video = initialVideos[i];
        emitJobUpdate({
          jobId, jobType: "process", status: "running",
          message: `Clip ${i + 1}/${initialVideos.length}: "${video.filename}"…`,
          progress: 5 + Math.round(((i + 1) / initialVideos.length) * 15),
        });
        const { localPath, actualDuration } = await downloadVideoFile(video, tmpDir, `v${i}`, auth);
        videoPaths.push(localPath);
        usedVideoIds.add(video.id);
        totalActualDuration += actualDuration;
        addLog("process", "info", `Clip ${i + 1}: ${video.filename} — ${actualDuration.toFixed(1)}s`);
      }

      // ── Step 2: Supplement if total duration < effective audio duration ──────
      let fillRound = 0;
      const MAX_FILL_ROUNDS = 10;

      while (totalActualDuration < effectiveAudioDuration && fillRound < MAX_FILL_ROUNDS) {
        fillRound++;
        const stillNeeded = effectiveAudioDuration - totalActualDuration;

        const moreVideos = pickAdditionalVideos(categoryFilter ?? null, usedVideoIds, stillNeeded);
        if (moreVideos.length === 0) {
          addLog("process", "warn", `Fill round ${fillRound}: pool exhausted — proceeding with ${totalActualDuration.toFixed(1)}s`);
          break;
        }

        emitJobUpdate({
          jobId, jobType: "process", status: "running",
          message: `Topping up: need ${stillNeeded.toFixed(1)}s more, fetching ${moreVideos.length} extra clip(s)…`,
          progress: 22,
        });

        for (const video of moreVideos) {
          if (totalActualDuration >= effectiveAudioDuration) break;
          const { localPath, actualDuration } = await downloadVideoFile(
            video, tmpDir, `fill${fillRound}_${video.id.slice(0, 8)}`, auth
          );
          videoPaths.push(localPath);
          usedVideoIds.add(video.id);
          totalActualDuration += actualDuration;
          addLog("process", "info", `  + Extra clip: ${video.filename} — ${actualDuration.toFixed(1)}s → total ${totalActualDuration.toFixed(1)}s`);
        }
      }

      addLog("process", "info", `Coverage: ${totalActualDuration.toFixed(1)}s for ${effectiveAudioDuration.toFixed(1)}s (${videoPaths.length} clips)`);
      emitJobUpdate({
        jobId, jobType: "process", status: "running",
        message: `${videoPaths.length} clip(s) ready. Preparing audio…`,
        progress: 25,
      });

      // ── Step 3: Download audio ───────────────────────────────────────────────
      const audioDest = path.join(tmpDir, "audio.mp3");
      if (auth && !audio.driveId.startsWith("/")) {
        await downloadFromDrive(auth, audio.driveId, audioDest);
      } else {
        fs.copyFileSync(audio.driveId, audioDest);
      }

      // ── Step 4: Merge ────────────────────────────────────────────────────────
      emitJobUpdate({
        jobId, jobType: "process", status: "running",
        message: `Merging ${videoPaths.length} clip(s) → ${effectiveAudioDuration.toFixed(1)}s…`,
        progress: 28,
      });

      const outputFilename = `output_${jobId}.mp4`;
      const outputPath = path.join(OUTPUT_DIR, outputFilename);

      await mergeVideoWithAudio(
        videoPaths,
        audioDest,
        outputPath,
        (pct, message) => {
          emitJobUpdate({ jobId, jobType: "process", status: "running", message, progress: 28 + Math.round(pct * 0.62) });
        },
        effectiveAudioDuration,
        {
          watermarkPath: useWatermark ? WATERMARK_PATH : null,
          speedMultiplier: finalSpeedMultiplier,
          normalizeVolume: finalNormalizeVolume,
          audioTrimStart,
          audioTrimEnd,
        }
      );

      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Saving output…", progress: 92 });

      // ── Step 5: Optional thumbnail ────────────────────────────────────────────
      let thumbnailPath: string | null = null;
      if (settings.thumbnailEnabled) {
        const thumbFile = path.join(OUTPUT_DIR, `thumb_${jobId}.jpg`);
        try {
          emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Extracting thumbnail frame…", progress: 93 });
          await extractThumbnail(outputPath, thumbFile);
          thumbnailPath = thumbFile;
          try {
            emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Composing thumbnail…", progress: 94 });
            await composeThumbnailWithText(thumbFile, thumbFile, audio.title, settings.thumbnailBgColor);
          } catch (composeErr) {
            addLog("process", "warn", "Thumbnail text overlay failed — using raw frame", String(composeErr));
          }
        } catch {
          addLog("process", "warn", "Thumbnail extraction failed — continuing without thumbnail");
        }
      }

      // ── Step 6: Optional Drive upload ─────────────────────────────────────────
      const outputFolderId = settings.driveOutputFolderId;
      if (auth && outputFolderId) {
        try {
          await uploadFileToDrive(auth, outputPath, outputFolderId, "video/mp4", outputFilename);
        } catch (e) {
          addLog("process", "warn", "Drive output upload failed (local copy kept)", String(e));
        }
      }

      // ── Step 7: Mark used & add to queue ──────────────────────────────────────
      markVideosUsed([...usedVideoIds]);
      markAudioUsed(audio.id);

      if (addToQueue) {
        addQueueItem({
          jobId,
          driveId: outputPath,
          title: audio.title,
          description: audio.description,
          tags: audio.tags,
          scheduledAt: null,
          status: "pending",
          youtubeUrl: null,
          youtubeId: null,
          error: null,
          thumbnailPath,
        });
      }

      addLog("process", "success", `Complete: "${audio.title}" → ${outputFilename}`);
      emitJobUpdate({ jobId, jobType: "process", status: "done", message: `Done! "${audio.title}" added to queue.`, progress: 100 });

      try {
        for (const p of videoPaths) { try { fs.unlinkSync(p); } catch {} }
        try { fs.unlinkSync(audioDest); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}

    } catch (err) {
      addLog("process", "error", `Process job failed [${jobId}]`, String(err));
      emitJobUpdate({ jobId, jobType: "process", status: "error", message: `Failed: ${String(err).slice(0, 100)}`, progress: 0 });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  })();
});

export default router;
