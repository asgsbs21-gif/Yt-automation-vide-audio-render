import { Router } from "express";
import os from "os";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { addVideo, addAudio, addLog, getSettings } from "../services/data.js";
import { downloadVideoWithYtDlp, downloadAudio } from "../services/ytdlp.js";
import { getVideoDuration } from "../services/ffmpeg.js";
import { uploadFileToDriveWithSpeed } from "../services/drive.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

const VIDEO_DIR = path.resolve(process.cwd(), "data", "videos");
const AUDIO_DIR = path.resolve(process.cwd(), "data", "audios");
fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

function moveFile(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    try { fs.unlinkSync(src); } catch {}
  }
}

// ── POST /api/download/video ──────────────────────────────────────────────────

router.post("/download/video", async (req, res) => {
  const { urls, category } = req.body as { urls: string[]; category: string };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  // Capture auth tokens before going async — session isn't available later
  const tokens = getSessionTokens(req);

  const batchId = uuidv4();
  addLog("download_video", "info", `Batch ${batchId}: ${urls.length} video URL(s)`);
  res.json({ jobId: batchId, message: `Started ${urls.length} download(s)`, status: "started" });

  (async () => {
    const settings = getSettings();
    const driveFolder = settings.driveVideoFolderId;
    const hasDrive = !!(tokens && driveFolder);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const jobId = `${batchId}_${i}`;

      addLog("download_video", "info", `[${i + 1}/${urls.length}] yt-dlp: ${url}`);
      emitJobUpdate({
        jobId,
        jobType: "download_video",
        status: "running",
        message: `[${i + 1}/${urls.length}] Starting yt-dlp…`,
        progress: 0,
      });

      const maxRetries = Math.max(1, settings.maxRetries || 3);
      let attempt = 0;
      let succeeded = false;

      while (attempt < maxRetries && !succeeded) {
        attempt++;
        const tmpDir = path.join(os.tmpdir(), `video_${uuidv4()}`);
        fs.mkdirSync(tmpDir, { recursive: true });

        try {
          const downloadedPath = await downloadVideoWithYtDlp(
            url,
            tmpDir,
            `dl_${Date.now()}`,
            (p, m) => {
              emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: m, progress: p });
            }
          );

          if (!downloadedPath) {
            if (attempt < maxRetries) {
              emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: `Attempt ${attempt} failed, retrying…`, progress: 0 });
              fs.rmSync(tmpDir, { recursive: true, force: true });
              continue;
            }
            throw new Error("Download returned no file");
          }

          emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: "Probing duration…", progress: 94 });
          const probedDuration = await getVideoDuration(downloadedPath);
          const filename = path.basename(downloadedPath);
          const fileSizeBytes = fs.statSync(downloadedPath).size;

          if (hasDrive) {
            emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: "Streaming to Google Drive…", progress: 95 });
            try {
              const auth = createAuthenticatedClient(tokens!);
              const driveFile = await uploadFileToDriveWithSpeed(
                auth,
                downloadedPath,
                driveFolder!,
                "video/mp4",
                filename,
                (_pct, _mbps, msg) => {
                  emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: `Drive: ${msg}`, progress: 95 });
                }
              );

              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

              addVideo({
                driveId: driveFile.id,
                filename,
                category: category || "Uncategorized",
                duration: probedDuration,
                usedCount: 0,
                lastUsed: null,
                available: true,
                driveLink: driveFile.webViewLink,
                status: "available",
              });

              emitJobUpdate({
                jobId,
                jobType: "download_video",
                status: "done",
                message: `Saved to Drive: ${filename} (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB, ${probedDuration.toFixed(1)}s)`,
                progress: 100,
              });
              succeeded = true;
              continue;

            } catch (driveErr) {
              addLog("download_video", "warn", `Drive upload failed for ${filename}, falling back to local`, String(driveErr));
            }
          }

          emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: "Saving to library…", progress: 97 });

          const destPath = path.join(VIDEO_DIR, filename);
          moveFile(downloadedPath, destPath);
          fs.rmSync(tmpDir, { recursive: true, force: true });

          const stat = fs.statSync(destPath);
          addVideo({
            driveId: destPath,
            filename,
            category: category || "Uncategorized",
            duration: probedDuration,
            usedCount: 0,
            lastUsed: null,
            available: true,
            driveLink: null,
            status: "available",
          });

          emitJobUpdate({
            jobId,
            jobType: "download_video",
            status: "done",
            message: `Saved locally: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB, ${probedDuration.toFixed(1)}s)`,
            progress: 100,
          });
          succeeded = true;

        } catch (err) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          const msg = String(err);
          addLog("download_video", "error", `Attempt ${attempt}/${maxRetries} for ${url}`, msg);
          if (attempt >= maxRetries) {
            emitJobUpdate({ jobId, jobType: "download_video", status: "error", message: `Failed: ${msg.slice(0, 120)}`, progress: 0 });
          } else {
            emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: `Error, retrying (${attempt}/${maxRetries})…`, progress: 0 });
          }
        }
      }
    }
  })().catch((err) => addLog("download_video", "error", "Batch crashed", String(err)));
});

// ── POST /api/download/audio ──────────────────────────────────────────────────

router.post("/download/audio", async (req, res) => {
  const { urls, category } = req.body as { urls: string[]; category?: string | null };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const tokens = getSessionTokens(req);

  const batchId = uuidv4();
  addLog("download_audio", "info", `Batch ${batchId}: ${urls.length} audio URL(s)`);
  res.json({ jobId: batchId, message: `Started ${urls.length} audio download(s)`, status: "started" });

  (async () => {
    const settings = getSettings();
    const driveFolder = settings.driveAudioFolderId;
    const hasDrive = !!(tokens && driveFolder);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const jobId = `${batchId}_${i}`;

      emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message: `[${i + 1}/${urls.length}] Starting yt-dlp…`, progress: 0 });

      const maxRetries = Math.max(1, settings.maxRetries || 3);
      let attempt = 0;
      let succeeded = false;

      while (attempt < maxRetries && !succeeded) {
        attempt++;
        const tmpDir = path.join(os.tmpdir(), `audio_${uuidv4()}`);

        try {
          const result = await downloadAudio(url, tmpDir, (p, m) => {
            emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message: m, progress: p });
          });

          if (!result) {
            if (attempt < maxRetries) {
              fs.rmSync(tmpDir, { recursive: true, force: true });
              continue;
            }
            throw new Error("downloadAudio returned null");
          }

          const { audioPath, metadata } = result;
          const ext = path.extname(audioPath) || ".mp3";

          if (hasDrive) {
            emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message: "Streaming to Google Drive…", progress: 94 });
            try {
              const auth = createAuthenticatedClient(tokens!);
              const driveFilename = `${metadata.title}${ext}`.replace(/[/\\?%*:|"<>]/g, "_");
              const driveFile = await uploadFileToDriveWithSpeed(
                auth,
                audioPath,
                driveFolder!,
                "audio/mpeg",
                driveFilename,
                (_pct, _mbps, msg) => {
                  emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message: `Drive: ${msg}`, progress: 95 });
                }
              );

              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

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

              emitJobUpdate({
                jobId,
                jobType: "download_audio",
                status: "done",
                message: `Saved to Drive: "${metadata.title}" — ${metadata.duration.toFixed(1)}s, ${metadata.tags.length} tags`,
                progress: 100,
              });
              succeeded = true;
              continue;

            } catch (driveErr) {
              addLog("download_audio", "warn", `Drive upload failed for ${metadata.title}, falling back to local`, String(driveErr));
            }
          }

          emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message: "Saving to library…", progress: 97 });

          const destPath = path.join(AUDIO_DIR, metadata.filename);
          moveFile(audioPath, destPath);
          fs.rmSync(tmpDir, { recursive: true, force: true });

          addAudio({
            driveId: destPath,
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            duration: metadata.duration,
            category: category ?? null,
            uploader: metadata.uploader,
            used: false,
            driveLink: null,
          });

          emitJobUpdate({
            jobId,
            jobType: "download_audio",
            status: "done",
            message: `"${metadata.title}" — ${metadata.duration.toFixed(1)}s, ${metadata.tags.length} tags`,
            progress: 100,
          });
          succeeded = true;

        } catch (err) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          const msg = String(err);
          addLog("download_audio", "error", `Attempt ${attempt}/${maxRetries} for ${url}`, msg);
          if (attempt >= maxRetries) {
            emitJobUpdate({ jobId, jobType: "download_audio", status: "error", message: `Failed: ${msg.slice(0, 120)}`, progress: 0 });
          }
        }
      }
    }
  })().catch((err) => addLog("download_audio", "error", "Batch crashed", String(err)));
});

export default router;
