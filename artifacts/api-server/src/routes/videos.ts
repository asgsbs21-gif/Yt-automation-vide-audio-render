import { Router } from "express";
import { getVideos, updateVideo } from "../services/data.js";

const router = Router();

// GET /api/videos
router.get("/videos", (req, res) => {
  let videos = getVideos();
  const { category, status } = req.query;
  if (category) videos = videos.filter((v) => v.category === String(category));
  if (status) videos = videos.filter((v) => v.status === String(status));
  res.json(videos);
});

// PATCH /api/videos/:id/category
router.patch("/videos/:id/category", (req, res) => {
  const { id } = req.params;
  const { category } = req.body as { category: string };
  if (!category) {
    res.status(400).json({ error: "category is required" });
    return;
  }
  const updated = updateVideo(id, { category });
  if (!updated) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json(updated);
});

export default router;
