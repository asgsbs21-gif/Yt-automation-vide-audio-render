import { google } from "googleapis";
import fs from "fs";
import type { OAuth2Client } from "google-auth-library";
import { addLog } from "./data.js";

export interface UploadOptions {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  filePath: string;
  scheduledAt?: string | null;
}

export interface UploadResult {
  youtubeId: string;
  youtubeUrl: string;
}

// ── Upload video to YouTube ───────────────────────────────────────────────────

export async function uploadToYouTube(
  auth: OAuth2Client,
  options: UploadOptions
): Promise<UploadResult> {
  const youtube = google.youtube({ version: "v3", auth });

  const title = options.title.slice(0, 60) + " #Shorts";
  const hashtagStr = options.tags.map((t) => `#${t}`).join(" ");
  const description =
    options.description.slice(0, 150) + "\n\n" + hashtagStr + "\n#Shorts";

  const privacyStatus = options.scheduledAt ? "private" : "public";

  const statusBody: Record<string, unknown> = { privacyStatus };
  if (options.scheduledAt) {
    statusBody["publishAt"] = options.scheduledAt;
  }

  // ── Pre-upload audit log — shows the EXACT payload sent to YouTube ──────────
  addLog(
    "upload",
    "info",
    `YouTube upload payload: "${title}"`,
    [
      `TITLE (${title.length} chars): ${title}`,
      `DESCRIPTION (${description.length} chars):\n${description}`,
      `TAGS (${options.tags.length}): ${options.tags.join(", ")}`,
      `CATEGORY ID: ${options.categoryId}`,
      `PRIVACY: ${privacyStatus}${options.scheduledAt ? ` — publishAt ${options.scheduledAt}` : ""}`,
    ].join("\n\n")
  );

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        tags: options.tags,
        categoryId: options.categoryId,
      },
      status: statusBody,
    },
    media: {
      mimeType: "video/mp4",
      body: fs.createReadStream(options.filePath),
    },
  });

  const videoId = res.data.id!;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  addLog("upload", "success", `Uploaded to YouTube: ${videoUrl}`);

  return { youtubeId: videoId, youtubeUrl: videoUrl };
}

// ── Set a custom thumbnail for an uploaded YouTube video ─────────────────────
//
// Requires the video to already be uploaded. The thumbnail file should be a
// JPEG image. Note: thumbnail uploads require the channel to be verified.

export async function setYouTubeThumbnail(
  auth: OAuth2Client,
  videoId: string,
  thumbPath: string
): Promise<void> {
  const youtube = google.youtube({ version: "v3", auth });
  await youtube.thumbnails.set({
    videoId,
    media: {
      mimeType: "image/jpeg",
      body: fs.createReadStream(thumbPath),
    },
  });
  addLog("upload", "info", `Custom thumbnail set for video ${videoId}`);
}

// ── Check YouTube connectivity ────────────────────────────────────────────────

export async function checkYouTubeConnected(
  auth: OAuth2Client
): Promise<boolean> {
  try {
    const youtube = google.youtube({ version: "v3", auth });
    await youtube.channels.list({ part: ["id"], mine: true });
    return true;
  } catch {
    return false;
  }
}
