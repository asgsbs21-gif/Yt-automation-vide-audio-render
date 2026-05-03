import cron from "node-cron";
import os from "os";
import path from "path";
import fs from "fs";
import {
  getSettings,
  getQueue,
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

// Permanent output directory — same as process.ts, for preview streaming
const OUTPUT_DIR = path.resolve(process.cwd(), "data", "output");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Track which slots have already fired today: "YYYY-MM-DD-slotId"
const firedSlots = new Set<string>();

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
  emitJobUpdate({ jobId: itemId, jobType: "upload", status: "running", message: `Uploading: ${item.title}`, progress: 10 });

  const auth = createAuthenticatedClient(tokens);
  const settings = getSettings();
  const tmpFile = path.join(os.tmpdir(), `upload_${Date.now()}.mp4`);

  try {
    if (!item.driveId.startsWith("/")) {
      addLog("upload", "info", "Downloading from Drive…");
      emitJobUpdate({ jobId: itemId, jobType: "upload", status: "running", message: "Downloading from Drive…", progress: 30 });
      await downloadFromDrive(auth, item.driveId, tmpFile);
    } else {
      // Local file — copy to tmp for YouTube upload (keeps original for preview)
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

// ── Auto cycle: pick videos + audio, merge, save to /data/output/, upload ─────

async function runAutoCycle(
  tokens: { access_token: string; refresh_token?: string | null },
  slotLabel: string
): Promise<void> {
  const jobId = uuidv4();
  const settings = getSettings();
  const auth = createAuthenticatedClient(tokens);

  addLog("schedule", "info", `Auto-cycle [${slotLabel}]: starting…`);
  emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Auto-cycle [${slotLabel}]: picking audio…`, progress: 5 });

  const audio = getRandomUnusedAudio(null);
  if (!audio) {
    addLog("schedule", "warn", `Auto-cycle [${slotLabel}]: no unused audio available`);
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] No unused audio available`, progress: 0 });
    return;
  }

  const videos = pickVideosForDuration(null, audio.duration);
  if (videos.length === 0) {
    addLog("schedule", "warn", `Auto-cycle [${slotLabel}]: no videos available`);
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] No videos available`, progress: 0 });
    return;
  }

  const tmpDir = path.join(os.tmpdir(), `autocycle_${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Preparing ${videos.length} clip(s)…`, progress: 15 });

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

    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Merging…`, progress: 40 });

    // Save output permanently to /data/output/ for preview
    const outputFilename = `output_${jobId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    await mergeVideoWithAudio(videoPaths, audioDest, outputPath, (pct, msg) => {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] ${msg}`, progress: 40 + Math.round(pct * 0.4) });
    });

    // Optional Drive upload (on top of local copy)
    if (settings.driveOutputFolderId) {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Uploading output to Drive…`, progress: 85 });
      try {
        await uploadFileToDrive(auth, outputPath, settings.driveOutputFolderId, "video/mp4", outputFilename);
      } catch (e) {
        addLog("schedule", "warn", "Drive output upload failed (local copy kept)", String(e));
      }
    }

    markVideosUsed(videos.map((v) => v.id));
    markAudioUsed(audio.id);

    const queueItem = addQueueItem({
      driveId: outputPath,    // permanent /data/output/ path — previewable
      title: audio.title,
      description: audio.description,
      tags: audio.tags,
      scheduledAt: null,
      status: "pending",
      youtubeUrl: null,
      youtubeId: null,
      error: null,
    });

    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Uploading to YouTube…`, progress: 90 });
    await processQueueItem(queueItem.id, tokens);

    addLog("schedule", "success", `Auto-cycle [${slotLabel}] complete: "${audio.title}"`);
    emitJobUpdate({ jobId, jobType: "process", status: "done", message: `[${slotLabel}] Done!`, progress: 100 });
  } catch (err) {
    addLog("schedule", "error", `Auto-cycle [${slotLabel}] failed`, String(err));
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] Failed: ${String(err).slice(0, 100)}`, progress: 0 });
  } finally {
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

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Clean up stale fired-slot keys from previous days
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      for (const key of firedSlots) {
        if (!key.startsWith(today)) firedSlots.delete(key);
      }
    }

    if (!tokens) return;

    // Process manually scheduled queue items
    const queue = getQueue();
    const due = queue.filter((item) => {
      if (item.status !== "scheduled" || !item.scheduledAt) return false;
      return new Date(item.scheduledAt) <= now;
    });
    for (const item of due) {
      try { await processQueueItem(item.id, tokens); } catch {}
    }

    if (!settings.autoCycleEnabled) return;

    for (const slot of (settings.uploadSlots ?? [])) {
      if (!slot.enabled) continue;

      const slotKey = `${today}-${slot.id}`;
      if (firedSlots.has(slotKey)) continue;

      const [hStr, mStr] = (slot.time || "09:00").split(":");
      if (now.getHours() === parseInt(hStr, 10) && now.getMinutes() === parseInt(mStr, 10)) {
        firedSlots.add(slotKey);
        const label = `${slot.label} / ${slot.labelBn} ${slot.time}`;
        runAutoCycle(tokens, label).catch((err) => {
          addLog("schedule", "error", `Auto-cycle [${label}] error`, String(err));
        });
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
