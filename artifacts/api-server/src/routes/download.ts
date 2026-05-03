import { Router } from "express";
import os from "os";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { addVideo, addAudio, addLog, getSettings } from "../services/data.js";
import { downloadKuaishouVideo } from "../services/kuaishou.js";
import { downloadAudio } from "../services/ytdlp.js";
import { uploadFileToDrive } from "../services/drive.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { requireAuth, getSessionTokens } from "../middlewares/auth.js";

const router = Router();

// POST /api/download/video
router.post("/download/video", requireAuth, async (req, res) => {
  const { urls, category } = req.body as {
    urls: string[];
    category: string;
  };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const jobId = uuidv4();
  addLog("download_video", "info", `Starting ${urls.length} video download(s) [job ${jobId}]`);
  res.json({ jobId, message: `Started ${urls.length} download job(s)`, status: "started" });

  // Run downloads in background
  (async () => {
    const settings = getSettings();
    const tokens = getSessionTokens(req);

    for (const url of urls) {
      let retries = 0;
      const maxRetries = settings.maxRetries || 3;

      while (retries < maxRetries) {
        try {
          const tmpDir = path.join(os.tmpdir(), `kuaishou_${uuidv4()}`);
          fs.mkdirSync(tmpDir, { recursive: true });

          const filename = `video_${Date.now()}.mp4`;
          const tmpPath = await downloadKuaishouVideo(url, tmpDir, filename);

          if (!tmpPath) {
            retries++;
            continue;
          }

          // Upload to Drive if folder configured
          const folderId = settings.driveVideoFolderId;
          if (folderId && tokens) {
            const auth = createAuthenticatedClient(tokens);
            const driveFile = await uploadFileToDrive(
              auth,
              tmpPath,
              folderId,
              "video/mp4",
              filename
            );
            addVideo({
              driveId: driveFile.id,
              filename,
              category,
              usedCount: 0,
              lastUsed: null,
              available: true,
              driveLink: driveFile.webViewLink,
              status: "available",
            });
          } else {
            // Store locally if no Drive configured
            addVideo({
              driveId: tmpPath, // use local path as ID
              filename,
              category,
              usedCount: 0,
              lastUsed: null,
              available: true,
              driveLink: null,
              status: "available",
            });
          }

          // Clean up tmp
          try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
          break;
        } catch (err) {
          retries++;
          addLog("download_video", "warn", `Retry ${retries}/${maxRetries} for ${url}`, String(err));
        }
      }

      if (retries >= maxRetries) {
        addLog("download_video", "error", `Failed after ${maxRetries} retries: ${url}`);
      }
    }
  })().catch((err) => {
    addLog("download_video", "error", "Video download batch failed", String(err));
  });
});

// POST /api/download/audio
router.post("/download/audio", requireAuth, async (req, res) => {
  const { urls, category } = req.body as {
    urls: string[];
    category?: string | null;
  };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const jobId = uuidv4();
  addLog("download_audio", "info", `Starting ${urls.length} audio download(s) [job ${jobId}]`);
  res.json({ jobId, message: `Started ${urls.length} audio download(s)`, status: "started" });

  // Run downloads in background
  (async () => {
    const settings = getSettings();
    const tokens = getSessionTokens(req);

    for (const url of urls) {
      let retries = 0;
      const maxRetries = settings.maxRetries || 3;

      while (retries < maxRetries) {
        try {
          const tmpDir = path.join(os.tmpdir(), `audio_${uuidv4()}`);
          const result = await downloadAudio(url, tmpDir);

          if (!result) {
            retries++;
            continue;
          }

          const { audioPath, metadata } = result;

          // Upload to Drive if configured
          const folderId = settings.driveAudioFolderId;
          if (folderId && tokens) {
            const auth = createAuthenticatedClient(tokens);
            const driveFile = await uploadFileToDrive(
              auth,
              audioPath,
              folderId,
              "audio/mpeg",
              metadata.filename
            );
            addAudio({
              driveId: driveFile.id,
              title: metadata.title,
              description: metadata.description,
              tags: metadata.tags,
              duration: metadata.duration,
              category: category ?? null,
              uploader: metadata.uploader,
              used: false,
              driveLink: driveFile.webViewLink,
            });
          } else {
            addAudio({
              driveId: audioPath,
              title: metadata.title,
              description: metadata.description,
              tags: metadata.tags,
              duration: metadata.duration,
              category: category ?? null,
              uploader: metadata.uploader,
              used: false,
              driveLink: null,
            });
          }

          try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
          break;
        } catch (err) {
          retries++;
          addLog("download_audio", "warn", `Retry ${retries}/${maxRetries} for ${url}`, String(err));
        }
      }

      if (retries >= maxRetries) {
        addLog("download_audio", "error", `Failed after ${maxRetries} retries: ${url}`);
      }
    }
  })().catch((err) => {
    addLog("download_audio", "error", "Audio download batch failed", String(err));
  });
});

export default router;
