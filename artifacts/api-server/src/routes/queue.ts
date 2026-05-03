import { Router } from "express";
import { getQueue, updateQueueItem, addLog } from "../services/data.js";
import { processQueueItem } from "../services/scheduler.js";
import { requireAuth, getSessionTokens } from "../middlewares/auth.js";

const router = Router();

// GET /api/queue
router.get("/queue", requireAuth, (req, res) => {
  res.json(getQueue());
});

// POST /api/schedule
router.post("/schedule", requireAuth, (req, res) => {
  const { queueItemId, scheduledAt } = req.body as {
    queueItemId: string;
    scheduledAt: string;
  };

  if (!queueItemId || !scheduledAt) {
    res.status(400).json({ error: "queueItemId and scheduledAt are required" });
    return;
  }

  const updated = updateQueueItem(queueItemId, {
    scheduledAt,
    status: "scheduled",
  });

  if (!updated) {
    res.status(404).json({ error: "Queue item not found" });
    return;
  }

  addLog("schedule", "info", `Scheduled: "${updated.title}" at ${scheduledAt}`);
  res.json(updated);
});

// POST /api/upload-now
router.post("/upload-now", requireAuth, async (req, res) => {
  const { queueItemId } = req.body as { queueItemId: string };

  if (!queueItemId) {
    res.status(400).json({ error: "queueItemId is required" });
    return;
  }

  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const jobId = queueItemId;
  addLog("upload", "info", `Immediate upload requested [${jobId}]`);
  res.json({ jobId, message: "Upload started", status: "started" });

  processQueueItem(queueItemId, tokens).catch((err) => {
    addLog("upload", "error", `Upload failed [${jobId}]`, String(err));
  });
});

export default router;
