import { Router } from "express";
import { getVideos, getAudios, getQueue } from "../services/data.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { checkDriveConnected } from "../services/drive.js";
import { checkYouTubeConnected } from "../services/youtube.js";
import { getSessionTokens } from "../middlewares/auth.js";

const router = Router();

// GET /api/status
router.get("/status", async (req, res) => {
  const videos = getVideos();
  const audios = getAudios();
  const queue = getQueue();
  const tokens = getSessionTokens(req);

  let driveConnected = false;
  let youtubeConnected = false;

  if (tokens) {
    const auth = createAuthenticatedClient(tokens);
    [driveConnected, youtubeConnected] = await Promise.all([
      checkDriveConnected(auth),
      checkYouTubeConnected(auth),
    ]);
  }

  const categoryMap = new Map<string, { count: number; usedCount: number }>();
  for (const v of videos) {
    const entry = categoryMap.get(v.category) ?? { count: 0, usedCount: 0 };
    entry.count++;
    if (v.usedCount > 0) entry.usedCount++;
    categoryMap.set(v.category, entry);
  }

  const videosByCategory = Array.from(categoryMap.entries()).map(
    ([category, data]) => ({ category, ...data })
  );

  res.json({
    totalVideos: videos.length,
    availableVideos: videos.filter((v) => v.available).length,
    totalAudios: audios.length,
    unusedAudios: audios.filter((a) => !a.used).length,
    queueCount: queue.length,
    scheduledCount: queue.filter((q) => q.status === "scheduled").length,
    uploadedCount: queue.filter((q) => q.status === "uploaded").length,
    driveConnected,
    youtubeConnected,
    activeJobs: 0,
    videosByCategory,
  });
});

export default router;
