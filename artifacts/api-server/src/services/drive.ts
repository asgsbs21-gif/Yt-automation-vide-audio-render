import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import type { OAuth2Client } from "google-auth-library";
import { addLog } from "./data.js";

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

// ── Upload file from disk path to Drive ──────────────────────────────────────
// Legacy helper — no progress tracking. Used by mute-and-drive and scheduler.

export async function uploadFileToDrive(
  auth: OAuth2Client,
  filePath: string,
  folderId: string,
  mimeType: string,
  filename?: string
): Promise<DriveFile> {
  const drive = google.drive({ version: "v3", auth });
  const name = filename || path.basename(filePath);

  addLog("upload", "info", `Uploading ${name} to Drive...`);

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: "id, name, webViewLink",
  });

  const file = res.data;
  addLog("upload", "success", `Uploaded ${name} to Drive: ${file.id}`);

  return {
    id: file.id!,
    name: file.name!,
    webViewLink: file.webViewLink!,
  };
}

// ── Stream file to Drive with real-time speed tracking ───────────────────────
// Uses a PassThrough to count bytes in flight → MB/s reported via onProgress.
// Progress pct is based on file size. Speed is rolling average since start.

export async function uploadFileToDriveWithSpeed(
  auth: OAuth2Client,
  filePath: string,
  folderId: string,
  mimeType: string,
  filename: string | undefined,
  onProgress?: (pct: number, mbps: string, message: string) => void
): Promise<DriveFile> {
  const drive = google.drive({ version: "v3", auth });
  const name = filename || path.basename(filePath);

  const stat = fs.statSync(filePath);
  const totalBytes = stat.size;
  const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

  let transferred = 0;
  const startTime = Date.now();

  // PassThrough lets us intercept bytes without buffering them
  const counter = new PassThrough();
  counter.on("data", (chunk: Buffer) => {
    transferred += chunk.length;
    const elapsedSec = Math.max(0.05, (Date.now() - startTime) / 1000);
    const mbps = ((transferred / 1024 / 1024) / elapsedSec).toFixed(2);
    const pct = totalBytes > 0 ? Math.min(99, Math.round((transferred / totalBytes) * 100)) : 0;
    const transferredMB = (transferred / 1024 / 1024).toFixed(1);
    onProgress?.(pct, mbps, `${transferredMB}/${totalMB} MB @ ${mbps} MB/s`);
  });

  fs.createReadStream(filePath).pipe(counter);

  addLog("upload", "info", `Streaming ${name} (${totalMB} MB) → Drive…`);

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: counter,
    },
    fields: "id, name, webViewLink",
  });

  const file = res.data;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgMbps = ((totalBytes / 1024 / 1024) / Math.max(0.1, parseFloat(elapsed))).toFixed(2);
  addLog("upload", "success", `Streamed ${name} → Drive in ${elapsed}s @ avg ${avgMbps} MB/s: ${file.id}`);

  return {
    id: file.id!,
    name: file.name!,
    webViewLink: file.webViewLink!,
  };
}

// ── Download file from Drive to tmp ──────────────────────────────────────────

export async function downloadFromDrive(
  auth: OAuth2Client,
  fileId: string,
  destPath: string
): Promise<string> {
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    (res.data as NodeJS.ReadableStream).pipe(writer);
    writer.on("finish", () => resolve(destPath));
    writer.on("error", reject);
  });
}

// ── Check if Drive is accessible ─────────────────────────────────────────────

export async function checkDriveConnected(
  auth: OAuth2Client
): Promise<boolean> {
  try {
    const drive = google.drive({ version: "v3", auth });
    await drive.about.get({ fields: "user" });
    return true;
  } catch {
    return false;
  }
}
