import cron from "node-cron";
import os from "os";
import path from "path";
import fs from "fs";
import {
  getSettings,
  getQueue,
  getRandomUnusedAudio,
  pickVideosForDuration,
  pickAdditionalVideos,
  markVideosUsed,
  markAudioUsed,
  addQueueItem,
  updateQueueItem,
  addLog,
  type Video,
} from "./data.js";
import { getGlobalTokens, createAuthenticatedClient } from "./auth.js";
import { downloadFromDrive } from "./drive.js";
import { uploadToYouTube } from "./youtube.js";
import { mergeVideoWithAudio, getVideoDuration } from "./ffmpeg.js";
import { uploadFileToDrive } from "./drive.js";
import { emitJobUpdate } from "../lib/socket.js";
import { v4 as uuidv4 } from "uuid";

let schedulerTask: cron.ScheduledTask | null = null;

const OUTPUT_DIR = path.resolve(process.cwd(), "data", "output");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const firedSlots = new Set<string>();

// ── Helper: download a video and return its actual duration ───────────────────

async function downloadVideoFile(
  video: Video,
  tmpDir: string,
  prefix: string,
  auth: ReturnType<typeof createAuthenticatedClient>
): Promise<{ localPath: string; actualDuration: number }> {
  const dest = path.join(tmpDir, `${prefix}_${video.filename}`);
  if (!video.driveId.startsWith("/")) {
    await downloadFromDrive(auth, video.driveId, dest);
  } else {
    fs.copyFileSync(video.driveId, dest);
  }
  const actualDuration = await getVideoDuration(dest);
  return { localPath: dest, actualDuration };
}

// ── Upload a single queue item to YouTube ─────────────────────────────────────

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

// ── Auto-cycle: pick clips, fill to audio duration, merge, save, upload ───────
//
// Concat logic mirrors process.ts:
//  1. pickVideosForDuration → initial clip set (uses stored durations as estimate)
//  2. Download each → probe actual duration via ffprobe
//  3. If total < audio.duration → pickAdditionalVideos → download+probe, repeat
//  4. mergeVideoWithAudio with audioDuration → hard -t trim to exact length

async function runAutoCycle(
  tokens: { access_token: string; refresh_token?: string | null },
  slotLabel: string
): Promise<void> {
  const jobId = uuidv4();
  const settings = getSettings();
  const auth = createAuthenticatedClient(tokens);

  addLog("schedule", "info", `Auto-cycle [${slotLabel}]: starting…`);
  emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Auto-cycle [${slotLabel}]: picking audio…`, progress: 3 });

  const audio = getRandomUnusedAudio(null);
  if (!audio) {
    addLog("schedule", "warn", `Auto-cycle [${slotLabel}]: no unused audio available`);
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] No unused audio`, progress: 0 });
    return;
  }

  const initialVideos = pickVideosForDuration(null, audio.duration);
  if (initialVideos.length === 0) {
    addLog("schedule", "warn", `Auto-cycle [${slotLabel}]: no videos in pool`);
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] No videos available`, progress: 0 });
    return;
  }

  const tmpDir = path.join(os.tmpdir(), `autocycle_${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // ── Download initial clips ─────────────────────────────────────────────────
    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Downloading ${initialVideos.length} clip(s)…`, progress: 10 });

    const videoPaths: string[] = [];
    const usedVideoIds = new Set<string>();
    let totalActualDuration = 0;

    for (let i = 0; i < initialVideos.length; i++) {
      const video = initialVideos[i];
      const { localPath, actualDuration } = await downloadVideoFile(video, tmpDir, `v${i}`, auth);
      videoPaths.push(localPath);
      usedVideoIds.add(video.id);
      totalActualDuration += actualDuration;
      addLog("schedule", "info", `[${slotLabel}] Clip ${i + 1}: ${video.filename} — ${actualDuration.toFixed(1)}s`);
    }

    // ── Supplement if needed ──────────────────────────────────────────────────
    let fillRound = 0;
    while (totalActualDuration < audio.duration && fillRound < 10) {
      fillRound++;
      const stillNeeded = audio.duration - totalActualDuration;
      const moreVideos = pickAdditionalVideos(null, usedVideoIds, stillNeeded);
      if (moreVideos.length === 0) {
        addLog("schedule", "warn", `[${slotLabel}] Pool exhausted at ${totalActualDuration.toFixed(1)}s — proceeding`);
        break;
      }
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Topping up: need ${stillNeeded.toFixed(1)}s more…`, progress: 20 });
      for (const video of moreVideos) {
        if (totalActualDuration >= audio.duration) break;
        const { localPath, actualDuration } = await downloadVideoFile(video, tmpDir, `fill${fillRound}_${video.id.slice(0, 8)}`, auth);
        videoPaths.push(localPath);
        usedVideoIds.add(video.id);
        totalActualDuration += actualDuration;
        addLog("schedule", "info", `[${slotLabel}] + Extra clip: ${video.filename} — ${actualDuration.toFixed(1)}s → total ${totalActualDuration.toFixed(1)}s`);
      }
    }

    addLog("schedule", "info", `[${slotLabel}] Coverage: ${totalActualDuration.toFixed(1)}s video for ${audio.duration.toFixed(1)}s audio (${videoPaths.length} clips)`);

    // ── Download audio ─────────────────────────────────────────────────────────
    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Preparing audio…`, progress: 28 });
    const audioDest = path.join(tmpDir, "audio.mp3");
    if (!audio.driveId.startsWith("/")) {
      await downloadFromDrive(auth, audio.driveId, audioDest);
    } else {
      fs.copyFileSync(audio.driveId, audioDest);
    }

    // ── Merge ──────────────────────────────────────────────────────────────────
    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Merging ${videoPaths.length} clips → ${audio.duration.toFixed(1)}s…`, progress: 32 });

    const outputFilename = `output_${jobId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    await mergeVideoWithAudio(videoPaths, audioDest, outputPath, (pct, msg) => {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] ${msg}`, progress: 32 + Math.round(pct * 0.48) });
    }, audio.duration);

    // ── Optional Drive upload ──────────────────────────────────────────────────
    if (settings.driveOutputFolderId) {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Uploading to Drive…`, progress: 83 });
      try {
        await uploadFileToDrive(auth, outputPath, settings.driveOutputFolderId, "video/mp4", outputFilename);
      } catch (e) {
        addLog("schedule", "warn", `[${slotLabel}] Drive upload failed (local copy kept)`, String(e));
      }
    }

    // ── Mark used, queue, upload ───────────────────────────────────────────────
    markVideosUsed([...usedVideoIds]);
    markAudioUsed(audio.id);

    const queueItem = addQueueItem({
      driveId: outputPath,
      title: audio.title,
      description: audio.description,
      tags: audio.tags,
      scheduledAt: null,
      status: "pending",
      youtubeUrl: null,
      youtubeId: null,
      error: null,
    });

    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Uploading to YouTube…`, progress: 88 });
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

// ── Start the cron scheduler ──────────────────────────────────────────────────

export function startScheduler(): void {
  if (schedulerTask) schedulerTask.stop();

  schedulerTask = cron.schedule("* * * * *", async () => {
    const settings = getSettings();
    const tokens = getGlobalTokens();
    const now = new Date();

    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");

    // Clear stale fired-slot keys at midnight
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      for (const key of firedSlots) {
        if (!key.startsWith(today)) firedSlots.delete(key);
      }
    }

    if (!tokens) return;

    // Process manually scheduled queue items that are due
    const queue = getQueue();
    const due = queue.filter(
      (item) => item.status === "scheduled" && !!item.scheduledAt && new Date(item.scheduledAt) <= now
    );
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
        const label = `${slot.label}/${slot.labelBn} ${slot.time}`;
        runAutoCycle(tokens, label).catch((err) => {
          addLog("schedule", "error", `Auto-cycle [${label}] crashed`, String(err));
        });
      }
    }
  });

  addLog("schedule", "info", "Scheduler started");
}

export function stopScheduler(): void {
  if (schedulerTask) { schedulerTask.stop(); schedulerTask = null; }
}
