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
  getDistinctVideoCategories,
  getLastAutoCycleCategory,
  setLastAutoCycleCategory,
  type Video,
} from "./data.js";
import { getGlobalTokens, createAuthenticatedClient } from "./auth.js";
import { downloadFromDrive } from "./drive.js";
import { uploadToYouTube, setYouTubeThumbnail } from "./youtube.js";
import { mergeVideoWithAudio, getVideoDuration, extractThumbnail } from "./ffmpeg.js";
import { composeThumbnailWithText } from "./thumbnail.js";
import { uploadFileToDrive } from "./drive.js";
import { sendTelegramNotification } from "./telegram.js";
import { emitJobUpdate } from "../lib/socket.js";
import { v4 as uuidv4 } from "uuid";

let schedulerTask: cron.ScheduledTask | null = null;

const OUTPUT_DIR = path.resolve(process.cwd(), "data", "output");
const WATERMARK_PATH = path.resolve(process.cwd(), "data", "watermark.png");
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

  const settings = getSettings();

  // ── Duplicate check: same title uploaded within last 30 days ────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const isDuplicate = getQueue().some(
    (q) =>
      q.status === "uploaded" &&
      q.youtubeId != null &&
      q.title === item.title &&
      new Date(q.createdAt) > thirtyDaysAgo &&
      q.id !== item.id
  );
  if (isDuplicate) {
    updateQueueItem(itemId, {
      status: "failed",
      error: "Duplicate: same title already uploaded within 30 days",
    });
    addLog("upload", "warn", `Duplicate skip: "${item.title}" was already uploaded recently`);
    emitJobUpdate({
      jobId: itemId,
      jobType: "upload",
      status: "error",
      message: `Skipped (duplicate): "${item.title}"`,
      progress: 0,
    });
    return;
  }

  updateQueueItem(itemId, { status: "uploading" });
  addLog("upload", "info", `Starting upload: ${item.title}`);
  emitJobUpdate({ jobId: itemId, jobType: "upload", status: "running", message: `Uploading: ${item.title}`, progress: 10 });

  const auth = createAuthenticatedClient(tokens);
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

    // Set custom thumbnail if one was generated/saved for this item
    if (item.thumbnailPath && fs.existsSync(item.thumbnailPath)) {
      try {
        await setYouTubeThumbnail(auth, youtubeId, item.thumbnailPath);
      } catch (thumbErr) {
        addLog("upload", "warn", "Thumbnail upload failed (non-fatal — channel may need verification)", String(thumbErr));
      }
    }

    updateQueueItem(itemId, { status: "uploaded", youtubeId, youtubeUrl });
    addLog("upload", "success", `Uploaded: ${item.title} → ${youtubeUrl}`);
    emitJobUpdate({ jobId: itemId, jobType: "upload", status: "done", message: `Uploaded! ${youtubeUrl}`, progress: 100 });

    // ── Telegram notification ──────────────────────────────────────────────────
    if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      const msg =
        `✅ <b>YouTube Upload Complete!</b>\n\n` +
        `📹 <b>${item.title}</b>\n` +
        `🔗 ${youtubeUrl}`;
      sendTelegramNotification(settings.telegramBotToken, settings.telegramChatId, msg).catch(
        (e) => addLog("upload", "warn", "Telegram notification failed (non-fatal)", String(e))
      );
    }
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

// ── Auto-cycle: category-locked clip selection with round-robin rotation ───────

async function runAutoCycle(
  tokens: { access_token: string; refresh_token?: string | null },
  slotLabel: string
): Promise<void> {
  const jobId = uuidv4();
  const settings = getSettings();
  const auth = createAuthenticatedClient(tokens);

  addLog("schedule", "info", `Auto-cycle [${slotLabel}]: starting…`);
  emitJobUpdate({ jobId, jobType: "process", status: "running", message: `Auto-cycle [${slotLabel}]: selecting category…`, progress: 2 });

  // ── Step 1: Rotate to next category ─────────────────────────────────────────
  const categories = getDistinctVideoCategories();
  if (categories.length === 0) {
    addLog("schedule", "warn", `Auto-cycle [${slotLabel}]: no available videos in any category`);
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] No videos available`, progress: 0 });
    return;
  }

  const lastCategory = getLastAutoCycleCategory();
  const lastIdx = lastCategory ? categories.indexOf(lastCategory) : -1;
  const nextIdx = (lastIdx + 1) % categories.length;
  const chosenCategory = categories[nextIdx];
  setLastAutoCycleCategory(chosenCategory);

  addLog("schedule", "info", `[${slotLabel}] Category: "${lastCategory ?? "none"}" → "${chosenCategory}"`);
  emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Category: "${chosenCategory}" — picking audio…`, progress: 4 });

  // ── Step 2: Pick audio ───────────────────────────────────────────────────────
  const audio = getRandomUnusedAudio(null);
  if (!audio) {
    addLog("schedule", "warn", `Auto-cycle [${slotLabel}]: no unused audio available`);
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] No unused audio`, progress: 0 });
    return;
  }

  // Effective duration accounts for audio trim
  const audioTrimStart = audio.trimStart ?? null;
  const audioTrimEnd = audio.trimEnd ?? null;
  const effectiveAudioDuration = (audioTrimEnd ?? audio.duration) - (audioTrimStart ?? 0);

  // ── Step 3: Initial video selection locked to chosenCategory ─────────────────
  const initialVideos = pickVideosForDuration(chosenCategory, effectiveAudioDuration);
  if (initialVideos.length === 0) {
    addLog("schedule", "warn", `Auto-cycle [${slotLabel}]: no videos in category "${chosenCategory}"`);
    emitJobUpdate({ jobId, jobType: "process", status: "error", message: `[${slotLabel}] No videos in "${chosenCategory}"`, progress: 0 });
    return;
  }

  const tmpDir = path.join(os.tmpdir(), `autocycle_${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // ── Step 4: Download initial clips ────────────────────────────────────────
    emitJobUpdate({
      jobId, jobType: "process", status: "running",
      message: `[${slotLabel}] [${chosenCategory}] Downloading ${initialVideos.length} clip(s)…`,
      progress: 10,
    });

    const videoPaths: string[] = [];
    const usedVideoIds = new Set<string>();
    let totalActualDuration = 0;

    for (let i = 0; i < initialVideos.length; i++) {
      const video = initialVideos[i];
      const { localPath, actualDuration } = await downloadVideoFile(video, tmpDir, `v${i}`, auth);
      videoPaths.push(localPath);
      usedVideoIds.add(video.id);
      totalActualDuration += actualDuration;
      addLog("schedule", "info",
        `[${slotLabel}] [${chosenCategory}] Clip ${i + 1}: ${video.filename} — ${actualDuration.toFixed(1)}s`);
    }

    // ── Step 5: Fill gap ──────────────────────────────────────────────────────
    let fillRound = 0;
    while (totalActualDuration < effectiveAudioDuration && fillRound < 10) {
      fillRound++;
      const stillNeeded = effectiveAudioDuration - totalActualDuration;
      const moreVideos = pickAdditionalVideos(chosenCategory, usedVideoIds, stillNeeded);

      if (moreVideos.length === 0) {
        addLog("schedule", "warn", `[${slotLabel}] Pool exhausted at ${totalActualDuration.toFixed(1)}s — proceeding`);
        break;
      }

      emitJobUpdate({
        jobId, jobType: "process", status: "running",
        message: `[${slotLabel}] Fill round ${fillRound}: need ${stillNeeded.toFixed(1)}s more…`,
        progress: 20,
      });

      for (const video of moreVideos) {
        if (totalActualDuration >= effectiveAudioDuration) break;
        const { localPath, actualDuration } = await downloadVideoFile(
          video, tmpDir, `fill${fillRound}_${video.id.slice(0, 8)}`, auth
        );
        videoPaths.push(localPath);
        usedVideoIds.add(video.id);
        totalActualDuration += actualDuration;
      }
    }

    addLog("schedule", "info",
      `[${slotLabel}] Final: ${videoPaths.length} clip(s), ${totalActualDuration.toFixed(1)}s → trimmed to ${effectiveAudioDuration.toFixed(1)}s`);

    // ── Step 6: Download audio ────────────────────────────────────────────────
    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Preparing audio…`, progress: 28 });
    const audioDest = path.join(tmpDir, "audio.mp3");
    if (!audio.driveId.startsWith("/")) {
      await downloadFromDrive(auth, audio.driveId, audioDest);
    } else {
      fs.copyFileSync(audio.driveId, audioDest);
    }

    // ── Step 7: Merge ─────────────────────────────────────────────────────────
    emitJobUpdate({
      jobId, jobType: "process", status: "running",
      message: `[${slotLabel}] Merging ${videoPaths.length} clip(s) → ${effectiveAudioDuration.toFixed(1)}s…`,
      progress: 32,
    });

    const outputFilename = `output_${jobId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    const hasWatermark = settings.watermarkEnabled && fs.existsSync(WATERMARK_PATH);
    await mergeVideoWithAudio(
      videoPaths,
      audioDest,
      outputPath,
      (pct, msg) => {
        emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] ${msg}`, progress: 32 + Math.round(pct * 0.48) });
      },
      effectiveAudioDuration,
      {
        watermarkPath: hasWatermark ? WATERMARK_PATH : null,
        speedMultiplier: settings.speedMultiplier ?? 1.0,
        normalizeVolume: settings.normalizeVolume ?? false,
        audioTrimStart,
        audioTrimEnd,
      }
    );

    // ── Step 8: Optional thumbnail ────────────────────────────────────────────
    let thumbnailPath: string | null = null;
    if (settings.thumbnailEnabled) {
      const thumbFile = path.join(OUTPUT_DIR, `thumb_${jobId}.jpg`);
      try {
        emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Extracting thumbnail…`, progress: 82 });
        await extractThumbnail(outputPath, thumbFile);
        thumbnailPath = thumbFile;
        try {
          await composeThumbnailWithText(thumbFile, thumbFile, audio.title, settings.thumbnailBgColor);
        } catch (composeErr) {
          addLog("schedule", "warn", `[${slotLabel}] Thumbnail text overlay failed`, String(composeErr));
        }
      } catch {
        addLog("schedule", "warn", `[${slotLabel}] Thumbnail extraction failed (non-fatal)`);
      }
    }

    // ── Step 9: Optional Drive upload ─────────────────────────────────────────
    if (settings.driveOutputFolderId) {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Uploading to Drive…`, progress: 83 });
      try {
        await uploadFileToDrive(auth, outputPath, settings.driveOutputFolderId, "video/mp4", outputFilename);
      } catch (e) {
        addLog("schedule", "warn", `[${slotLabel}] Drive upload failed (local copy kept)`, String(e));
      }
    }

    // ── Step 10: Mark used, queue, upload ─────────────────────────────────────
    markVideosUsed([...usedVideoIds]);
    markAudioUsed(audio.id);

    const queueItem = addQueueItem({
      jobId,
      driveId: outputPath,
      title: audio.title,
      description: audio.description,
      tags: audio.tags,
      scheduledAt: null,
      status: "pending",
      youtubeUrl: null,
      youtubeId: null,
      error: null,
      thumbnailPath,
    });

    emitJobUpdate({ jobId, jobType: "process", status: "running", message: `[${slotLabel}] Uploading to YouTube…`, progress: 88 });
    await processQueueItem(queueItem.id, tokens);

    addLog("schedule", "success", `Auto-cycle [${slotLabel}] [${chosenCategory}] complete: "${audio.title}"`);
    emitJobUpdate({ jobId, jobType: "process", status: "done", message: `[${slotLabel}] Done! [${chosenCategory}]`, progress: 100 });

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

    // ── Auto-retry: re-queue failed items after 30 min ─────────────────────────
    if (settings.autoRetryEnabled) {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      const maxRetries = settings.maxRetries ?? 3;
      const retryItems = getQueue().filter(
        (q) =>
          q.status === "failed" &&
          (q.retryCount ?? 0) < maxRetries &&
          (!q.lastRetryAt || new Date(q.lastRetryAt) < thirtyMinAgo)
      );
      for (const item of retryItems) {
        const newCount = (item.retryCount ?? 0) + 1;
        updateQueueItem(item.id, {
          status: "pending",
          error: null,
          retryCount: newCount,
          lastRetryAt: new Date().toISOString(),
        });
        addLog("upload", "info", `Auto-retry ${newCount}/${maxRetries}: "${item.title}"`);
        processQueueItem(item.id, tokens).catch(() => {});
      }
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
