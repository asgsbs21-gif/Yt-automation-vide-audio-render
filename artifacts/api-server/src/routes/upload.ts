import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
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
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";

const router = Router();

// ── Local storage dirs ────────────────────────────────────────────────────────

const VIDEO_DIR = path.resolve(process.cwd(), "data", "videos");
const AUDIO_DIR = path.resolve(process.cwd(), "data", "audios");
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

// ── POST /api/upload/video — device upload ────────────────────────────────────
// Always saves locally. Drive upload is a separate manual step.

router.post("/upload/video", videoUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const category = (req.body.category as string) || "Uncategorized";

  const video = addVideo({
    driveId: file.path,   // local path
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
// Always saves locally. Drive upload is a separate manual step.

router.post("/upload/audio", audioUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const category = (req.body.category as string) || null;
  const title = (req.body.title as string)?.trim() || path.parse(file.originalname).name;

  const audio = addAudio({
    driveId: file.path,   // local path
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

// ── POST /api/drive/save-video/:id ───────────────────────────────────────────
// Uploads local file to Drive, adds driveLink — local file is KEPT.

router.post("/drive/save-video/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "Google account not connected. Click 'Connect Google' in the sidebar.", requiresAuth: true });
    return;
  }

  const video = getVideos().find((v) => v.id === req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  if (video.driveLink) { res.status(400).json({ error: "Already saved to Drive" }); return; }

  // driveId here is the local path (always set after download/upload)
  const localPath = video.driveId;
  if (!fs.existsSync(localPath)) {
    res.status(404).json({ error: "Local file not found — the file may have been deleted from the server." });
    return;
  }

  const settings = getSettings();
  const folderId = settings.driveVideoFolderId;
  if (!folderId) {
    res.status(400).json({ error: "No Drive video folder configured. Set it in Settings → Google Drive Folder IDs." });
    return;
  }

  try {
    const auth = createAuthenticatedClient(tokens);
    const driveFile = await uploadFileToDrive(auth, localPath, folderId, "video/mp4", video.filename);

    // Only update the driveLink — keep driveId as local path, keep local file
    const updated = updateVideo(req.params.id, { driveLink: driveFile.webViewLink });
    addLog("upload", "success", `Saved to Drive: ${video.filename}`);
    res.json(updated);
  } catch (err) {
    addLog("upload", "error", `Drive save failed: ${video.filename}`, String(err));
    res.status(500).json({ error: "Drive upload failed", details: String(err) });
  }
});

// ── POST /api/drive/save-audio/:id ───────────────────────────────────────────
// Uploads local file to Drive, adds driveLink — local file is KEPT.

router.post("/drive/save-audio/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "Google account not connected. Click 'Connect Google' in the sidebar.", requiresAuth: true });
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
    res.status(400).json({ error: "No Drive audio folder configured. Set it in Settings → Google Drive Folder IDs." });
    return;
  }

  try {
    const auth = createAuthenticatedClient(tokens);
    const ext = path.extname(localPath) || ".mp3";
    const driveFile = await uploadFileToDrive(auth, localPath, folderId, "audio/mpeg", `${audio.title}${ext}`);

    // Only update the driveLink — keep local file
    const updated = updateAudio(req.params.id, { driveLink: driveFile.webViewLink });
    addLog("upload", "success", `Saved to Drive: ${audio.title}`);
    res.json(updated);
  } catch (err) {
    addLog("upload", "error", `Drive save failed: ${audio.title}`, String(err));
    res.status(500).json({ error: "Drive upload failed", details: String(err) });
  }
});

export default router;
