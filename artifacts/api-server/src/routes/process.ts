import { Router } from "express";
import os from "os";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import {
  getAudios,
  getRandomUnusedAudio,
  pickVideosForDuration,
  markVideosUsed,
  markAudioUsed,
  addQueueItem,
  addLog,
  getSettings,
} from "../services/data.js";
import { mergeVideoWithAudio } from "../services/ffmpeg.js";
import { downloadFromDrive, uploadFileToDrive } from "../services/drive.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

// POST /api/process/preview
router.post("/process/preview", (req, res) => {
  const { audioId, categoryFilter } = req.body as {
    audioId?: string | null;
    categoryFilter?: string | null;
  };

  const audio = audioId
    ? getAudios().find((a) => a.id === audioId) ?? null
    : getRandomUnusedAudio(categoryFilter);

  if (!audio) {
    res.status(404).json({ error: "No audio available" });
    return;
  }

  const videos = pickVideosForDuration(categoryFilter ?? null, audio.duration);

  res.json({
    audio,
    videos,
    estimatedDuration: audio.duration,
    videoCount: videos.length,
  });
});

// POST /api/process
router.post("/process", async (req, res) => {
  const { audioId, categoryFilter, addToQueue = true } = req.body as {
    audioId?: string | null;
    categoryFilter?: string | null;
    addToQueue?: boolean;
  };

  const audios = getAudios();
  const audio = audioId
    ? audios.find((a) => a.id === audioId) ?? null
    : getRandomUnusedAudio(categoryFilter);

  if (!audio) {
    res.status(404).json({ error: "No audio available" });
    return;
  }

  const videos = pickVideosForDuration(categoryFilter ?? null, audio.duration);
  if (videos.length === 0) {
    res.status(404).json({ error: "No videos available for the selected category" });
    return;
  }

  const jobId = uuidv4();
  addLog("process", "info", `Process job [${jobId}]: ${videos.length} clip(s) + "${audio.title}"`);
  res.json({ jobId, message: "Processing started", status: "started" });

  emitJobUpdate({
    jobId,
    jobType: "process",
    status: "running",
    message: `Starting: ${videos.length} clip(s) + "${audio.title}"`,
    progress: 2,
  });

  (async () => {
    const settings = getSettings();
    const tokens = getSessionTokens(req);
    const tmpDir = path.join(os.tmpdir(), `process_${jobId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const auth = tokens ? createAuthenticatedClient(tokens) : null;

    try {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Preparing video clips…", progress: 5 });

      const videoPaths: string[] = [];
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const dest = path.join(tmpDir, video.filename);
        if (auth && !video.driveId.startsWith("/")) {
          await downloadFromDrive(auth, video.driveId, dest);
        } else {
          fs.copyFileSync(video.driveId, dest);
        }
        videoPaths.push(dest);
        emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Prepared clip ${i + 1}/${videos.length}`, progress: 5 + Math.round(((i + 1) / videos.length) * 15) });
      }

      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Preparing audio…", progress: 22 });

      const audioDest = path.join(tmpDir, "audio.mp3");
      if (auth && !audio.driveId.startsWith("/")) {
        await downloadFromDrive(auth, audio.driveId, audioDest);
      } else {
        fs.copyFileSync(audio.driveId, audioDest);
      }

      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Merging with FFmpeg…", progress: 25 });

      const outputPath = path.join(tmpDir, `output_${jobId}.mp4`);
      await mergeVideoWithAudio(videoPaths, audioDest, outputPath, (pct, message) => {
        emitJobUpdate({
          jobId,
          jobType: "process",
          status: "running",
          message,
          progress: 25 + Math.round(pct * 0.65),
        });
      });

      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Saving output…", progress: 92 });

      let outputDriveId = outputPath;
      let outputDriveLink: string | null = null;
      const outputFolderId = settings.driveOutputFolderId;

      if (auth && outputFolderId) {
        const driveFile = await uploadFileToDrive(
          auth, outputPath, outputFolderId, "video/mp4", `output_${jobId}.mp4`
        );
        outputDriveId = driveFile.id;
        outputDriveLink = driveFile.webViewLink;
      }

      markVideosUsed(videos.map((v) => v.id));
      markAudioUsed(audio.id);

      if (addToQueue) {
        addQueueItem({
          driveId: outputDriveId,
          title: audio.title,
          description: audio.description,
          tags: audio.tags,
          scheduledAt: null,
          status: "pending",
          youtubeUrl: null,
          youtubeId: null,
          error: null,
        });
      }

      addLog("process", "success", `Complete: "${audio.title}"`);
      emitJobUpdate({ jobId, jobType: "process", status: "done", message: `Done! "${audio.title}" added to queue.`, progress: 100 });

      try {
        for (const p of videoPaths) fs.unlinkSync(p);
        fs.unlinkSync(audioDest);
        if (outputDriveLink) fs.unlinkSync(outputPath);
      } catch {}
    } catch (err) {
      addLog("process", "error", `Process job failed [${jobId}]`, String(err));
      emitJobUpdate({ jobId, jobType: "process", status: "error", message: `Failed: ${String(err).slice(0, 100)}`, progress: 0 });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  })();
});

export default router;
