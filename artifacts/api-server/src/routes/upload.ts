import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import {
  addVideo,
  addAudio,
  updateVideo,
  updateAudio,
  getVideos,
  getAudios,
  getSettings,
  addLog,
} from "../services/data.js";
import { uploadFileToDrive } from "../services/drive.js";
import { muteVideo } from "../services/ffmpeg.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

// ── Local storage dirs ────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "data");
const VIDEO_DIR = path.resolve(process.cwd(), "data", "videos");
const AUDIO_DIR = path.resolve(process.cwd(), "data", "audios");
const WATERMARK_PATH = path.join(DATA_DIR, "watermark.png");
fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ── Multer config ─────────────────────────────────────────────────────────────

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VIDEO_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp4";
      cb(null, `video_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) return cb(null, true);
    cb(new Error("Only video files are allowed"));
  },
});

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp3";
      cb(null, `audio_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) return cb(null, true);
    cb(new Error("Only audio files are allowed"));
  },
});

const watermarkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(DATA_DIR, { recursive: true }); cb(null, DATA_DIR); },
    filename: (_req, _file, cb) => cb(null, "watermark.png"),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png") return cb(null, true);
    cb(new Error("Only PNG files are allowed for watermark"));
  },
});

// ── POST /api/upload/video — device upload ────────────────────────────────────
// Multer writes directly to VIDEO_DIR (no cross-device rename). Saved locally only.

router.post("/upload/video", videoUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const category = (req.body.category as string) || "Uncategorized";
  const video = addVideo({
    driveId: file.path,
    filename: file.filename,
    category,
    usedCount: 0,
    lastUsed: null,
    available: true,
    driveLink: null,
    status: "available",
  });

  addLog("download_video", "success", `Uploaded from device: ${file.filename} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  res.json(video);
});

// ── POST /api/upload/audio — device upload ────────────────────────────────────

router.post("/upload/audio", audioUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const category = (req.body.category as string) || null;
  const title = (req.body.title as string)?.trim() || path.parse(file.originalname).name;
  const audio = addAudio({
    driveId: file.path,
    title,
    description: "",
    tags: [],
    duration: 0,
    category,
    uploader: null,
    used: false,
    driveLink: null,
  });

  addLog("download_audio", "success", `Uploaded from device: ${file.filename}`);
  res.json(audio);
});

// ── POST /api/upload/watermark — upload PNG watermark ────────────────────────

router.post("/upload/watermark", watermarkUpload.single("file"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No PNG file uploaded" }); return; }
  addLog("process", "info", `Watermark uploaded: ${(req.file.size / 1024).toFixed(1)} KB`);
  res.json({ success: true, size: req.file.size });
});

// ── GET /api/watermark — serve current watermark PNG ─────────────────────────

router.get("/watermark", (_req, res) => {
  if (!fs.existsSync(WATERMARK_PATH)) { res.status(404).json({ error: "No watermark uploaded" }); return; }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(WATERMARK_PATH).pipe(res);
});

// ── DELETE /api/watermark — remove watermark ──────────────────────────────────

router.delete("/watermark", (_req, res) => {
  if (fs.existsSync(WATERMARK_PATH)) { try { fs.unlinkSync(WATERMARK_PATH); } catch {} }
  res.json({ success: true });
});

// ── POST /api/videos/:id/mute-and-drive ──────────────────────────────────────
// 1. Strip audio from local video using FFmpeg (fast stream-copy, no re-encode)
// 2. Upload muted file to Google Drive
// 3. Update driveLink on the video record
// 4. Local original file is NOT modified or deleted

router.post("/videos/:id/mute-and-drive", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({
      error: "Google account not connected. Click 'Connect Google' in the sidebar.",
      requiresAuth: true,
    });
    return;
  }

  const video = getVideos().find((v) => v.id === req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const localPath = video.driveId;
  if (!fs.existsSync(localPath)) {
    res.status(404).json({ error: "Local file not found — it may have been deleted." });
    return;
  }

  const settings = getSettings();
  const folderId = settings.driveVideoFolderId;
  if (!folderId) {
    res.status(400).json({ error: "No Drive video folder configured. Set it in Settings → Google Drive Folder IDs." });
    return;
  }

  const jobId = `mute_${uuidv4().slice(0, 8)}`;
  res.json({ jobId, message: "Mute & Drive upload started", status: "started" });

  (async () => {
    const base = path.parse(video.filename).name;
    const mutedFilename = `${base}_muted.mp4`;
    const mutedPath = path.join(os.tmpdir(), mutedFilename);

    try {
      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Stripping audio…", progress: 10 });

      await muteVideo(localPath, mutedPath, (p, m) => {
        emitJobUpdate({ jobId, jobType: "process", status: "running", message: m, progress: p });
      });

      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Uploading to Google Drive…", progress: 95 });

      const auth = createAuthenticatedClient(tokens);
      const driveFile = await uploadFileToDrive(auth, mutedPath, folderId, "video/mp4", mutedFilename);

      updateVideo(req.params.id, { driveLink: driveFile.webViewLink });

      addLog("upload", "success", `Muted & uploaded to Drive: ${mutedFilename}`);
      emitJobUpdate({ jobId, jobType: "process", status: "done", message: `Uploaded: ${mutedFilename}`, progress: 100 });
    } catch (err) {
      const msg = String(err);
      addLog("upload", "error", `Mute & Drive failed for ${video.filename}`, msg);
      emitJobUpdate({ jobId, jobType: "process", status: "error", message: `Failed: ${msg.slice(0, 120)}`, progress: 0 });
    } finally {
      try { fs.unlinkSync(mutedPath); } catch {}
    }
  })();
});

// ── POST /api/drive/save-video/:id ───────────────────────────────────────────
// Upload local file to Drive as-is (no muting). Local file is KEPT.

router.post("/drive/save-video/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "Google account not connected.", requiresAuth: true });
    return;
  }

  const video = getVideos().find((v) => v.id === req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  if (video.driveLink) { res.status(400).json({ error: "Already saved to Drive" }); return; }

  const localPath = video.driveId;
  if (!fs.existsSync(localPath)) {
    res.status(404).json({ error: "Local file not found." });
    return;
  }

  const settings = getSettings();
  const folderId = settings.driveVideoFolderId;
  if (!folderId) {
    res.status(400).json({ error: "No Drive video folder configured. Set it in Settings." });
    return;
  }

  try {
    const auth = createAuthenticatedClient(tokens);
    const driveFile = await uploadFileToDrive(auth, localPath, folderId, "video/mp4", video.filename);
    const updated = updateVideo(req.params.id, { driveLink: driveFile.webViewLink });
    addLog("upload", "success", `Saved to Drive: ${video.filename}`);
    res.json(updated);
  } catch (err) {
    addLog("upload", "error", `Drive save failed: ${video.filename}`, String(err));
    res.status(500).json({ error: "Drive upload failed", details: String(err) });
  }
});

// ── POST /api/drive/save-audio/:id ───────────────────────────────────────────
// Upload local audio to Drive. Local file is KEPT.

router.post("/drive/save-audio/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "Google account not connected.", requiresAuth: true });
    return;
  }

  const audio = getAudios().find((a) => a.id === req.params.id);
  if (!audio) { res.status(404).json({ error: "Audio not found" }); return; }
  if (audio.driveLink) { res.status(400).json({ error: "Already saved to Drive" }); return; }

  const localPath = audio.driveId;
  if (!fs.existsSync(localPath)) {
    res.status(404).json({ error: "Local file not found." });
    return;
  }

  const settings = getSettings();
  const folderId = settings.driveAudioFolderId;
  if (!folderId) {
    res.status(400).json({ error: "No Drive audio folder configured. Set it in Settings." });
    return;
  }

  try {
    const auth = createAuthenticatedClient(tokens);
    const ext = path.extname(localPath) || ".mp3";
    const driveFile = await uploadFileToDrive(auth, localPath, folderId, "audio/mpeg", `${audio.title}${ext}`);
    const updated = updateAudio(req.params.id, { driveLink: driveFile.webViewLink });
    addLog("upload", "success", `Saved to Drive: ${audio.title}`);
    res.json(updated);
  } catch (err) {
    addLog("upload", "error", `Drive save failed: ${audio.title}`, String(err));
    res.status(500).json({ error: "Drive upload failed", details: String(err) });
  }
});

export default router;
