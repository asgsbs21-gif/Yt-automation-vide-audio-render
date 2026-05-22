import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { getSettings, saveSettings } from "../services/data.js";
import { startXray, stopXray, testProxy, getProxyStatus, decodeLink, isXrayInstalled } from "../services/xray.js";
import { createBulkJob, getBulkJob, listBulkJobs, deleteBulkJob } from "../services/jobManager-bulk.js";

const router = Router();

const COOKIES_PATH = path.resolve(process.cwd(), "data", "cookies.txt");

const cookiesUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.resolve(process.cwd(), "data");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => cb(null, "cookies.txt"),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ── Proxy config ───────────────────────────────────────────────────────────────

// GET /api/proxy/status
router.get("/proxy/status", (_req, res) => {
  const status = getProxyStatus();
  res.json({
    ...status,
    xrayInstalled: isXrayInstalled(),
    vmessLink: process.env["VMESS_LINK"] ? "set" : null,
  });
});

// POST /api/proxy/save  { vmessLink }
router.post("/proxy/save", (req, res) => {
  const { vmessLink } = req.body as { vmessLink?: string };
  if (!vmessLink || !vmessLink.trim()) {
    res.status(400).json({ error: "vmessLink is required" });
    return;
  }

  try {
    decodeLink(vmessLink.trim());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid proxy link" });
    return;
  }

  const settings = getSettings();
  (settings as any).vmessLink = vmessLink.trim();
  saveSettings(settings);

  process.env["VMESS_LINK"] = vmessLink.trim();

  const ok = startXray(vmessLink.trim());
  setTimeout(() => {
    res.json({ ok, proxy: process.env["YTDLP_PROXY"] || null, message: ok ? "Proxy started" : "Saved (xray binary not found — yt-dlp will try direct)" });
  }, ok ? 500 : 0);
});

// DELETE /api/proxy/save
router.delete("/proxy/save", (_req, res) => {
  stopXray();
  delete process.env["VMESS_LINK"];
  delete process.env["YTDLP_PROXY"];
  delete process.env["FFMPEG_HTTP_PROXY"];

  const settings = getSettings();
  delete (settings as any).vmessLink;
  saveSettings(settings);

  res.json({ ok: true, message: "Proxy removed" });
});

// POST /api/proxy/test
router.post("/proxy/test", async (_req, res) => {
  try {
    const result = await testProxy();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "Test failed" });
  }
});

// ── Cookies management ─────────────────────────────────────────────────────────

// GET /api/proxy/cookies
router.get("/proxy/cookies", (_req, res) => {
  const exists = fs.existsSync(COOKIES_PATH);
  if (!exists) {
    res.json({ exists: false, size: 0, lines: 0 });
    return;
  }
  try {
    const content = fs.readFileSync(COOKIES_PATH, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
    res.json({ exists: true, size: fs.statSync(COOKIES_PATH).size, lines });
  } catch {
    res.json({ exists: true, size: 0, lines: 0 });
  }
});

// POST /api/proxy/cookies  (multipart: field "cookies")
router.post("/proxy/cookies", cookiesUpload.single("cookies"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded (field: cookies)" });
    return;
  }
  try {
    const content = fs.readFileSync(COOKIES_PATH, "utf-8").trim();
    if (
      !content.startsWith("# Netscape HTTP Cookie File") &&
      !content.startsWith("# HTTP Cookie File")
    ) {
      fs.unlinkSync(COOKIES_PATH);
      res.status(400).json({ error: "Invalid Netscape cookie file format. Export from your browser using a cookie export extension." });
      return;
    }
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
    res.json({ ok: true, message: `Cookies saved (${lines} entries)`, lines });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// DELETE /api/proxy/cookies
router.delete("/proxy/cookies", (_req, res) => {
  try {
    if (fs.existsSync(COOKIES_PATH)) fs.unlinkSync(COOKIES_PATH);
    res.json({ ok: true, message: "Cookies deleted" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Bulk download jobs ─────────────────────────────────────────────────────────

// POST /api/bulk-jobs  { urls?, urlsText?, mode? }
router.post("/bulk-jobs", (req, res) => {
  try {
    const { urls, urlsText, mode } = req.body as { urls?: string[]; urlsText?: string; mode?: string };
    if (!urls && !urlsText) {
      res.status(400).json({ error: "urls[] or urlsText required" });
      return;
    }
    const job = createBulkJob({ urls, urlsText, mode });
    res.json({ ok: true, jobId: job.id, job });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

// GET /api/bulk-jobs
router.get("/bulk-jobs", (_req, res) => {
  res.json({ jobs: listBulkJobs() });
});

// GET /api/bulk-jobs/:id
router.get("/bulk-jobs/:id", (req, res) => {
  const j = getBulkJob(req.params.id);
  if (!j) { res.status(404).json({ error: "not found" }); return; }
  res.json(j);
});

// DELETE /api/bulk-jobs/:id
router.delete("/bulk-jobs/:id", (req, res) => {
  const ok = deleteBulkJob(req.params.id);
  res.json({ ok });
});

export default router;
