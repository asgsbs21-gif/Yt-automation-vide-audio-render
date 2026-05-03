import { Router } from "express";
import { google } from "googleapis";
import { getQueue } from "../services/data.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";

const router = Router();

// ── In-memory channel stats cache (30 min TTL) ────────────────────────────────

interface ChannelStats {
  channelTitle: string;
  subscriberCount: string;
  viewCount: string;
  videoCount: string;
  cachedAt: string;
}

let channelStatsCache: { data: ChannelStats; fetchedAt: number } | null = null;
const CHANNEL_CACHE_TTL_MS = 30 * 60 * 1000;

// ── GET /api/upload-stats ─────────────────────────────────────────────────────

router.get("/upload-stats", (_req, res) => {
  const queue = getQueue();
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  function countStats(items: typeof queue) {
    return {
      total: items.length,
      uploaded: items.filter((q) => q.status === "uploaded").length,
      failed: items.filter((q) => q.status === "failed").length,
      pending: items.filter((q) => q.status === "pending" || q.status === "scheduled").length,
    };
  }

  const todayItems = queue.filter((q) => new Date(q.createdAt) >= startOfToday);
  const weekItems = queue.filter((q) => new Date(q.createdAt) >= startOfWeek);

  const nextScheduled =
    queue
      .filter((q) => q.status === "scheduled" && !!q.scheduledAt)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0] ?? null;

  const recentUploads = queue
    .filter((q) => q.status === "uploaded")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
    .map((q) => ({
      id: q.id,
      title: q.title,
      status: q.status,
      youtubeUrl: q.youtubeUrl,
      createdAt: q.createdAt,
    }));

  res.json({
    today: countStats(todayItems),
    week: countStats(weekItems),
    allTime: countStats(queue),
    nextScheduled: nextScheduled
      ? { title: nextScheduled.title, scheduledAt: nextScheduled.scheduledAt }
      : null,
    recentUploads,
  });
});

// ── GET /api/channel-stats ────────────────────────────────────────────────────

router.get("/channel-stats", async (req, res) => {
  if (
    channelStatsCache &&
    Date.now() - channelStatsCache.fetchedAt < CHANNEL_CACHE_TTL_MS
  ) {
    res.json(channelStatsCache.data);
    return;
  }

  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "not_connected" });
    return;
  }

  try {
    const auth = createAuthenticatedClient(tokens);
    const youtube = google.youtube({ version: "v3", auth });

    const response = await youtube.channels.list({
      part: ["statistics", "snippet"],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (!channel) {
      res.status(404).json({ error: "no_channel" });
      return;
    }

    const stats: ChannelStats = {
      channelTitle: channel.snippet?.title ?? "Unknown Channel",
      subscriberCount: channel.statistics?.subscriberCount ?? "0",
      viewCount: channel.statistics?.viewCount ?? "0",
      videoCount: channel.statistics?.videoCount ?? "0",
      cachedAt: new Date().toISOString(),
    };

    channelStatsCache = { data: stats, fetchedAt: Date.now() };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "api_error", message: String(err) });
  }
});

export default router;
