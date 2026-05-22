import { Router } from "express";
import { getSettings, saveSettings } from "../services/data.js";
import { startXray, stopXray, testProxy, getProxyStatus, decodeLink, isXrayInstalled } from "../services/xray.js";
import { createBulkJob, getBulkJob, listBulkJobs, deleteBulkJob } from "../services/jobManager-bulk.js";

const router = Router();

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
    // Validate link before saving
    decodeLink(vmessLink.trim());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid proxy link" });
    return;
  }

  // Persist in settings.json
  const settings = getSettings();
  (settings as any).vmessLink = vmessLink.trim();
  saveSettings(settings);

  // Set env var + restart xray
  process.env["VMESS_LINK"] = vmessLink.trim();

  // Give xray 500ms to start, then respond
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
