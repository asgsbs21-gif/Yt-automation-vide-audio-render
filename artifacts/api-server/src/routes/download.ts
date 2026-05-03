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
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

// POST /api/download/video
router.post("/download/video", async (req, res) => {
  const { urls, category } = req.body as { urls: string[]; category: string };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const jobId = uuidv4();
  addLog("download_video", "info", `Starting ${urls.length} video download(s) [${jobId}]`);
  res.json({ jobId, message: `Started ${urls.length} download job(s)`, status: "started" });

  (async () => {
    const settings = getSettings();
    const tokens = getSessionTokens(req);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const urlJobId = `${jobId}_${i}`;

      emitJobUpdate({
        jobId: urlJobId,
        jobType: "download_video",
        status: "running",
        message: `Downloading video ${i + 1}/${urls.length}…`,
        progress: 0,
      });

      let retries = 0;
      const maxRetries = settings.maxRetries || 3;
      let succeeded = false;

      while (retries < maxRetries && !succeeded) {
        try {
          const tmpDir = path.join(os.tmpdir(), `kuaishou_${uuidv4()}`);
          fs.mkdirSync(tmpDir, { recursive: true });

          const filename = `video_${Date.now()}.mp4`;

          const tmpPath = await downloadKuaishouVideo(
            url,
            tmpDir,
            filename,
            urlJobId,
            (progress, message) => {
              emitJobUpdate({
                jobId: urlJobId,
                jobType: "download_video",
                status: "running",
                message,
                progress,
              });
            }
          );

          if (!tmpPath) { retries++; continue; }

          emitJobUpdate({ jobId: urlJobId, jobType: "download_video", status: "running", message: "Saving…", progress: 97 });

          const folderId = settings.driveVideoFolderId;
          if (folderId && tokens) {
            const auth = createAuthenticatedClient(tokens);
            const driveFile = await uploadFileToDrive(auth, tmpPath, folderId, "video/mp4", filename);
            addVideo({
              driveId: driveFile.id,
              filename,
              category: category || "Uncategorized",
              usedCount: 0,
              lastUsed: null,
              available: true,
              driveLink: driveFile.webViewLink,
              status: "available",
            });
          } else {
            const localDir = path.resolve(process.cwd(), "data", "videos");
            fs.mkdirSync(localDir, { recursive: true });
            const localPath = path.join(localDir, filename);
            fs.renameSync(tmpPath, localPath);
            addVideo({
              driveId: localPath,
              filename,
              category: category || "Uncategorized",
              usedCount: 0,
              lastUsed: null,
              available: true,
              driveLink: null,
              status: "available",
            });
          }

          try { fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true }); } catch {}

          emitJobUpdate({ jobId: urlJobId, jobType: "download_video", status: "done", message: `Downloaded: ${filename}`, progress: 100 });
          succeeded = true;
        } catch (err) {
          retries++;
          addLog("download_video", "warn", `Retry ${retries}/${maxRetries} for ${url}`, String(err));
          if (retries >= maxRetries) {
            emitJobUpdate({ jobId: urlJobId, jobType: "download_video", status: "error", message: `Failed after ${maxRetries} retries`, progress: 0 });
          }
        }
      }

      if (!succeeded) {
        addLog("download_video", "error", `Failed after ${maxRetries} retries: ${url}`);
      }
    }
  })().catch((err) => {
    addLog("download_video", "error", "Video download batch failed", String(err));
  });
});

// POST /api/download/audio
router.post("/download/audio", async (req, res) => {
  const { urls, category } = req.body as { urls: string[]; category?: string | null };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const jobId = uuidv4();
  addLog("download_audio", "info", `Starting ${urls.length} audio download(s) [${jobId}]`);
  res.json({ jobId, message: `Started ${urls.length} audio download(s)`, status: "started" });

  (async () => {
    const settings = getSettings();
    const tokens = getSessionTokens(req);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const urlJobId = `${jobId}_${i}`;

      emitJobUpdate({
        jobId: urlJobId,
        jobType: "download_audio",
        status: "running",
        message: `Downloading audio ${i + 1}/${urls.length}…`,
        progress: 0,
      });

      let retries = 0;
      const maxRetries = settings.maxRetries || 3;
      let succeeded = false;

      while (retries < maxRetries && !succeeded) {
        try {
          const tmpDir = path.join(os.tmpdir(), `audio_${uuidv4()}`);

          const result = await downloadAudio(
            url,
            tmpDir,
            (progress, message) => {
              emitJobUpdate({
                jobId: urlJobId,
                jobType: "download_audio",
                status: "running",
                message,
                progress,
              });
            }
          );

          if (!result) { retries++; continue; }

          const { audioPath, metadata } = result;

          emitJobUpdate({ jobId: urlJobId, jobType: "download_audio", status: "running", message: "Saving…", progress: 97 });

          const folderId = settings.driveAudioFolderId;
          if (folderId && tokens) {
            const auth = createAuthenticatedClient(tokens);
            const driveFile = await uploadFileToDrive(auth, audioPath, folderId, "audio/mpeg", metadata.filename);
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
            const localDir = path.resolve(process.cwd(), "data", "audios");
            fs.mkdirSync(localDir, { recursive: true });
            const localPath = path.join(localDir, metadata.filename);
            fs.renameSync(audioPath, localPath);
            addAudio({
              driveId: localPath,
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

          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

          emitJobUpdate({
            jobId: urlJobId,
            jobType: "download_audio",
            status: "done",
            message: `"${metadata.title}" — ${metadata.tags.length} tags extracted`,
            progress: 100,
          });
          succeeded = true;
        } catch (err) {
          retries++;
          addLog("download_audio", "warn", `Retry ${retries}/${maxRetries} for ${url}`, String(err));
          if (retries >= maxRetries) {
            emitJobUpdate({ jobId: urlJobId, jobType: "download_audio", status: "error", message: `Failed: ${String(err).slice(0, 80)}`, progress: 0 });
          }
        }
      }

      if (!succeeded) {
        addLog("download_audio", "error", `Failed after ${maxRetries} retries: ${url}`);
      }
    }
  })().catch((err) => {
    addLog("download_audio", "error", "Audio download batch failed", String(err));
  });
});

export default router;
