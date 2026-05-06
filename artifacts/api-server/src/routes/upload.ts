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
import { uploadFileToDrive, uploadFileToDriveWithSpeed } from "../services/drive.js";
import { muteVideo } from "../services/ffmpeg.js";
import { createAuthenticatedClient } from "../services/auth.js";
import { getSessionTokens } from "../middlewares/auth.js";
import { emitJobUpdate } from "../lib/socket.js";

const router = Router();

// ── Permanent local storage dirs (fallback when Drive not configured) ─────────

const DATA_DIR = path.resolve(process.cwd(), "data");
const VIDEO_DIR = path.resolve(process.cwd(), "data", "videos");
const AUDIO_DIR = path.resolve(process.cwd(), "data", "audios");
const WATERMARK_PATH = path.join(DATA_DIR, "watermark.png");
fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

function safeMoveToLocal(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    try { fs.unlinkSync(src); } catch {}
  }
}

// ── Multer: always write to /tmp first ────────────────────────────────────────
// If Drive is configured, we stream from /tmp → Drive and delete the tmp file.
// If not, we move from /tmp → data/videos/ (permanent local storage).

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
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
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
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
// 1. Multer writes to /tmp.
// 2. Register video immediately (responds with video object).
// 3. Background: stream /tmp → Drive at full speed, update driveId + driveLink, delete /tmp.
// 4. If Drive not configured: move /tmp → data/videos/ (local fallback).

router.post("/upload/video", videoUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const tokens = getSessionTokens(req);
  const settings = getSettings();
  const driveFolder = settings.driveVideoFolderId;
  const hasDrive = !!(tokens && driveFolder);

  const category = (req.body.category as string) || "Uncategorized";
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);

  // Register with tmp path immediately — background job will update driveId
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

  addLog("download_video", "info", `Device upload received: ${file.originalname} (${fileSizeMB} MB)`);
  res.json(video);

  if (hasDrive) {
    // ── Background: stream to Drive ──────────────────────────────────────────
    const jobId = `upload_${uuidv4().slice(0, 8)}`;
    (async () => {
      try {
        emitJobUpdate({
          jobId,
          jobType: "upload",
          status: "running",
          message: `Uploading ${file.originalname} (${fileSizeMB} MB) to Drive…`,
          progress: 0,
        });

        const auth = createAuthenticatedClient(tokens!);
        const driveFile = await uploadFileToDriveWithSpeed(
          auth,
          file.path,
          driveFolder!,
          "video/mp4",
          file.originalname,
          (pct, _mbps, msg) => {
            emitJobUpdate({
              jobId,
              jobType: "upload",
              status: "running",
              message: msg,
              progress: pct,
            });
          }
        );

        updateVideo(video.id, { driveId: driveFile.id, driveLink: driveFile.webViewLink });
        try { fs.unlinkSync(file.path); } catch {}

        addLog("download_video", "success", `${file.originalname} → Drive (${fileSizeMB} MB)`);
        emitJobUpdate({
          jobId,
          jobType: "upload",
          status: "done",
          message: `Saved to Drive: ${file.originalname}`,
          progress: 100,
        });

      } catch (err) {
        const msg = String(err);
        addLog("upload", "error", `Drive upload failed for ${file.originalname}`, msg);
        emitJobUpdate({
          jobId,
          jobType: "upload",
          status: "error",
          message: `Drive upload failed: ${msg.slice(0, 120)}`,
          progress: 0,
        });

        // Fallback: move /tmp → permanent local storage so the record stays valid
        try {
          const destPath = path.join(VIDEO_DIR, file.filename);
          safeMoveToLocal(file.path, destPath);
          updateVideo(video.id, { driveId: destPath });
        } catch {}
      }
    })();

  } else {
    // ── No Drive: move to permanent local storage synchronously ──────────────
    try {
      const destPath = path.join(VIDEO_DIR, file.filename);
      safeMoveToLocal(file.path, destPath);
      updateVideo(video.id, { driveId: destPath });
    } catch (err) {
      addLog("download_video", "error", `Failed to move video to local storage`, String(err));
    }
  }
});

// ── POST /api/upload/audio — device upload ────────────────────────────────────

router.post("/upload/audio", audioUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const tokens = getSessionTokens(req);
  const settings = getSettings();
  const driveFolder = settings.driveAudioFolderId;
  const hasDrive = !!(tokens && driveFolder);

  const category = (req.body.category as string) || null;
  const title = (req.body.title as string)?.trim() || path.parse(file.originalname).name;
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);

  let audioDuration = 0;
  try {
    const { execSync } = await import("child_process");
    const bins = ["/home/runner/workspace/bin/ffprobe", "/usr/bin/ffprobe", "ffprobe"];
    for (const bin of bins) {
      try {
        const r = execSync(`"${bin}" -v quiet -show_entries format=duration -of csv=p=0 "${file.path}"`, {encoding:"utf8",timeout:8000}).trim();
        const d = parseFloat(r);
        if (!isNaN(d) && d > 0) { audioDuration = d; break; }
      } catch {}
    }
  } catch {}

  const audio = addAudio({
    driveId: file.path,
    title,
    description: "",
    tags: [],
    duration: audioDuration,
    category,
    uploader: null,
    used: false,
    driveLink: null,
  });

  addLog("download_audio", "info", `Device upload received: ${file.originalname} (${fileSizeMB} MB)`);
  res.json(audio);

  if (hasDrive) {
    const jobId = `upload_${uuidv4().slice(0, 8)}`;
    (async () => {
      try {
        emitJobUpdate({
          jobId,
          jobType: "upload",
          status: "running",
          message: `Uploading "${title}" (${fileSizeMB} MB) to Drive…`,
          progress: 0,
        });

        const auth = createAuthenticatedClient(tokens!);
        const ext = path.extname(file.originalname) || ".mp3";
        const driveFilename = `${title}${ext}`.replace(/[/\\?%*:|"<>]/g, "_");

        const driveFile = await uploadFileToDriveWithSpeed(
          auth,
          file.path,
          driveFolder!,
          "audio/mpeg",
          driveFilename,
          (pct, _mbps, msg) => {
            emitJobUpdate({
              jobId,
              jobType: "upload",
              status: "running",
              message: msg,
              progress: pct,
            });
          }
        );

        updateAudio(audio.id, { driveId: driveFile.id, driveLink: driveFile.webViewLink });
        try { fs.unlinkSync(file.path); } catch {}

        addLog("download_audio", "success", `"${title}" → Drive (${fileSizeMB} MB)`);
        emitJobUpdate({
          jobId,
          jobType: "upload",
          status: "done",
          message: `Saved to Drive: "${title}"`,
          progress: 100,
        });

      } catch (err) {
        const msg = String(err);
        addLog("upload", "error", `Drive upload failed for "${title}"`, msg);
        emitJobUpdate({
          jobId,
          jobType: "upload",
          status: "error",
          message: `Drive upload failed: ${msg.slice(0, 120)}`,
          progress: 0,
        });

        try {
          const destPath = path.join(AUDIO_DIR, file.filename);
          safeMoveToLocal(file.path, destPath);
          updateAudio(audio.id, { driveId: destPath });
        } catch {}
      }
    })();

  } else {
    try {
      const destPath = path.join(AUDIO_DIR, file.filename);
      safeMoveToLocal(file.path, destPath);
      updateAudio(audio.id, { driveId: destPath });
    } catch (err) {
      addLog("download_audio", "error", `Failed to move audio to local storage`, String(err));
    }
  }
});

// ── POST /api/upload/watermark — upload PNG watermark ────────────────────────
// Watermark always stays local (used by FFmpeg at process time).

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

// ── HEAD /api/watermark — check if watermark exists ──────────────────────────

router.head("/watermark", (_req, res) => {
  if (!fs.existsSync(WATERMARK_PATH)) { res.status(404).end(); return; }
  res.status(200).end();
});

// ── DELETE /api/watermark — remove watermark ──────────────────────────────────

router.delete("/watermark", (_req, res) => {
  if (fs.existsSync(WATERMARK_PATH)) { try { fs.unlinkSync(WATERMARK_PATH); } catch {} }
  res.json({ success: true });
});

// ── POST /api/videos/:id/mute-and-drive ──────────────────────────────────────
// 1. Strip audio from local video using FFmpeg (fast stream-copy, no re-encode)
// 2. Stream muted file to Google Drive at full speed with progress
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

  // Only works on locally stored files
  const localPath = video.driveId.startsWith("/") ? video.driveId : null;
  if (!localPath || !fs.existsSync(localPath)) {
    res.status(404).json({ error: "Local file not found — video is Drive-only and cannot be re-processed here." });
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

      emitJobUpdate({ jobId, jobType: "process", status: "running", message: "Streaming to Google Drive…", progress: 60 });

      const auth = createAuthenticatedClient(tokens);
      const driveFile = await uploadFileToDriveWithSpeed(
        auth,
        mutedPath,
        folderId,
        "video/mp4",
        mutedFilename,
        (pct, _mbps, msg) => {
          emitJobUpdate({
            jobId,
            jobType: "process",
            status: "running",
            message: `Drive: ${msg}`,
            progress: 60 + Math.round(pct * 0.39),
          });
        }
      );

      updateVideo(req.params.id, { driveLink: driveFile.webViewLink });

      addLog("upload", "success", `Muted & streamed to Drive: ${mutedFilename}`);
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
// Stream local file to Drive as-is (no muting) with speed tracking.

router.post("/drive/save-video/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "Google account not connected.", requiresAuth: true });
    return;
  }

  const video = getVideos().find((v) => v.id === req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  if (video.driveLink) { res.status(400).json({ error: "Already saved to Drive" }); return; }

  const localPath = video.driveId.startsWith("/") ? video.driveId : null;
  if (!localPath || !fs.existsSync(localPath)) {
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
// Stream local audio to Drive with speed tracking.

router.post("/drive/save-audio/:id", async (req, res) => {
  const tokens = getSessionTokens(req);
  if (!tokens) {
    res.status(401).json({ error: "Google account not connected.", requiresAuth: true });
    return;
  }

  const audio = getAudios().find((a) => a.id === req.params.id);
  if (!audio) { res.status(404).json({ error: "Audio not found" }); return; }
  if (audio.driveLink) { res.status(400).json({ error: "Already saved to Drive" }); return; }

  const localPath = audio.driveId.startsWith("/") ? audio.driveId : null;
  if (!localPath || !fs.existsSync(localPath)) {
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
