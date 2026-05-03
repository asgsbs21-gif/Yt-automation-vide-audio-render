import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { addLog } from "./data.js";

const execAsync = promisify(exec);

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
  destDir: string
): Promise<{ audioPath: string; metadata: AudioMetadata } | null> {
  addLog("download_audio", "info", `Starting audio download: ${url}`);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const outputTemplate = path.join(destDir, "%(title)s.%(ext)s");

  const cmd = [
    "yt-dlp",
    "--extract-audio",
    "--audio-format mp3",
    "--write-info-json",
    "--no-playlist",
    "--no-warnings",
    `--output "${outputTemplate}"`,
    `"${url}"`,
  ].join(" ");

  try {
    await execAsync(cmd, { timeout: 300000 });
  } catch (err) {
    addLog("download_audio", "error", `yt-dlp failed for ${url}`, String(err));
    return null;
  }

  // Find downloaded files
  const files = fs.readdirSync(destDir);
  const infoFile = files.find((f) => f.endsWith(".info.json"));
  const audioFile = files.find(
    (f) => f.endsWith(".mp3") || f.endsWith(".m4a") || f.endsWith(".webm")
  );

  if (!infoFile || !audioFile) {
    addLog(
      "download_audio",
      "error",
      `Could not find downloaded files in ${destDir}`
    );
    return null;
  }

  const infoPath = path.join(destDir, infoFile);
  const audioPath = path.join(destDir, audioFile);

  let metadata: AudioMetadata;
  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
    metadata = {
      title: String(info.title || "Untitled").slice(0, 60),
      description: String(info.description || "").slice(0, 150),
      tags: Array.isArray(info.tags)
        ? info.tags.filter((t: unknown) => typeof t === "string").slice(0, 30)
        : [],
      duration: Number(info.duration) || 0,
      uploader: String(info.uploader || info.channel || ""),
      filename: audioFile,
    };
  } catch {
    addLog("download_audio", "error", `Failed to parse metadata for ${url}`);
    return null;
  }

  // Clean up info JSON
  try {
    fs.unlinkSync(infoPath);
  } catch {}

  addLog(
    "download_audio",
    "success",
    `Downloaded audio: ${metadata.title} (${metadata.duration}s)`
  );

  return { audioPath, metadata };
}
