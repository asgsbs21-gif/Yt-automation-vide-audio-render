/**
 * Server-side thumbnail composition using Puppeteer / headless Chromium.
 *
 * Takes a raw JPEG frame (extracted by ffmpeg) and overlays a coloured band
 * at the bottom with the audio title rendered in Bengali (Hind Siliguri via
 * Google Fonts CDN). Output is a 1080×1920 JPEG matching YouTube Shorts spec.
 *
 * Falls back gracefully: if Puppeteer fails for any reason the caller should
 * keep the raw frame rather than throwing.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { addLog } from "./data.js";

const BG_HEX: Record<string, string> = {
  yellow: "#FACC15",
  green:  "#22C55E",
  red:    "#EF4444",
};

export async function composeThumbnailWithText(
  inputPath: string,
  outputPath: string,
  title: string,
  bgColor: string
): Promise<void> {
  const hex = BG_HEX[bgColor] ?? BG_HEX.yellow;

  // Encode source frame as data URL so the headless browser needs no file access
  const imageB64 = fs.readFileSync(inputPath).toString("base64");
  const imageDataUrl = `data:image/jpeg;base64,${imageB64}`;

  const escapedTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; }
  body { position: relative; background: #000; }
  img.bg {
    position: absolute; top: 0; left: 0;
    width: 1080px; height: 1920px; object-fit: cover;
  }
  .band {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: ${hex};
    padding: 70px 70px 90px;
    min-height: 300px;
    display: flex; align-items: center;
  }
  .title {
    font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'DejaVu Sans', sans-serif;
    font-size: 92px;
    font-weight: 700;
    color: #000;
    line-height: 1.35;
    word-break: break-word;
    overflow-wrap: break-word;
  }
</style>
</head><body>
  <img class="bg" src="${imageDataUrl}">
  <div class="band"><div class="title">${escapedTitle}</div></div>
</body></html>`;

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpHtml = path.join(os.tmpdir(), `thumb_compose_${id}.html`);
  const tmpOut  = path.join(os.tmpdir(), `thumb_out_${id}.jpg`);

  fs.writeFileSync(tmpHtml, html, "utf-8");

  let browser: import("puppeteer").Browser | undefined;
  try {
    const puppeteer = (await import("puppeteer")).default;

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

    await page.goto(`file://${tmpHtml}`, {
      waitUntil: "networkidle2",
      timeout: 25_000,
    });

    await page.screenshot({
      path: tmpOut,
      type: "jpeg",
      quality: 92,
    } as Parameters<typeof page.screenshot>[0]);

    fs.renameSync(tmpOut, outputPath);
    addLog("process", "info", `Thumbnail composed: Bengali title "${title.slice(0, 40)}…"`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { fs.unlinkSync(tmpHtml); } catch {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
  }
}
