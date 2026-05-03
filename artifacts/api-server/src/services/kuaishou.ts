import puppeteer from "puppeteer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { addLog } from "./data.js";
import { emitJobUpdate, type JobType } from "../lib/socket.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Find chromium binary ──────────────────────────────────────────────────────

function findChromium(): string {
  if (process.env["CHROMIUM_PATH"]) return process.env["CHROMIUM_PATH"];

  const candidates = [
    "/nix/var/nix/profiles/default/bin/chromium",
    "/run/current-system/sw/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const found = execSync(
      "which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null",
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (found) return found;
  } catch {}

  return "chromium";
}

// ── Extract video URL from Kuaishou page ──────────────────────────────────────

export async function extractKuaishouVideoUrl(
  pageUrl: string
): Promise<string | null> {
  let browser;
  try {
    const executablePath = findChromium();
    addLog("download_video", "info", `Launching browser: ${executablePath}`);

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-extensions",
        "--mute-audio",
        "--no-first-run",
        "--single-process",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ Referer: "https://www.kuaishou.com" });

    const videoUrls: string[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (
        (url.includes(".mp4") ||
          url.includes("kpcdn") ||
          url.includes("gifshow") ||
          url.includes("tx.kwai") ||
          url.includes("ks3")) &&
        (url.includes("video") || url.includes(".mp4"))
      ) {
        videoUrls.push(url);
      }
    });

    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 4000));

    const videoSrc = await page.evaluate(() => {
      const video = document.querySelector("video");
      return video?.src || null;
    });
    if (videoSrc && videoSrc.startsWith("http")) videoUrls.push(videoSrc);

    if (videoUrls.length === 0) {
      const allSrcs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("video source")).map(
          (s) => (s as HTMLSourceElement).src
        );
      });
      videoUrls.push(...allSrcs.filter((s) => s.startsWith("http")));
    }

    if (videoUrls.length === 0) return null;

    const unique = [...new Set(videoUrls)];
    return unique.sort((a, b) => b.length - a.length)[0];
  } catch (err) {
    addLog(
      "download_video",
      "error",
      `Failed to extract video URL from ${pageUrl}`,
      String(err)
    );
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

// ── Download a Kuaishou video with progress ───────────────────────────────────

export async function downloadKuaishouVideo(
  pageUrl: string,
  destDir: string,
  filename: string,
  jobId: string,
  onProgress?: (progress: number, message: string) => void
): Promise<string | null> {
  const jobType: JobType = "download_video";

  onProgress?.(5, `Launching browser for ${pageUrl}`);
  addLog(jobType, "info", `Extracting video from: ${pageUrl}`);

  const videoUrl = await extractKuaishouVideoUrl(pageUrl);
  if (!videoUrl) {
    addLog(jobType, "error", `No video URL found at: ${pageUrl}`);
    return null;
  }

  onProgress?.(35, `Downloading video file…`);
  addLog(jobType, "info", `Downloading video: ${filename}`);

  const destPath = path.join(destDir, filename);

  const response = await axios({
    method: "GET",
    url: videoUrl,
    responseType: "stream",
    headers: { "User-Agent": USER_AGENT, Referer: "https://www.kuaishou.com" },
    timeout: 180000,
  });

  const contentLength = Number(response.headers["content-length"] || 0);
  let downloaded = 0;

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    const stream = response.data as NodeJS.ReadableStream;

    stream.on("data", (chunk: Buffer) => {
      downloaded += chunk.length;
      if (contentLength > 0) {
        const pct = Math.min(95, 35 + Math.round((downloaded / contentLength) * 60));
        onProgress?.(pct, `Downloading… ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
      }
    });

    stream.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    stream.on("error", reject);
  });

  addLog(jobType, "success", `Downloaded: ${filename}`);
  return destPath;
}
