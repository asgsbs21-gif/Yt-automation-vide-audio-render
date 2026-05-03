import { google } from "googleapis";
import fs from "fs";
import path from "path";
import type { OAuth2Client } from "google-auth-library";
import { addLog } from "./data.js";

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

// ── Upload file to Drive ──────────────────────────────────────────────────────

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
