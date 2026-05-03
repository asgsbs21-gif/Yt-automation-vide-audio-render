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

// Local storage dirs
const VIDEO_LOCAL_DIR = path.resolve(process.cwd(), "data", "videos");
const AUDIO_LOCAL_DIR = path.resolve(process.cwd(), "data", "audios");
fs.mkdirSync(VIDEO_LOCAL_DIR, { recursive: true });
fs.mkdirSync(AUDIO_LOCAL_DIR, { recursive: true });

// Multer config — disk storage, 500MB limit
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VIDEO_LOCAL_DIR),
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
    destination: (_req, _file, cb) => cb(null, AUDIO_LOCAL_DIR),
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

// ── POST /api/upload/video ────────────────────────────────────────────────────

router.post("/upload/video", videoUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const category = (req.body.category as string) || "Uncategorized";
  const settings = getSettings();
  const tokens = getSessionTokens(req);

  let driveId = file.path;
  let driveLink: string | null = null;

  // If Drive folder configured and user is connected, upload there
  const folderId = settings.driveVideoFolderId;
  if (folderId && tokens) {
    try {
      const auth = createAuthenticatedClient(tokens);
      const driveFile = await uploadFileToDrive(auth, file.path, folderId, file.mimetype, file.filename);
      driveId = driveFile.id;
      driveLink = driveFile.webViewLink;
      fs.unlinkSync(file.path); // remove local copy after Drive upload
    } catch (err) {
      addLog("upload", "warn", "Drive upload failed, keeping local copy", String(err));
    }
  }

  const video = addVideo({
    driveId,
    filename: file.filename,
    category,
    usedCount: 0,
    lastUsed: null,
    available: true,
    driveLink,
    status: "available",
  });

  addLog("download_video", "success", `Uploaded from device: ${file.filename}`);
  res.json(video);
});

// ── POST /api/upload/audio ────────────────────────────────────────────────────

router.post("/upload/audio", audioUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const category = (req.body.category as string) || null;
  const title = (req.body.title as string) || path.parse(file.originalname).name;
  const settings = getSettings();
  const tokens = getSessionTokens(req);

  let driveId = file.path;
  let driveLink: string | null = null;

  const folderId = settings.driveAudioFolderId;
  if (folderId && tokens) {
    try {
      const auth = createAuthenticatedClient(tokens);
      const driveFile = await uploadFileToDrive(auth, file.path, folderId, file.mimetype, file.filename);
      driveId = driveFile.id;
      driveLink = driveFile.webViewLink;
      fs.unlinkSync(file.path);
    } catch (err) {
      addLog("upload", "warn", "Drive upload failed, keeping local copy", String(err));
    }
  }

  const audio = addAudio({
    driveId,
    title,
    description: "",
    tags: [],
    duration: 0,
    category,
    uploader: null,
    used: false,
    driveLink,
  });

  addLog("download_audio", "success", `Uploaded from device: ${file.filename}`);
  res.json(audio);
});

// ── POST /api/drive/save-video/:id ────────────────────────────────────────────

router.post("/drive/save-video/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({
      error: "Google account not connected. Click 'Connect Google' in the sidebar first.",
      requiresAuth: true,
    });
    return;
  }

  const { id } = req.params;
  const videos = getVideos();
  const video = videos.find((v) => v.id === id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  if (video.driveLink) {
    res.status(400).json({ error: "Video is already saved to Drive" });
    return;
  }

  if (!fs.existsSync(video.driveId)) {
    res.status(404).json({ error: "Local file not found" });
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
    const driveFile = await uploadFileToDrive(auth, video.driveId, folderId, "video/mp4", video.filename);
    const updated = updateVideo(id, { driveId: driveFile.id, driveLink: driveFile.webViewLink });
    // Clean up local file after upload
    try { fs.unlinkSync(video.driveId); } catch {}
    addLog("upload", "success", `Saved to Drive: ${video.filename}`);
    res.json(updated);
  } catch (err) {
    addLog("upload", "error", `Drive save failed: ${video.filename}`, String(err));
    res.status(500).json({ error: "Failed to upload to Drive", details: String(err) });
  }
});

// ── POST /api/drive/save-audio/:id ────────────────────────────────────────────

router.post("/drive/save-audio/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({
      error: "Google account not connected. Click 'Connect Google' in the sidebar first.",
      requiresAuth: true,
    });
    return;
  }

  const { id } = req.params;
  const audios = getAudios();
  const audio = audios.find((a) => a.id === id);
  if (!audio) {
    res.status(404).json({ error: "Audio not found" });
    return;
  }

  if (audio.driveLink) {
    res.status(400).json({ error: "Audio is already saved to Drive" });
    return;
  }

  if (!fs.existsSync(audio.driveId)) {
    res.status(404).json({ error: "Local file not found" });
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
    const ext = path.extname(audio.driveId) || ".mp3";
    const filename = `${audio.title}${ext}`;
    const driveFile = await uploadFileToDrive(auth, audio.driveId, folderId, "audio/mpeg", filename);
    const updated = updateAudio(id, { driveId: driveFile.id, driveLink: driveFile.webViewLink });
    try { fs.unlinkSync(audio.driveId); } catch {}
    addLog("upload", "success", `Saved to Drive: ${audio.title}`);
    res.json(updated);
  } catch (err) {
    addLog("upload", "error", `Drive save failed: ${audio.title}`, String(err));
    res.status(500).json({ error: "Failed to upload to Drive", details: String(err) });
  }
});

export default router;
