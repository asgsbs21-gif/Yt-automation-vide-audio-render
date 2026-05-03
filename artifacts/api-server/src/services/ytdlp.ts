import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { addLog } from "./data.js";
import type { JobType } from "../lib/socket.js";

export interface AudioMetadata {
  title: string;
  description: string;
  tags: string[];
  duration: number;
  uploader: string;
  filename: string;
}

// ── Download audio + metadata with yt-dlp ────────────────────────────────────

export async function downloadAudio(
  url: string,
  destDir: string,
  onProgress?: (progress: number, message: string) => void
): Promise<{ audioPath: string; metadata: AudioMetadata } | null> {
  const jobType: JobType = "download_audio";
  addLog(jobType, "info", `Starting audio download: ${url}`);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const outputTemplate = path.join(destDir, "%(id)s.%(ext)s");
  const infoTemplate = path.join(destDir, "%(id)s.%(ext)s");

  const args = [
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--write-info-json",
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--output",
    outputTemplate,
    url,
  ];

  onProgress?.(5, "Starting yt-dlp…");

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { cwd: destDir });
    let lastPct = 5;

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (pctMatch) {
          const pct = Math.min(90, 5 + Math.round(parseFloat(pctMatch[1]) * 0.85));
          if (pct > lastPct) {
            lastPct = pct;
            onProgress?.(pct, line.trim());
          }
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const txt = chunk.toString().trim();
      if (txt) addLog(jobType, "warn", txt.slice(0, 200));
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });

    proc.on("error", (err) => {
      reject(new Error(`yt-dlp spawn failed: ${err.message}`));
    });
  }).catch((err) => {
    addLog(jobType, "error", `yt-dlp failed for ${url}`, String(err));
    throw err;
  });

  onProgress?.(92, "Parsing metadata…");

  const files = fs.readdirSync(destDir);
  const infoFile = files.find((f) => f.endsWith(".info.json"));
  const audioFile = files.find(
    (f) => f.endsWith(".mp3") || f.endsWith(".m4a") || f.endsWith(".webm") || f.endsWith(".ogg")
  );

  if (!audioFile) {
    addLog(jobType, "error", `No audio file found in ${destDir}. Files: ${files.join(", ")}`);
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

      const descHashtags: string[] = ((info.description as string) || "")
        .match(/#(\w+)/g)
        ?.map((h: string) => h.slice(1)) || [];

      const allTags = [...new Set([...rawTags, ...descHashtags])].slice(0, 30);

      metadata = {
        title: String(info.title || "Untitled").slice(0, 100),
        description: String(info.description || "").slice(0, 5000),
        tags: allTags,
        duration: Number(info.duration) || 0,
        uploader: String(info.uploader || info.channel || info.creator || ""),
        filename: audioFile,
      };

      try { fs.unlinkSync(infoPath); } catch {}
    } catch {
      metadata = {
        title: audioFile.replace(/\.[^.]+$/, ""),
        description: "",
        tags: [],
        duration: 0,
        uploader: "",
        filename: audioFile,
      };
    }
  } else {
    metadata = {
      title: audioFile.replace(/\.[^.]+$/, ""),
      description: "",
      tags: [],
      duration: 0,
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
