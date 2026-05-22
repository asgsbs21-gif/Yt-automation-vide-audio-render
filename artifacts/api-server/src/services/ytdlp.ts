import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { addLog } from "./data.js";
import type { JobType } from "../lib/socket.js";

// ── yt-dlp via pip (no binary — Railway compatible) ───────────────────────────
// We call `python3 -m yt_dlp` instead of a downloaded binary.
// On first use, if yt_dlp module is missing we auto-install via pip.

const PY3 = process.env["PYTHON3_BIN"] || "python3";

function isYtDlpAvailable(): boolean {
  try {
    execSync(`${PY3} -m yt_dlp --version`, { timeout: 8_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function installYtDlp(): void {
  addLog("download_audio", "info", "Installing yt-dlp via pip…");
  try {
    // --no-binary :all: compiles from source — avoids pre-built wheel issues on Railway
    execSync(
      `${PY3} -m pip install yt-dlp --no-binary :all: --break-system-packages -q`,
      { timeout: 120_000, stdio: "pipe" }
    );
    addLog("download_audio", "info", "yt-dlp installed successfully");
  } catch {
    // Fallback: try without --break-system-packages (older pip / venv)
    try {
      execSync(`${PY3} -m pip install yt-dlp --no-binary :all: -q`, {
        timeout: 120_000,
        stdio: "pipe",
      });
      addLog("download_audio", "info", "yt-dlp installed (venv fallback)");
    } catch (e2) {
      addLog("download_audio", "error", "pip install yt-dlp failed", String(e2));
    }
  }
}

// Ensure yt-dlp is available at module load (non-blocking background check)
if (!isYtDlpAvailable()) {
  installYtDlp();
}

// ── ffprobe helper ─────────────────────────────────────────────────────────────

function getDurationFfprobe(audioPath: string): number {
  try {
    const ffprobebin =
      process.env["FFPROBE_PATH"] ||
      ["/home/runner/workspace/bin/ffprobe", "/usr/bin/ffprobe", "ffprobe"].find(
        (b) => {
          try {
            execSync(`"${b}" -version`, { timeout: 3_000, stdio: "pipe" });
            return true;
          } catch {
            return false;
          }
        }
      ) ||
      "ffprobe";
    const result = execSync(
      `"${ffprobebin}" -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { encoding: "utf8", timeout: 10_000 }
    ).trim();
    const d = parseFloat(result);
    return isNaN(d) ? 0 : d;
  } catch {
    return 0;
  }
}

// ── Arg helpers ───────────────────────────────────────────────────────────────

function getCookieArgs(): string[] {
  const cookiePath = path.resolve(process.cwd(), "data", "cookies.txt");
  if (!fs.existsSync(cookiePath)) return [];
  try {
    const txt = fs.readFileSync(cookiePath, "utf-8").trim();
    if (!txt || txt.length < 10) return [];
    if (
      !txt.startsWith("# Netscape HTTP Cookie File") &&
      !txt.startsWith("# HTTP Cookie File")
    ) {
      addLog("download_video", "warn", "cookies.txt invalid format — skipping");
      return [];
    }
    return ["--cookies", cookiePath];
  } catch {
    return [];
  }
}

function getProxyArgs(): string[] {
  const proxy = process.env["YTDLP_PROXY"];
  if (!proxy) return [];
  return ["--proxy", proxy];
}

// ── Core runner ───────────────────────────────────────────────────────────────

async function runYtDlp(
  args: string[],
  cwd: string,
  jobType: JobType,
  onProgress?: (progress: number, message: string) => void,
  startPct = 5,
  endPct = 92
): Promise<{ stdout: string; stderr: string }> {
  // Order: proxy → cookies → user args
  const finalArgs = [...getProxyArgs(), ...getCookieArgs(), ...args];
  addLog(jobType, "info", `python3 -m yt_dlp ${finalArgs.slice(0, 6).join(" ")}…`);

  return new Promise((resolve, reject) => {
    const proc = spawn(PY3, ["-m", "yt_dlp", ...finalArgs], { cwd });
    let lastPct = startPct;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const lines = text.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        stdoutLines.push(line);
        addLog(jobType, "info", line.trim().slice(0, 300));
        const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (pctMatch) {
          const raw = parseFloat(pctMatch[1]);
          const pct = Math.min(
            endPct,
            startPct + Math.round((raw / 100) * (endPct - startPct))
          );
          if (pct > lastPct) {
            lastPct = pct;
            onProgress?.(pct, line.trim());
          }
        } else if (line.includes("[Merger]") || line.includes("[ffmpeg]")) {
          onProgress?.(Math.min(endPct, lastPct + 5), line.trim());
        } else if (line.includes("[download] Destination:")) {
          onProgress?.(startPct + 2, line.trim());
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        stderrLines.push(line);
        addLog(jobType, "error", `yt-dlp stderr: ${line.trim().slice(0, 300)}`);
        onProgress?.(lastPct, `ERROR: ${line.trim().slice(0, 120)}`);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n") });
      } else {
        const errMsg = stderrLines.join("\n") || stdoutLines.join("\n");
        reject(new Error(`yt-dlp exited with code ${code}:\n${errMsg.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`yt-dlp spawn failed (python3 -m yt_dlp): ${err.message}`));
    });
  });
}

export interface AudioMetadata {
  title: string;
  description: string;
  tags: string[];
  duration: number;
  uploader: string;
  filename: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function downloadVideoWithYtDlp(
  url: string,
  destDir: string,
  jobId: string,
  onProgress?: (progress: number, message: string) => void
): Promise<string | null> {
  const jobType: JobType = "download_video";

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const outputTemplate = path.join(destDir, `${jobId}.%(ext)s`);

  addLog(jobType, "info", `Downloading video via yt-dlp: ${url}`);
  onProgress?.(3, `Starting yt-dlp for: ${url}`);

  const args = [
    "-f",
    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--newline",
    "--no-warnings",
    // Instagram / bot-detection headers
    "--add-header",
    "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "-o",
    outputTemplate,
    url,
  ];

  try {
    await runYtDlp(args, destDir, jobType, onProgress, 3, 95);
  } catch (err) {
    addLog(
      jobType,
      "error",
      `yt-dlp video download failed: ${url}`,
      String(err)
    );
    onProgress?.(0, `Failed: ${String(err).slice(0, 120)}`);
    return null;
  }

  const files = fs.readdirSync(destDir);
  const videoFile = files.find(
    (f) =>
      f.startsWith(jobId) &&
      (f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".webm"))
  );

  if (!videoFile) {
    addLog(
      jobType,
      "error",
      `No output file found in ${destDir} after yt-dlp. Files: ${files.join(", ")}`
    );
    return null;
  }

  const videoPath = path.join(destDir, videoFile);
  addLog(jobType, "success", `Downloaded: ${videoFile}`);
  onProgress?.(100, `Done: ${videoFile}`);
  return videoPath;
}

export async function downloadAudio(
  url: string,
  destDir: string,
  onProgress?: (progress: number, message: string) => void
): Promise<{ audioPath: string; metadata: AudioMetadata } | null> {
  const jobType: JobType = "download_audio";
  addLog(jobType, "info", `Starting audio download: ${url}`);

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const outputTemplate = path.join(destDir, "%(id)s.%(ext)s");

  const args = [
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--write-info-json",
    "--no-playlist",
    "--newline",
    "--no-warnings",
    "--add-header",
    "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "-o",
    outputTemplate,
    url,
  ];

  onProgress?.(5, "Starting yt-dlp (python3 -m yt_dlp)…");

  try {
    await runYtDlp(args, destDir, jobType, onProgress, 5, 90);
  } catch (err) {
    addLog(
      jobType,
      "error",
      `yt-dlp audio download failed: ${url}`,
      String(err)
    );
    onProgress?.(0, `Failed: ${String(err).slice(0, 120)}`);
    return null;
  }

  onProgress?.(92, "Parsing metadata…");

  const files = fs.readdirSync(destDir);
  const infoFile = files.find((f) => f.endsWith(".info.json"));
  const audioFile = files.find(
    (f) =>
      f.endsWith(".mp3") ||
      f.endsWith(".m4a") ||
      f.endsWith(".webm") ||
      f.endsWith(".ogg")
  );

  if (!audioFile) {
    addLog(
      jobType,
      "error",
      `No audio file found in ${destDir}. Files: ${files.join(", ")}`
    );
    return null;
  }

  const audioPath = path.join(destDir, audioFile);
  let metadata: AudioMetadata;

  if (infoFile) {
    const infoPath = path.join(destDir, infoFile);
    try {
      const info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
      const rawTags: string[] = Array.isArray(info.tags)
        ? info.tags.filter((t: unknown) => typeof t === "string")
        : [];
      const descHashtags: string[] = (
        (info.description as string) || ""
      )
        .match(/#(\w+)/g)
        ?.map((h: string) => h.slice(1)) || [];
      const allTags = [...new Set([...rawTags, ...descHashtags])].slice(0, 30);

      metadata = {
        title: String(info.title || "Untitled").slice(0, 100),
        description: String(info.description || "").slice(0, 5000),
        tags: allTags,
        duration: Number(info.duration) || getDurationFfprobe(audioPath),
        uploader: String(
          info.uploader || info.channel || info.creator || ""
        ),
        filename: audioFile,
      };

      try {
        fs.unlinkSync(infoPath);
      } catch {}
    } catch {
      metadata = {
        title: audioFile.replace(/\.[^.]+$/, ""),
        description: "",
        tags: [],
        duration: getDurationFfprobe(audioPath),
        uploader: "",
        filename: audioFile,
      };
    }
  } else {
    metadata = {
      title: audioFile.replace(/\.[^.]+$/, ""),
      description: "",
      tags: [],
      duration: getDurationFfprobe(audioPath),
      uploader: "",
      filename: audioFile,
    };
  }

  addLog(
    jobType,
    "success",
    `Downloaded: "${metadata.title}" (${metadata.duration}s, ${metadata.tags.length} tags)`
  );
  return { audioPath, metadata };
}

// Legacy export kept for any callers that imported YT_DLP_BIN
export const YT_DLP_BIN = `${PY3} -m yt_dlp`;
