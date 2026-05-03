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
import { downloadFromDrive, uploadFileToDrive } from "../services/drive.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

const OUTPUT_DIR = path.resolve(process.cwd(), "data", "output");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Helper: download a video to tmpDir and return { localPath, actualDuration } ─

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

  const videos = pickVideosForDuration(categoryFilter ?? null, audio.duration);
  res.json({ audio, videos, estimatedDuration: audio.duration, videoCount: videos.length });
});

// ── POST /api/process ─────────────────────────────────────────────────────────
//
// Core concat logic:
//  1. Pick initial video set using stored durations (pickVideosForDuration).
//  2. Download each to tmpDir and probe actual duration with ffprobe.
//  3. If total actual duration < audio.duration, fetch more unique clips via
//     pickAdditionalVideos and download+probe them.  Repeat up to 10 rounds.
//  4. Pass all video paths + audioDuration to mergeVideoWithAudio which uses
//     -t to hard-trim the output to the exact audio length.

router.post("/process", async (req, res) => {
  const { audioId, categoryFilter, addToQueue = true } = req.body as {
    audioId?: string | null;
    categoryFilter?: string | null;
    addToQueue?: boolean;
  };

  const audio = audioId
    ? getAudios().find((a) => a.id === audioId) ?? null
    : getRandomUnusedAudio(categoryFilter);

  if (!audio) { res.status(404).json({ error: "No audio available" }); return; }

  const initialVideos = pickVideosForDuration(categoryFilter ?? null, audio.duration);
  if (initialVideos.length === 0) {
    res.status(404).json({ error: "No videos available for the selected category" });
    return;
  }

  const jobId = uuidv4();
  addLog("process", "info", `Process job [${jobId}]: ${initialVideos.length} initial clip(s) + "${audio.title}" (${audio.duration.toFixed(1)}s)`);
  res.json({ jobId, message: "Processing started", status: "started" });
  emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Starting: ${initialVideos.length} clip(s) + "${audio.title}"`, progress: 2 });

  (async () => {
    const settings = getSettings();
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
        emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Clip ${i + 1}/${initialVideos.length}: "${video.filename}"…`, progress: 5 + Math.round(((i + 1) / initialVideos.length) * 15) });
        const { localPath, actualDuration } = await downloadVideoFile(video, tmpDir, `v${i}`, auth);
        videoPaths.push(localPath);
        usedVideoIds.add(video.id);
        totalActualDuration += actualDuration;
        addLog("process", "info", `Clip ${i + 1}: ${video.filename} — ${actualDuration.toFixed(1)}s (actual)`);
      }

      // ── Step 2: Supplement if total video duration < audio duration ──────────
      let fillRound = 0;
      const MAX_FILL_ROUNDS = 10;

      while (totalActualDuration < audio.duration && fillRound < MAX_FILL_ROUNDS) {
        fillRound++;
        const stillNeeded = audio.duration - totalActualDuration;

        const moreVideos = pickAdditionalVideos(categoryFilter ?? null, usedVideoIds, stillNeeded);
        if (moreVideos.length === 0) {
          addLog("process", "warn", `Fill round ${fillRound}: pool exhausted — proceeding with ${totalActualDuration.toFixed(1)}s of video for ${audio.duration.toFixed(1)}s audio`);
          break;
        }

        emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Topping up: need ${stillNeeded.toFixed(1)}s more, fetching ${moreVideos.length} extra clip(s)…`, progress: 22 });

        for (const video of moreVideos) {
          if (totalActualDuration >= audio.duration) break;
          const { localPath, actualDuration } = await downloadVideoFile(video, tmpDir, `fill${fillRound}_${video.id.slice(0, 8)}`, auth);
          videoPaths.push(localPath);
          usedVideoIds.add(video.id);
          totalActualDuration += actualDuration;
          addLog("process", "info", `  + Extra clip: ${video.filename} — ${actualDuration.toFixed(1)}s → total ${totalActualDuration.toFixed(1)}s`);
        }
      }

      addLog("process", "info", `Video coverage: ${totalActualDuration.toFixed(1)}s for ${audio.duration.toFixed(1)}s audio using ${videoPaths.length} clip(s)`);
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `${videoPaths.length} clip(s) → ${totalActualDuration.toFixed(1)}s total. Preparing audio…`, progress: 25 });

      // ── Step 3: Download audio ───────────────────────────────────────────────
      const audioDest = path.join(tmpDir, "audio.mp3");
      if (auth && !audio.driveId.startsWith("/")) {
        await downloadFromDrive(auth, audio.driveId, audioDest);
      } else {
        fs.copyFileSync(audio.driveId, audioDest);
      }

      // ── Step 4: Merge ────────────────────────────────────────────────────────
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Merging ${videoPaths.length} clip(s) → trimming to ${audio.duration.toFixed(1)}s…`, progress: 28 });

      const outputFilename = `output_${jobId}.mp4`;
      const outputPath = path.join(OUTPUT_DIR, outputFilename);

      await mergeVideoWithAudio(videoPaths, audioDest, outputPath, (pct, message) => {
        emitJobUpdate({ jobId, jobType: "process", status: "running", message, progress: 28 + Math.round(pct * 0.62) });
      }, audio.duration);

      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Saving output…", progress: 92 });

      // ── Step 5: Optional thumbnail extraction ────────────────────────────────
      let thumbnailPath: string | null = null;
      if (settings.thumbnailEnabled) {
        const thumbFile = path.join(OUTPUT_DIR, `thumb_${jobId}.jpg`);
        try {
          emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Extracting thumbnail frame…", progress: 93 });
          await extractThumbnail(outputPath, thumbFile);
          thumbnailPath = thumbFile;
        } catch {
          addLog("process", "warn", "Thumbnail extraction failed — continuing without thumbnail");
        }
      }

      // ── Step 6: Optional Drive upload ────────────────────────────────────────
      const outputFolderId = settings.driveOutputFolderId;
      if (auth && outputFolderId) {
        try {
          await uploadFileToDrive(auth, outputPath, outputFolderId, "video/mp4", outputFilename);
        } catch (e) {
          addLog("process", "warn", "Drive output upload failed (local copy kept)", String(e));
        }
      }

      // ── Step 7: Mark used & add to queue ─────────────────────────────────────
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

      addLog("process", "success", `Complete: "${audio.title}" → ${outputFilename} (${videoPaths.length} clips, ${totalActualDuration.toFixed(1)}s → trimmed to ${audio.duration.toFixed(1)}s)`);
      emitJobUpdate({ jobId, jobType: "process", status: "done", message: `Done! "${audio.title}" added to queue.`, progress: 100 });

      // Cleanup temp files (not the permanent output)
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
