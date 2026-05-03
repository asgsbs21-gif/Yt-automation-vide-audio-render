import puppeteer from "puppeteer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { addLog } from "./data.js";

const CHROMIUM_PATH =
  process.env["CHROMIUM_PATH"] || "/usr/bin/chromium-browser";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Extract video URL from Kuaishou page ──────────────────────────────────────

export async function extractKuaishouVideoUrl(
  pageUrl: string
): Promise<string | null> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ Referer: "https://www.kuaishou.com" });

    const videoUrls: string[] = [];

    // Intercept network requests to find video URLs
    page.on("request", (req) => {
      const url = req.url();
      if (
        (url.includes(".mp4") || url.includes("kpcdn") || url.includes("gifshow")) &&
        url.includes("video")
      ) {
        videoUrls.push(url);
      }
    });

    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));

    // Also check video element src
    const videoSrc = await page.evaluate(() => {
      const video = document.querySelector("video");
      return video?.src || null;
    });
    if (videoSrc) videoUrls.push(videoSrc);

    // Pick the best URL (prefer highest resolution — longest URL usually has quality params)
    if (videoUrls.length === 0) return null;
    return videoUrls.sort((a, b) => b.length - a.length)[0];
  } catch (err) {
    addLog(
      "download_video",
      "error",
      `Failed to extract video URL from ${pageUrl}`,
      String(err)
    );
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// ── Download video to tmp ─────────────────────────────────────────────────────

export async function downloadKuaishouVideo(
  pageUrl: string,
  destDir: string,
  filename?: string
): Promise<string | null> {
  addLog("download_video", "info", `Extracting video from: ${pageUrl}`);
  const videoUrl = await extractKuaishouVideoUrl(pageUrl);
  if (!videoUrl) {
    addLog("download_video", "error", `No video URL found at: ${pageUrl}`);
    return null;
  }

  const name = filename || `video_${Date.now()}.mp4`;
  const destPath = path.join(destDir, name);

  addLog("download_video", "info", `Downloading video: ${name}`);

  const response = await axios({
    method: "GET",
    url: videoUrl,
    responseType: "stream",
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://www.kuaishou.com",
    },
    timeout: 120000,
  });

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    (response.data as NodeJS.ReadableStream).pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  addLog("download_video", "success", `Downloaded: ${name}`);
  return destPath;
}
