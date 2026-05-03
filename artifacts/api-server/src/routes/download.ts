import { Router } from "express";
import os from "os";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { addVideo, addAudio, addLog, getSettings } from "../services/data.js";
import { downloadKuaishouVideo } from "../services/kuaishou.js";
import { downloadVideoWithYtDlp, downloadAudio } from "../services/ytdlp.js";
import { uploadFileToDrive } from "../services/drive.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

// ── Detect if a URL is from Kuaishou / Kwai ───────────────────────────────────

function isKuaishouUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname.includes("kuaishou.com") ||
      hostname.includes("kwai.com") ||
      hostname.includes("v.kuaishou") ||
      hostname.includes("gifshow.com")
    );
  } catch {
    return url.toLowerCase().includes("kuaishou") || url.toLowerCase().includes("kwai");
  }
}

// ── Helper: save a video file to Drive or local storage ──────────────────────

async function saveVideoFile(
  filePath: string,
  filename: string,
  category: string,
  tokens: ReturnType<typeof getSessionTokens>,
  folderId: string | undefined
): Promise<void> {
  if (folderId && tokens) {
    const auth = createAuthenticatedClient(tokens);
    const driveFile = await uploadFileToDrive(auth, filePath, folderId, "video/mp4", filename);
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
    fs.renameSync(filePath, localPath);
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
  res.json({ jobId: batchId, message: `Started ${urls.length} download job(s)`, status: "started" });

  (async () => {
    const settings = getSettings();
    const tokens = getSessionTokens(req);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const jobId = `${batchId}_${i}`;
      const kuaishou = isKuaishouUrl(url);

      addLog("download_video", "info", `[${i + 1}/${urls.length}] ${kuaishou ? "Kuaishou" : "yt-dlp"}: ${url}`);

      emitJobUpdate({
        jobId,
        jobType: "download_video",
        status: "running",
        message: `[${i + 1}/${urls.length}] ${kuaishou ? "Launching browser…" : "Starting yt-dlp…"}`,
        progress: 0,
      });

      const maxRetries = settings.maxRetries || 3;
      let attempt = 0;
      let succeeded = false;

      while (attempt < maxRetries && !succeeded) {
        attempt++;
        const tmpDir = path.join(os.tmpdir(), `video_${uuidv4()}`);
        fs.mkdirSync(tmpDir, { recursive: true });

        try {
          let savedPath: string | null = null;
          let filename: string;

          if (kuaishou) {
            // ── Kuaishou → Puppeteer ─────────────────────────────────────────
            filename = `kuaishou_${Date.now()}.mp4`;
            savedPath = await downloadKuaishouVideo(
              url,
              tmpDir,
              filename,
              jobId,
              (progress, message) => {
                emitJobUpdate({ jobId, jobType: "download_video", status: "running", message, progress });
              }
            );
          } else {
            // ── YouTube / other → yt-dlp ─────────────────────────────────────
            const dlJobId = `dl_${Date.now()}`;
            savedPath = await downloadVideoWithYtDlp(
              url,
              tmpDir,
              dlJobId,
              (progress, message) => {
                emitJobUpdate({ jobId, jobType: "download_video", status: "running", message, progress });
              }
            );
            filename = savedPath ? path.basename(savedPath) : `video_${Date.now()}.mp4`;
          }

          if (!savedPath) {
            if (attempt < maxRetries) {
              addLog("download_video", "warn", `Attempt ${attempt}/${maxRetries} failed for ${url}, retrying…`);
              emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: `Retry ${attempt}/${maxRetries}…`, progress: 0 });
              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
              continue;
            }
            throw new Error("Download returned null after all retries");
          }

          emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: "Saving to library…", progress: 97 });

          await saveVideoFile(savedPath, filename, category, tokens, settings.driveVideoFolderId);

          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

          emitJobUpdate({ jobId, jobType: "download_video", status: "done", message: `Saved: ${filename}`, progress: 100 });
          succeeded = true;

        } catch (err) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          const msg = String(err);
          addLog("download_video", "error", `Attempt ${attempt}/${maxRetries} error for ${url}`, msg);

          if (attempt >= maxRetries) {
            emitJobUpdate({
              jobId,
              jobType: "download_video",
              status: "error",
              message: `Failed after ${maxRetries} attempts: ${msg.slice(0, 120)}`,
              progress: 0,
            });
          } else {
            emitJobUpdate({ jobId, jobType: "download_video", status: "running", message: `Error, retrying (${attempt}/${maxRetries})…`, progress: 0 });
          }
        }
      }

      if (!succeeded) {
        addLog("download_video", "error", `All ${maxRetries} attempts failed for: ${url}`);
      }
    }
  })().catch((err) => {
    addLog("download_video", "error", "Video download batch crashed", String(err));
  });
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
    const tokens = getSessionTokens(req);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const jobId = `${batchId}_${i}`;

      emitJobUpdate({
        jobId,
        jobType: "download_audio",
        status: "running",
        message: `[${i + 1}/${urls.length}] Starting yt-dlp for: ${url}`,
        progress: 0,
      });

      const maxRetries = settings.maxRetries || 3;
      let attempt = 0;
      let succeeded = false;

      while (attempt < maxRetries && !succeeded) {
        attempt++;
        const tmpDir = path.join(os.tmpdir(), `audio_${uuidv4()}`);

        try {
          const result = await downloadAudio(
            url,
            tmpDir,
            (progress, message) => {
              emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message, progress });
            }
          );

          if (!result) {
            if (attempt < maxRetries) {
              addLog("download_audio", "warn", `Attempt ${attempt}/${maxRetries} returned null for ${url}`);
              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
              continue;
            }
            throw new Error("downloadAudio returned null");
          }

          const { audioPath, metadata } = result;

          emitJobUpdate({ jobId, jobType: "download_audio", status: "running", message: "Saving to library…", progress: 97 });

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
            jobId,
            jobType: "download_audio",
            status: "done",
            message: `"${metadata.title}" — ${metadata.tags.length} tags extracted`,
            progress: 100,
          });
          succeeded = true;

        } catch (err) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          const msg = String(err);
          addLog("download_audio", "error", `Attempt ${attempt}/${maxRetries} failed for ${url}`, msg);

          if (attempt >= maxRetries) {
            emitJobUpdate({
              jobId,
              jobType: "download_audio",
              status: "error",
              message: `Failed after ${maxRetries} attempts: ${msg.slice(0, 120)}`,
              progress: 0,
            });
          }
        }
      }

      if (!succeeded) {
        addLog("download_audio", "error", `All ${maxRetries} attempts failed for: ${url}`);
      }
    }
  })().catch((err) => {
    addLog("download_audio", "error", "Audio download batch crashed", String(err));
  });
});

export default router;
