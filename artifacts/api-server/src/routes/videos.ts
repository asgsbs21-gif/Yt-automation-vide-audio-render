import { Router } from "express";
import path from "path";
import fs from "fs";
import { getVideos, updateVideo, saveVideos, addLog } from "../services/data.js";

const router = Router();

// GET /api/videos
router.get("/videos", (_req, res) => {
  const videos = getVideos().map((v) => {
    const localExists = v.driveId ? fs.existsSync(v.driveId) : false;
    let fileSize: number | null = null;
    if (localExists) {
      try { fileSize = fs.statSync(v.driveId).size; } catch {}
    }
    return { ...v, localExists, fileSize };
  });
  res.json(videos);
});

// PATCH /api/videos/:id/category
router.patch("/videos/:id/category", (req, res) => {
  const { category } = req.body as { category: string };
  if (!category) { res.status(400).json({ error: "category is required" }); return; }
  const updated = updateVideo(req.params.id, { category });
  if (!updated) { res.status(404).json({ error: "Video not found" }); return; }
  res.json(updated);
});

// DELETE /api/videos/:id
router.delete("/videos/:id", (req, res) => {
  const videos = getVideos();
  const idx = videos.findIndex((v) => v.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Video not found" }); return; }

  const video = videos[idx];

  if (video.driveId && fs.existsSync(video.driveId)) {
    try { fs.unlinkSync(video.driveId); } catch (e) {
      addLog("download_video", "warn", `Could not delete local file: ${video.driveId}`, String(e));
    }
  }

  videos.splice(idx, 1);
  saveVideos(videos);

  addLog("download_video", "info", `Deleted video: ${video.filename}`);
  res.json({ success: true });
});

// GET /api/videos/:id/file — stream the local file with range support
router.get("/videos/:id/file", (req, res) => {
  const video = getVideos().find((v) => v.id === req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const filePath = video.driveId;
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Local file not found" });
    return;
  }

  const ext = path.extname(filePath).slice(1).toLowerCase() || "mp4";
  const mime: Record<string, string> = {
    mp4: "video/mp4", mkv: "video/x-matroska",
    webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo",
  };

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": mime[ext] || "video/mp4",
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": mime[ext] || "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${encodeURIComponent(video.filename)}"`,
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
