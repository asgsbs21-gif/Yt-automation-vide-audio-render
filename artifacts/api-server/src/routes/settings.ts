import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { getSettings, saveSettings, addLog } from "../services/data.js";

const router = Router();
const DATA_DIR = path.resolve(process.cwd(), "data");
const COOKIE_PATH = path.join(DATA_DIR, "cookies.txt");

const cookieUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DATA_DIR),
    filename: (_req, _file, cb) => cb(null, "cookies.txt"),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// GET /api/settings
router.get("/settings", (req, res) => {
  const settings = getSettings();
  res.json({
    ...settings,
    hasCookie: fs.existsSync(COOKIE_PATH),
  });
});

// PATCH /api/settings
router.patch("/settings", (req, res) => {
  const current = getSettings();
  const patch = req.body as Partial<typeof current>;
  const updated = { ...current, ...patch };
  saveSettings(updated);
  res.json({
    ...updated,
    hasCookie: fs.existsSync(COOKIE_PATH),
  });
});

router.post("/settings/cookies", cookieUpload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No cookies.txt uploaded" });
    return;
  }
  addLog("upload", "success", "YouTube cookies uploaded");
  res.json({ success: true, hasCookie: true });
});

router.delete("/settings/cookies", (_req, res) => {
  if (fs.existsSync(COOKIE_PATH)) {
    try { fs.unlinkSync(COOKIE_PATH); } catch {}
  }
  addLog("upload", "info", "YouTube cookies removed");
  res.json({ success: true, hasCookie: false });
});

export default router;
