import { Router } from "express";
import os from "os";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { addVideo, addAudio, addLog, getSettings } from "../services/data.js";
import { downloadKuaishouVideo } from "../services/kuaishou.js";
import { downloadVideoWithYtDlp, downloadAudio } from "../services/ytdlp.js";
import { getVideoDuration } from "../services/ffmpeg.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

const VIDEO_DIR = path.resolve(process.cwd(), "data", "videos");
const AUDIO_DIR = path.resolve(process.cwd(), "data", "audios");
fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

function moveFile(src: string, dest: string): void {
  fs.copyFileSync(src, dest);
  try { fs.unlinkSync(src); } catch {}
}

function isKuaishouUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.includes("kuaishou") || h.includes("kwai") || h.includes("gifshow");
  } catch {
    const l = url.toLowerCase();
    return l.includes("kuaishou") || l.includes("kwai");
  }
}

// ── POST /api/download/video ──────────────────────────────────────────────────

router.post("/download/video", async (req, res) => {
  const { urls, category } = req.body as { urls: string[]; category: string };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const batchId = uuidv4();
  addLog("download_video", "info", `Batch ${batchId}: ${urls.length} video URL(s)`);
  res.json({ jobId: batchId, message: `Started ${urls.length} download(s)`, status: "started" });

  (async () => {
    const settings = getSettings();

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const jobId = `${batchId}_${i}`;
      const kuaishou = isKuaishouUrl(url);

      addLog("download_video", "info", `[${i + 1}/${urls.length}] ${kuaishou ? "Kuaishou→Puppeteer" : "yt-dlp"}: ${url}`);
      emitJobUpdate({
        jobId,
        jobType: "download_video",
        status: "running",
        message: `[${i + 1}/${urls.length}] ${kuaishou ? "Launching browser…" : "Starting yt-dlp…"}`,
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
          let downloadedPath: string | null = null;

          if (kuaishou) {
            const filename = `kuaishou_${Date.now()}.mp4`;
            downloadedPath = await downloadKuaishouVideo(url, tmpDir, filename, jobId, (p, m) => {
              emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: m, progress: p });
            });
          } else {
            downloadedPath = await downloadVideoWithYtDlp(url, tmpDir, `dl_${Date.now()}`, (p, m) => {
              emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: m, progress: p });
            });
          }

          if (!downloadedPath) {
            if (attempt < maxRetries) {
              emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: `Attempt ${attempt} failed, retrying…`, progress: 0 });
              fs.rmSync(tmpDir, { recursive: true, force: true });
              continue;
            }
            throw new Error("Download returned no file");
          }

          emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: "Probing duration…", progress: 95 });

          // Probe duration BEFORE moving so we have it for concat planning
          const probedDuration = await getVideoDuration(downloadedPath);

          emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: "Saving to library…", progress: 97 });

          const filename = path.basename(downloadedPath);
          const destPath = path.join(VIDEO_DIR, filename);
          moveFile(downloadedPath, destPath);

          const stat = fs.statSync(destPath);
          addVideo({
            driveId: destPath,
            filename,
            category: category || "Uncategorized",
            duration: probedDuration,   // real duration stored — used by pickVideosForDuration
            usedCount: 0,
            lastUsed: null,
            available: true,
            driveLink: null,
            status: "available",
          });

          fs.rmSync(tmpDir, { recursive: true, force: true });

          emitJobUpdate({
            jobId,
            jobType: "download_video",
            status: "done",
            message: `Saved: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB, ${probedDuration.toFixed(1)}s)`,
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

  const batchId = uuidv4();
  addLog("download_audio", "info", `Batch ${batchId}: ${urls.length} audio URL(s)`);
  res.json({ jobId: batchId, message: `Started ${urls.length} audio download(s)`, status: "started" });

  (async () => {
    const settings = getSettings();

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
          emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message: "Saving to library…", progress: 97 });

          const destPath = path.join(AUDIO_DIR, metadata.filename);
          moveFile(audioPath, destPath);

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

          fs.rmSync(tmpDir, { recursive: true, force: true });

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
