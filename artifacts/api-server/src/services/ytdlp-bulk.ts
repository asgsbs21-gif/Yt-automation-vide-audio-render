import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import { addLog } from "./data.js";

// =====================================================================
// YT Studio — Bulk downloader (ported from ZIP v3.0.9-bulk-sections-fast)
// Three modes: video_audio / audio / video
// Proxy auto-injected via process.env.YTDLP_PROXY
// =====================================================================

const YTDLP_MODULE_VERSION = "3.0.9-bulk";

const DATA_DIR   = path.resolve(process.cwd(), "data");
const COOKIES_FILE = path.join(DATA_DIR, "cookies.txt");
const TEMP_DIR   = process.env["TEMP_DIR"]   || "/tmp/yt-bulk";
const OUTPUT_DIR = process.env["OUTPUT_DIR"] || path.join(DATA_DIR, "bulk-output");

// ---------- Deno detection ----------
let DENO_BIN: string | null = null;
function detectDeno(): string {
  if (DENO_BIN !== null) return DENO_BIN;
  for (const c of ["/usr/local/bin/deno", "/usr/bin/deno", "deno"]) {
    try { execSync(`${c} --version`, { stdio: "pipe" }); DENO_BIN = c; return c; } catch {}
  }
  DENO_BIN = "";
  return "";
}

export function detectProxyType(): string {
  const link  = process.env["VMESS_LINK"] || "";
  if (/^vmess:/i.test(link))    return "vmess";
  if (/^vless:/i.test(link))    return "vless";
  if (/^trojan:/i.test(link))   return "trojan";
  if (/^ss:/i.test(link))       return "shadowsocks";
  const proxy = process.env["YTDLP_PROXY"] || "";
  if (/^socks5/i.test(proxy))   return "socks5";
  if (/^https?:\/\//i.test(proxy)) return "http-proxy";
  return "direct";
}

function buildCommonArgs(): string[] {
  const proxyType = detectProxyType();
  const isTunnel  = proxyType !== "direct" && proxyType !== "http-proxy";
  const denoBin   = detectDeno();

  const args: string[] = [
    "--no-warnings",
    "--progress",
    "--newline",
    "--no-playlist",
    "--retries", "10",
    "--fragment-retries", "10",
    "--retry-sleep", "3",
    "--socket-timeout", "60",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    "--geo-bypass",
    "--referer", "https://www.youtube.com/",
    "--add-header", "Origin:https://www.youtube.com",
  ];

  if (denoBin) {
    args.push("--extractor-args", "youtube:jsruntime=deno");
  }

  // Parallel chunking (same as clipper — works well over SOCKS5)
  if (isTunnel) {
    args.push("--hls-prefer-native", "--concurrent-fragments", "4", "-N", "4", "--http-chunk-size", "10M");
  } else {
    args.push("--hls-prefer-native", "--concurrent-fragments", "4", "-N", "4", "--http-chunk-size", "10M");
  }

  if (fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 100) {
    args.push("--cookies", COOKIES_FILE);
  }

  if (process.env["YTDLP_PROXY"]) {
    args.push("--proxy", process.env["YTDLP_PROXY"]);
  }

  return args;
}

export const STRATEGIES = [
  { name: "mweb",         client: "mweb",         desc: "mobile web",           maxSec: 300 },
  { name: "web_safari",   client: "web_safari",   desc: "HLS, cookie-friendly", maxSec: 150 },
  { name: "tv_simply",    client: "tv_simply",    desc: "no PO required",       maxSec: 60  },
  { name: "web_embedded", client: "web_embedded", desc: "embeddable only",      maxSec: 150 },
  { name: "android_vr",   client: "android_vr",   desc: "kids-safe fallback",   maxSec: 60  },
];

function formatForMode(mode: string) {
  switch (mode) {
    case "audio":
      return {
        format: "bestaudio[ext=m4a]/bestaudio",
        mergeFormat: null as string | null,
        ext: "m4a",
        extraArgs: ["-x", "--audio-format", "m4a", "--audio-quality", "0"],
      };
    case "video":
      return {
        format: "b[height<=720][ext=mp4][protocol*=https]/bv*[height<=720][ext=mp4]/bv*[ext=mp4]/bv*",
        mergeFormat: "mp4",
        ext: "mp4",
        extraArgs: ["--download-sections", "*0-inf"],
      };
    case "video_audio":
    default:
      return {
        format:
          "b[height<=720][ext=mp4][protocol*=https]" +
          "/bv*[height<=720][ext=mp4]+ba[ext=m4a]" +
          "/bv*+ba/b[ext=mp4]/b",
        mergeFormat: "mp4",
        ext: "mp4",
        extraArgs: ["--download-sections", "*0-inf"],
      };
  }
}

// ---------- Process tracking (for kill support) ----------
const RUNNING = new Map<string, Set<ReturnType<typeof spawn>>>();

function trackProc(jobId: string, proc: ReturnType<typeof spawn>) {
  if (!RUNNING.has(jobId)) RUNNING.set(jobId, new Set());
  RUNNING.get(jobId)!.add(proc);
  proc.on("close", () => {
    const set = RUNNING.get(jobId);
    if (set) { set.delete(proc); if (!set.size) RUNNING.delete(jobId); }
  });
}

export function killBulkJob(jobId: string): number {
  const set = RUNNING.get(jobId);
  if (!set) return 0;
  let n = 0;
  for (const p of set) { try { p.kill("SIGKILL"); n++; } catch {} }
  RUNNING.delete(jobId);
  return n;
}

// ---------- Core helpers ----------

function safeMove(src: string, dst: string) {
  try { fs.renameSync(src, dst); return; } catch (e: any) { if (e.code !== "EXDEV") throw e; }
  fs.copyFileSync(src, dst);
  try { fs.unlinkSync(src); } catch {}
}

function sanitizeFilename(s: string): string {
  return String(s || "").replace(/[\\/:"*?<>|\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
}

function extractHashtags(description: string): string[] {
  if (!description) return [];
  const matches = description.match(/#[\p{L}\p{N}\p{M}_\u200C\u200D]+/gu) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of matches) {
    const lc = tag.toLowerCase();
    if (!seen.has(lc)) { seen.add(lc); out.push(tag); }
    if (out.length >= 8) break;
  }
  return out;
}

function buildOutputFilename(title: string, hashtags: string[], ext: string): string {
  const safeTitle = sanitizeFilename(title) || "video";
  let name = safeTitle;
  if (hashtags.length) {
    const tagStr = hashtags.map((t) => sanitizeFilename(t)).filter(Boolean).join(" ");
    if (tagStr) name = `${safeTitle} ${tagStr}`;
  }
  const MAX_NAME_BYTES = 240;
  let buf = Buffer.from(name, "utf8");
  if (buf.length > MAX_NAME_BYTES) {
    buf = buf.subarray(0, MAX_NAME_BYTES);
    name = buf.toString("utf8").replace(/\uFFFD+$/, "").trim();
  }
  return `${name}.${ext}`;
}

function runYtdlpOnce(
  args: string[],
  jobId: string,
  jobLog: (msg: string) => void,
  maxMs?: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    addLog("download_video", "info", `yt-dlp bulk: ${args.slice(-3).join(" ")}`);
    const py3 = process.env["PYTHON3_BIN"] || "python3";
    const proc = spawn(py3, ["-m", "yt_dlp", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    trackProc(jobId, proc);

    let stderrBuf = "", stdoutBuf = "", done = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    if (maxMs) {
      killTimer = setTimeout(() => {
        if (done) return;
        jobLog(`Strategy timeout (${maxMs / 1000}s) — killing yt-dlp`);
        try { proc.kill("SIGKILL"); } catch {}
      }, maxMs);
    }

    proc.stdout.on("data", (d: Buffer) => {
      const s = d.toString(); stdoutBuf += s;
      s.split(/\r?\n/).forEach((line: string) => { if (line) jobLog(`yt-dlp> ${line}`); });
    });
    proc.stderr.on("data", (d: Buffer) => {
      const text = d.toString(); stderrBuf += text;
      text.split(/\r?\n/).forEach((line: string) => { if (line) jobLog(`yt-dlp stderr> ${line}`); });
    });
    proc.on("error", (e: Error) => { done = true; if (killTimer) clearTimeout(killTimer); reject(e); });
    proc.on("close", (code: number | null) => {
      done = true; if (killTimer) clearTimeout(killTimer);
      if (code === 0) resolve({ stdout: stdoutBuf, stderr: stderrBuf });
      else reject(Object.assign(new Error(`yt-dlp exited ${code}`), { code, stderr: stderrBuf }));
    });
  });
}

async function fetchMetadata(url: string, jobId: string): Promise<Record<string, unknown>> {
  const args = [
    ...buildCommonArgs(),
    "--skip-download",
    "--print", "%(.{id,title,description,uploader,duration,ext})j",
    url,
  ];
  return new Promise((resolve, reject) => {
    const py3b = process.env["PYTHON3_BIN"] || "python3";
    const proc = spawn(py3b, ["-m", "yt_dlp", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    trackProc(jobId, proc);
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d: Buffer) => stdout += d.toString());
    proc.stderr.on("data", (d: Buffer) => stderr += d.toString());
    proc.on("error", reject);
    proc.on("close", (code: number | null) => {
      if (code !== 0) return reject(new Error(`metadata fetch failed: ${stderr.slice(-300)}`));
      try {
        const line = stdout.trim().split("\n").find((l) => l.trim().startsWith("{"));
        if (!line) return reject(new Error("no metadata JSON in output"));
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (e) { reject(e); }
    });
  });
}

// ---------- Main download function ----------

export interface BulkDownloadResult {
  filePath: string;
  fileName: string;
  title: string;
  hashtags: string[];
  mode: string;
  strategy: string;
  proxyType: string;
  sizeBytes: number;
  durationMs: number;
}

export async function downloadOne(
  url: string,
  jobId: string,
  jobLog: (msg: string) => void,
  opts: { mode?: string } = {}
): Promise<BulkDownloadResult> {
  const mode = ["video_audio", "audio", "video"].includes(opts.mode || "") ? opts.mode! : "video_audio";
  jobLog(`[ytdlp=${YTDLP_MODULE_VERSION}] mode=${mode} url=${url}`);

  const workDir = path.join(TEMP_DIR, jobId);
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let meta: Record<string, unknown> = {};
  try {
    meta = await fetchMetadata(url, jobId);
    jobLog(`title="${String(meta["title"] || "").slice(0, 80)}" | duration=${meta["duration"] || "?"}s`);
  } catch (e) {
    jobLog(`metadata fetch failed (${e instanceof Error ? e.message : String(e)}) — continuing`);
  }

  const fmtSpec   = formatForMode(mode);
  const hashtags  = extractHashtags(String(meta["description"] || ""));
  const baseTitle = String(meta["title"] || meta["id"] || "video");
  const tmpTemplate = path.join(workDir, "dl_%(id)s.%(ext)s");
  const proxyType  = detectProxyType();
  const errors: string[] = [];

  for (let i = 0; i < STRATEGIES.length; i++) {
    const strategy = STRATEGIES[i];
    jobLog(`━━━ Strategy ${i + 1}/${STRATEGIES.length}: ${strategy.name} (${strategy.desc}) ━━━`);

    // Clean temp dir
    try {
      for (const f of fs.readdirSync(workDir)) {
        if (f.startsWith("dl_") || f.endsWith(".part") || f.endsWith(".ytdl"))
          fs.unlinkSync(path.join(workDir, f));
      }
    } catch {}

    const args = [
      ...buildCommonArgs(),
      "--extractor-args", `youtube:player_client=${strategy.client}`,
      "-f", fmtSpec.format,
      ...(fmtSpec.mergeFormat ? ["--merge-output-format", fmtSpec.mergeFormat] : []),
      ...fmtSpec.extraArgs,
      "-o", tmpTemplate,
      url,
    ];

    const startMs = Date.now();
    let ytdlpError: (Error & { code?: number; stderr?: string }) | null = null;

    try {
      await runYtdlpOnce(args, jobId, jobLog, strategy.maxSec ? strategy.maxSec * 1000 : undefined);
    } catch (e) {
      ytdlpError = e as Error & { code?: number; stderr?: string };
      jobLog(`yt-dlp non-zero exit (${ytdlpError.code || "?"}) — checking if file exists anyway…`);
    }

    // Check file regardless of exit code (critical — see original comments)
    let files: string[] = [];
    try { files = fs.readdirSync(workDir).filter((f) => f.startsWith("dl_") && !f.endsWith(".part") && !f.endsWith(".ytdl")); } catch {}

    let pick: string | null = null, pickSize = 0;
    for (const f of files) {
      try {
        const sz = fs.statSync(path.join(workDir, f)).size;
        if (sz > pickSize) { pickSize = sz; pick = f; }
      } catch {}
    }

    const MIN_USABLE_BYTES = 50 * 1024;

    if (pick && pickSize >= MIN_USABLE_BYTES) {
      try {
        const tmpPath  = path.join(workDir, pick);
        const realExt  = path.extname(pick).slice(1) || fmtSpec.ext;
        let finalName  = buildOutputFilename(baseTitle, hashtags, realExt);
        let finalPath  = path.join(OUTPUT_DIR, finalName);
        let counter = 1;
        while (fs.existsSync(finalPath)) {
          const stem = finalName.replace(new RegExp(`\\.${realExt}$`), "");
          finalName  = `${stem} (${counter}).${realExt}`;
          finalPath  = path.join(OUTPUT_DIR, finalName);
          counter++;
        }
        safeMove(tmpPath, finalPath);

        const elapsed = Date.now() - startMs;
        const sizeMB  = (pickSize / (1024 * 1024)).toFixed(2);
        jobLog(`✅ "${strategy.name}" SUCCESS in ${(elapsed / 1000).toFixed(1)}s (${sizeMB} MB) → ${finalName}`);

        return { filePath: finalPath, fileName: finalName, title: baseTitle, hashtags, mode, strategy: strategy.name, proxyType, sizeBytes: pickSize, durationMs: elapsed };
      } catch (renameErr) {
        jobLog(`Rename failed: ${renameErr instanceof Error ? renameErr.message : String(renameErr)}`);
      }
    }

    const elapsed = Date.now() - startMs;
    const e = ytdlpError || new Error("no usable output file");
    const stderrText = (e as any).stderr || e.message || "";
    const isBotError = /Sign in to confirm|not a bot|requires.*login/i.test(stderrText);
    const reason = isBotError ? "BOT_DETECTION" : "OTHER";
    jobLog(`✗ "${strategy.name}" failed (${reason}) after ${(elapsed / 1000).toFixed(1)}s`);
    errors.push(`[${strategy.name}] ${e.message.slice(0, 200)}`);
  }

  throw new Error(
    `All ${STRATEGIES.length} strategies failed for ${url}.\n` +
    `Try: refresh cookies.txt, check proxy validity.\n` +
    `Errors:\n  → ${errors.join("\n  → ")}`
  );
}

export { YTDLP_MODULE_VERSION, OUTPUT_DIR };
