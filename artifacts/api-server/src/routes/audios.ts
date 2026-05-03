import { Router } from "express";
import path from "path";
import fs from "fs";
import { getAudios, saveAudios, addLog } from "../services/data.js";

const router = Router();

// GET /api/audios
router.get("/audios", (_req, res) => {
  const audios = getAudios().map((a) => {
    const localExists = a.driveId ? fs.existsSync(a.driveId) : false;
    let fileSize: number | null = null;
    if (localExists) {
      try { fileSize = fs.statSync(a.driveId).size; } catch {}
    }
    return { ...a, localExists, fileSize };
  });
  res.json(audios);
});

// DELETE /api/audios/:id
router.delete("/audios/:id", (req, res) => {
  const audios = getAudios();
  const idx = audios.findIndex((a) => a.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Audio not found" }); return; }

  const audio = audios[idx];

  if (audio.driveId && fs.existsSync(audio.driveId)) {
    try { fs.unlinkSync(audio.driveId); } catch (e) {
      addLog("download_audio", "warn", `Could not delete local file`, String(e));
    }
  }

  audios.splice(idx, 1);
  saveAudios(audios);

  addLog("download_audio", "info", `Deleted audio: ${audio.title}`);
  res.json({ success: true });
});

// GET /api/audios/:id/file — serve the local audio file
router.get("/audios/:id/file", (req, res) => {
  const audio = getAudios().find((a) => a.id === req.params.id);
  if (!audio) { res.status(404).json({ error: "Audio not found" }); return; }

  const filePath = audio.driveId;
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Local file not found" });
    return;
  }

  const ext = path.extname(filePath).slice(1).toLowerCase() || "mp3";
  const mime: Record<string, string> = {
    mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg",
    wav: "audio/wav", flac: "audio/flac", webm: "audio/webm",
  };

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Length": stat.size,
    "Content-Type": mime[ext] || "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${encodeURIComponent(path.basename(filePath))}"`,
  });
  fs.createReadStream(filePath).pipe(res);
});

export default router;
