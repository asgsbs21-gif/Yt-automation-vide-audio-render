import cron from "node-cron";
import os from "os";
import path from "path";
import fs from "fs";
import {
  getSettings,
  getQueue,
  updateQueueItem,
  addLog,
} from "./data.js";
import { createOAuth2Client } from "./auth.js";
import { downloadFromDrive } from "./drive.js";
import { uploadToYouTube } from "./youtube.js";

let schedulerTask: cron.ScheduledTask | null = null;

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

  const auth = createOAuth2Client();
  auth.setCredentials(tokens);

  const settings = getSettings();
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `output_${Date.now()}.mp4`);

  try {
    await downloadFromDrive(auth, item.driveId, tmpFile);
    const { youtubeId, youtubeUrl } = await uploadToYouTube(auth, {
      title: item.title,
      description: item.description,
      tags: item.tags,
      categoryId: settings.youtubeCategoryId,
      filePath: tmpFile,
      scheduledAt: item.scheduledAt,
    });

    updateQueueItem(itemId, {
      status: "uploaded",
      youtubeId,
      youtubeUrl,
    });

    addLog("upload", "success", `Uploaded: ${item.title} → ${youtubeUrl}`);
  } catch (err) {
    const msg = String(err);
    updateQueueItem(itemId, { status: "failed", error: msg });
    addLog("upload", "error", `Upload failed: ${item.title}`, msg);
    throw err;
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

// ── Start the daily scheduler ─────────────────────────────────────────────────

export function startScheduler(
  getTokens: () => {
    access_token: string;
    refresh_token?: string | null;
  } | null
): void {
  if (schedulerTask) {
    schedulerTask.stop();
  }

  // Run every minute to check for scheduled items
  schedulerTask = cron.schedule("* * * * *", async () => {
    const settings = getSettings();
    if (!settings.autoCycleEnabled) return;

    const tokens = getTokens();
    if (!tokens) return;

    const now = new Date();
    const queue = getQueue();

    // Find items scheduled to be uploaded now (within the last minute)
    const due = queue.filter((item) => {
      if (item.status !== "scheduled" || !item.scheduledAt) return false;
      const scheduled = new Date(item.scheduledAt);
      return scheduled <= now;
    });

    for (const item of due) {
      try {
        await processQueueItem(item.id, tokens);
      } catch {
        // Already logged inside processQueueItem
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
