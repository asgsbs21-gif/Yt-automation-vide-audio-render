import { Router } from "express";
import path from "path";
import fs from "fs";
import { getQueue, updateQueueItem, addLog } from "../services/data.js";
import { processQueueItem } from "../services/scheduler.js";
import { getSessionTokens } from "../middlewares/auth.js";

const router = Router();

// GET /api/queue
router.get("/queue", (_req, res) => {
  // Enrich each item with whether its local file exists and its size
  const queue = getQueue().map((item) => {
    const localExists = item.driveId.startsWith("/") && fs.existsSync(item.driveId);
    let fileSize: number | null = null;
    if (localExists) {
      try { fileSize = fs.statSync(item.driveId).size; } catch {}
    }
    return { ...item, localExists, fileSize };
  });
  res.json(queue);
});

// GET /api/queue/:id/preview — stream the local output file with range support
router.get("/queue/:id/preview", (req, res) => {
  const item = getQueue().find((q) => q.id === req.params.id);
  if (!item) { res.status(404).json({ error: "Queue item not found" }); return; }

  const filePath = item.driveId;
  if (!filePath.startsWith("/") || !fs.existsSync(filePath)) {
    res.status(404).json({
      error: "Local file not found. This item may be stored on Google Drive only.",
    });
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || "mp4";
  const mime: Record<string, string> = {
    mp4: "video/mp4", mkv: "video/x-matroska",
    webm: "video/webm", mov: "video/quicktime",
  };
  const contentType = mime[ext] || "video/mp4";

  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${encodeURIComponent(path.basename(filePath))}"`,
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// POST /api/schedule
router.post("/schedule", (req, res) => {
  const { queueItemId, scheduledAt } = req.body as { queueItemId: string; scheduledAt: string };

  if (!queueItemId || !scheduledAt) {
    res.status(400).json({ error: "queueItemId and scheduledAt are required" });
    return;
  }

  const updated = updateQueueItem(queueItemId, { scheduledAt, status: "scheduled" });
  if (!updated) { res.status(404).json({ error: "Queue item not found" }); return; }

  addLog("schedule", "info", `Scheduled: "${updated.title}" at ${scheduledAt}`);
  res.json(updated);
});

// POST /api/upload-now — requires Google auth
router.post("/upload-now", async (req, res) => {
  const { queueItemId } = req.body as { queueItemId: string };
  if (!queueItemId) { res.status(400).json({ error: "queueItemId is required" }); return; }

  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({
      error: "Google account not connected. Click 'Connect Google' in the sidebar first.",
      requiresAuth: true,
    });
    return;
  }

  addLog("upload", "info", `Immediate upload requested [${queueItemId}]`);
  res.json({ jobId: queueItemId, message: "Upload started", status: "started" });

  processQueueItem(queueItemId, tokens).catch((err) => {
    addLog("upload", "error", `Upload failed [${queueItemId}]`, String(err));
  });
});

export default router;
