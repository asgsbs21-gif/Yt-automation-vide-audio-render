import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger.js";
import { downloadOne, killBulkJob, OUTPUT_DIR } from "./ytdlp-bulk.js";

const TEMP_DIR   = process.env["TEMP_DIR"] || "/tmp/yt-bulk";
const STORE_FILE = path.join(OUTPUT_DIR, "_jobs-bulk.json");

export type BulkItemStatus = "pending" | "downloading" | "ready" | "failed";
export type BulkJobStatus  = "queued" | "running" | "done" | "failed";
export type BulkMode = "video_audio" | "audio" | "video";

export interface BulkItem {
  index:      number;
  url:        string;
  status:     BulkItemStatus;
  title:      string | null;
  hashtags:   string[];
  fileName:   string | null;
  strategy:   string | null;
  sizeBytes:  number;
  durationMs: number;
  error:      string | null;
}

export interface BulkJob {
  id:         string;
  type:       "bulk";
  mode:       BulkMode;
  status:     BulkJobStatus;
  createdAt:  number;
  finishedAt: number | null;
  items:      BulkItem[];
  summary:    { total: number; ok: number; failed: number };
  error:      string | null;
}

let jobs: Record<string, BulkJob> = {};
const aborted = new Set<string>();

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) jobs = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as typeof jobs;
  } catch (e) { logger.warn({ err: e }, "Could not load bulk job store"); }
}
function saveStore() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(jobs, null, 2));
  } catch {}
}
loadStore();

function normalizeUrl(url: string): string {
  return String(url).trim().replace(/^(Https?|HTTPS?):/i, (m) => m.toLowerCase());
}

function splitUrls(text: string): string[] {
  return String(text || "")
    .split(/[\n\r,;]+/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .map(normalizeUrl);
}

const VALID_MODES: Set<BulkMode> = new Set(["video_audio", "audio", "video"]);

export function createBulkJob(payload: { urls?: string[]; urlsText?: string; mode?: string }): BulkJob {
  const id   = uuid().slice(0, 8);
  const mode = VALID_MODES.has(payload.mode as BulkMode) ? (payload.mode as BulkMode) : "video_audio";

  let urls = Array.isArray(payload.urls) ? payload.urls : splitUrls(payload.urlsText || "");
  urls = urls.map(normalizeUrl).filter(Boolean);
  if (!urls.length) throw new Error("No valid YouTube URLs provided");

  const job: BulkJob = {
    id, type: "bulk", mode, status: "queued",
    createdAt: Date.now(), finishedAt: null,
    items: urls.map((url, i) => ({
      index: i, url, status: "pending", title: null, hashtags: [],
      fileName: null, strategy: null, sizeBytes: 0, durationMs: 0, error: null,
    })),
    summary: { total: urls.length, ok: 0, failed: 0 },
    error: null,
  };

  jobs[id] = job;
  saveStore();
  setImmediate(() => void runJob(id));
  return job;
}

async function runJob(id: string) {
  const job = jobs[id];
  if (!job) return;

  job.status = "running";
  saveStore();
  logger.info({ jobId: id }, `Bulk job started: ${job.items.length} URL(s), mode=${job.mode}`);

  for (const item of job.items) {
    if (aborted.has(id)) { logger.warn({ jobId: id }, "Bulk job aborted"); return; }

    item.status = "downloading";
    saveStore();

    const jobLog = (msg: string) => logger.info({ jobId: id }, msg);
    jobLog(`──── [${item.index + 1}/${job.items.length}] ${item.url}`);

    try {
      const result = await downloadOne(item.url, id, jobLog, { mode: job.mode });
      if (aborted.has(id)) {
        try { fs.unlinkSync(result.filePath); } catch {}
        return;
      }
      item.status     = "ready";
      item.title      = result.title;
      item.hashtags   = result.hashtags;
      item.fileName   = result.fileName;
      item.strategy   = result.strategy;
      item.sizeBytes  = result.sizeBytes;
      item.durationMs = result.durationMs;
      job.summary.ok++;
      saveStore();
      jobLog(`✅ [${item.index + 1}] OK: ${result.fileName}`);
    } catch (e) {
      if (aborted.has(id)) return;
      item.status = "failed";
      item.error  = (e instanceof Error ? e.message : String(e)).slice(0, 600);
      job.summary.failed++;
      saveStore();
      logger.error({ jobId: id }, `❌ [${item.index + 1}] FAILED: ${item.error.split("\n")[0]}`);
    }
  }

  if (!aborted.has(id)) {
    job.status = "done";
    job.finishedAt = Date.now();
    saveStore();
    logger.info({ jobId: id }, `Bulk job complete: ${job.summary.ok}/${job.summary.total} OK, ${job.summary.failed} failed`);
  }

  try {
    const dir = path.join(TEMP_DIR, id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  aborted.delete(id);
}

export function getBulkJob(id: string): BulkJob | null  { return jobs[id] || null; }
export function listBulkJobs(): BulkJob[] {
  return Object.values(jobs).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
}

export function deleteBulkJob(id: string): boolean {
  const j = jobs[id];
  if (!j) return false;
  aborted.add(id);
  const killed = killBulkJob(id);
  if (killed) logger.info({ jobId: id }, `Killed ${killed} yt-dlp proc(s)`);
  for (const it of j.items) {
    if (it.fileName) try { fs.unlinkSync(path.join(OUTPUT_DIR, it.fileName)); } catch {}
  }
  try {
    const dir = path.join(TEMP_DIR, id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  delete jobs[id];
  saveStore();
  return true;
}
