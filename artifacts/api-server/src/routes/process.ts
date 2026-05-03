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

const router = Router();

// POST /api/process/preview — no auth required
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

// POST /api/process — no auth required (Drive upload skipped when not connected)
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
  addLog("process", "info", `Starting process job [${jobId}]: ${videos.length} video(s) + "${audio.title}"`);
  res.json({ jobId, message: "Processing started", status: "started" });

  (async () => {
    const settings = getSettings();
    const tokens = getSessionTokens(req);
    const tmpDir = path.join(os.tmpdir(), `process_${jobId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const auth = tokens ? createAuthenticatedClient(tokens) : null;

    // Download videos (from Drive if connected, else use local path)
    const videoPaths: string[] = [];
    for (const video of videos) {
      const dest = path.join(tmpDir, video.filename);
      if (auth && !video.driveId.startsWith("/")) {
        await downloadFromDrive(auth, video.driveId, dest);
      } else {
        fs.copyFileSync(video.driveId, dest);
      }
      videoPaths.push(dest);
    }

    // Download audio
    const audioDest = path.join(tmpDir, "audio.mp3");
    if (auth && !audio.driveId.startsWith("/")) {
      await downloadFromDrive(auth, audio.driveId, audioDest);
    } else {
      fs.copyFileSync(audio.driveId, audioDest);
    }

    // Merge
    const outputPath = path.join(tmpDir, `output_${jobId}.mp4`);
    await mergeVideoWithAudio(videoPaths, audioDest, outputPath);

    // Upload output to Drive if connected, else keep local
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

    addLog("process", "success", `Processing complete: "${audio.title}"`);

    try {
      for (const p of videoPaths) fs.unlinkSync(p);
      fs.unlinkSync(audioDest);
      if (outputDriveLink) fs.unlinkSync(outputPath);
    } catch {}
  })().catch((err) => {
    addLog("process", "error", `Process job failed [${jobId}]`, String(err));
  });
});

export default router;
