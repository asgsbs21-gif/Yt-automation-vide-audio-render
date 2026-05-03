import cron from "node-cron";
import os from "os";
import path from "path";
import fs from "fs";
import {
  getSettings,
  getQueue,
  getAudios,
  getRandomUnusedAudio,
  pickVideosForDuration,
  markVideosUsed,
  markAudioUsed,
  addQueueItem,
  updateQueueItem,
  addLog,
} from "./data.js";
import { getGlobalTokens, createAuthenticatedClient } from "./auth.js";
import { downloadFromDrive } from "./drive.js";
import { uploadToYouTube } from "./youtube.js";
import { mergeVideoWithAudio } from "./ffmpeg.js";
import { uploadFileToDrive } from "./drive.js";
import { emitJobUpdate } from "../lib/socket.js";
import { v4 as uuidv4 } from "uuid";

let schedulerTask: cron.ScheduledTask | null = null;
let lastAutoRunMinute = -1;

// ── Upload a single queue item ────────────────────────────────────────────────

export async function processQueueItem(
  itemId: string,
  tokens: { access_token: string; refresh_token?: string | null }
): Promise<void> {
  const queue = getQueue();
  const item = queue.find((q) => q.id === itemId);
  if (!item) throw new Error(`Queue item ${itemId} not found`);

  updateQueueItem(itemId, { status: "uploading" });
  addLog("upload", "info", `Starting upload: ${item.title}`);

  emitJobUpdate({
    jobId: itemId,
    jobType: "upload",
    status: "running",
    message: `Uploading: ${item.title}`,
    progress: 10,
  });

  const auth = createAuthenticatedClient(tokens);
  const settings = getSettings();
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `output_${Date.now()}.mp4`);

  try {
    if (!item.driveId.startsWith("/")) {
      addLog("upload", "info", "Downloading from Drive…");
      emitJobUpdate({ jobId: itemId, jobType: "upload", status: "running", message: "Downloading from Drive…", progress: 30 });
      await downloadFromDrive(auth, item.driveId, tmpFile);
    } else {
      fs.copyFileSync(item.driveId, tmpFile);
    }

    emitJobUpdate({ jobId: itemId, jobType: "upload", status: "running", message: "Uploading to YouTube…", progress: 60 });

    const { youtubeId, youtubeUrl } = await uploadToYouTube(auth, {
      title: item.title,
      description: item.description,
      tags: item.tags,
      categoryId: settings.youtubeCategoryId,
      filePath: tmpFile,
      scheduledAt: item.scheduledAt,
    });

    updateQueueItem(itemId, { status: "uploaded", youtubeId, youtubeUrl });
    addLog("upload", "success", `Uploaded: ${item.title} → ${youtubeUrl}`);

    emitJobUpdate({ jobId: itemId, jobType: "upload", status: "done", message: `Uploaded! ${youtubeUrl}`, progress: 100 });
  } catch (err) {
    const msg = String(err);
    updateQueueItem(itemId, { status: "failed", error: msg });
    addLog("upload", "error", `Upload failed: ${item.title}`, msg);
    emitJobUpdate({ jobId: itemId, jobType: "upload", status: "error", message: `Upload failed: ${msg.slice(0, 100)}`, progress: 0 });
    throw err;
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Auto cycle: pick videos + audio, merge, upload ───────────────────────────

async function runAutoCycle(
  tokens: { access_token: string; refresh_token?: string | null }
): Promise<void> {
  const jobId = uuidv4();
  const settings = getSettings();
  const auth = createAuthenticatedClient(tokens);

  addLog("schedule", "info", "Auto-cycle: starting daily job…");
  emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Auto-cycle: picking audio…", progress: 5 });

  const audio = getRandomUnusedAudio(null);
  if (!audio) {
    addLog("schedule", "warn", "Auto-cycle: no unused audio available");
    return;
  }

  const videos = pickVideosForDuration(null, audio.duration);
  if (videos.length === 0) {
    addLog("schedule", "warn", "Auto-cycle: no videos available");
    return;
  }

  const tmpDir = path.join(os.tmpdir(), `autocycle_${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Preparing ${videos.length} clip(s)…`, progress: 15 });

    const videoPaths: string[] = [];
    for (const video of videos) {
      const dest = path.join(tmpDir, video.filename);
      if (!video.driveId.startsWith("/")) {
        await downloadFromDrive(auth, video.driveId, dest);
      } else {
        fs.copyFileSync(video.driveId, dest);
      }
      videoPaths.push(dest);
    }

    const audioDest = path.join(tmpDir, "audio.mp3");
    if (!audio.driveId.startsWith("/")) {
      await downloadFromDrive(auth, audio.driveId, audioDest);
    } else {
      fs.copyFileSync(audio.driveId, audioDest);
    }

    emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Merging video…", progress: 40 });

    const outputPath = path.join(tmpDir, `output_${jobId}.mp4`);
    await mergeVideoWithAudio(videoPaths, audioDest, outputPath, (pct, msg) => {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: msg, progress: 40 + Math.round(pct * 0.4) });
    });

    let outputDriveId = outputPath;
    let outputDriveLink: string | null = null;

    if (settings.driveOutputFolderId) {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Uploading to Drive…", progress: 85 });
      const driveFile = await uploadFileToDrive(
        auth, outputPath, settings.driveOutputFolderId, "video/mp4", `output_${jobId}.mp4`
      );
      outputDriveId = driveFile.id;
      outputDriveLink = driveFile.webViewLink;
    }

    markVideosUsed(videos.map((v) => v.id));
    markAudioUsed(audio.id);

    const queueItem = addQueueItem({
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

    emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Uploading to YouTube…", progress: 90 });
    await processQueueItem(queueItem.id, tokens);

    addLog("schedule", "success", `Auto-cycle complete: "${audio.title}"`);
    emitJobUpdate({ jobId, jobType: "process", status: "done", message: "Auto-cycle complete!", progress: 100 });

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  } catch (err) {
    addLog("schedule", "error", "Auto-cycle failed", String(err));
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `Auto-cycle failed: ${String(err).slice(0, 100)}`, progress: 0 });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── Start the scheduler ────────────────────────────────────────────────────────

export function startScheduler(): void {
  if (schedulerTask) schedulerTask.stop();

  schedulerTask = cron.schedule("* * * * *", async () => {
    const settings = getSettings();
    const tokens = getGlobalTokens();
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    if (tokens) {
      const queue = getQueue();
      const due = queue.filter((item) => {
        if (item.status !== "scheduled" || !item.scheduledAt) return false;
        return new Date(item.scheduledAt) <= now;
      });

      for (const item of due) {
        try {
          await processQueueItem(item.id, tokens);
        } catch {}
      }

      if (settings.autoCycleEnabled && currentMinute !== lastAutoRunMinute) {
        const [hStr, mStr] = (settings.dailyUploadTime || "09:00").split(":");
        const targetH = parseInt(hStr, 10);
        const targetM = parseInt(mStr, 10);

        if (now.getHours() === targetH && now.getMinutes() === targetM) {
          lastAutoRunMinute = currentMinute;
          runAutoCycle(tokens).catch((err) => {
            addLog("schedule", "error", "Auto-cycle error", String(err));
          });
        }
      }
    }
  });

  addLog("schedule", "info", "Scheduler started");
}

export function stopScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
  }
}
