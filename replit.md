# YT Auto Pro — Workspace

## Overview

pnpm workspace monorepo using TypeScript. Full YouTube Shorts automation app.
No login gate — dashboard shows immediately. Google OAuth only triggers when
clicking "Upload to YouTube" or "Save to Google Drive". Downloads Kuaishou
videos (Puppeteer), downloads audio with yt-dlp (auto-extracting title /
description / hashtags), merges with FFmpeg (9:16 1080×1920, mute original
audio, overlay downloaded audio, concat multi-clip), tracks video cycling by
usage, filters by category, schedules daily uploads via node-cron, uploads to
YouTube using audio metadata. Real-time Socket.io progress in UI.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS
- **API framework**: Express 5
- **Real-time**: Socket.io (path `/api/socket.io`, events: `job:update`)
- **Storage**: JSON files in `artifacts/api-server/data/` (no DB required)
- **Auth**: Google OAuth2 via `googleapis` + `express-session`
- **Video processing**: Puppeteer (Kuaishou scraping), yt-dlp (audio + metadata), FFmpeg (concat + 9:16 scale)
- **Scheduling**: node-cron (daily auto-cycle + due queue items)
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (ESM bundle, socket.io bundled, puppeteer externalized)

## Artifacts

| Artifact | Path | Description |
|---|---|---|
| `yt-auto-pro` | `/` | React frontend — 7-tab cockpit (Dashboard, Videos, Audio, Process, Queue, Schedule, Logs) |
| `api-server` | `/api` | Express API — auth, download, process, queue, upload, Socket.io |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/yt-auto-pro run dev` — run frontend locally

## Secrets Required (set in Replit Secrets)

| Secret | Purpose |
|---|---|
| `SESSION_SECRET` | Express session signing (already set) |
| `YOUTUBE_CLIENT_ID` | Google OAuth2 client ID |
| `YOUTUBE_CLIENT_SECRET` | Google OAuth2 client secret |
| `DRIVE_VIDEO_FOLDER_ID` | (optional) Google Drive folder for source videos |
| `DRIVE_AUDIO_FOLDER_ID` | (optional) Google Drive folder for audio tracks |
| `DRIVE_OUTPUT_FOLDER_ID` | (optional) Google Drive folder for processed output videos |

## Auth Flow

1. User visits app → dashboard shown immediately (no login gate)
2. "Connect Google" in sidebar → `/api/auth/google` → Google OAuth consent
3. Google redirects → `/api/auth/callback` → tokens stored in session + `globalTokens` (for scheduler)
4. YouTube/Drive features unlock; sidebar shows avatar + email

## Socket.io Events

All long-running jobs emit `job:update` with shape:
```ts
{ jobId, jobType, status, message, progress }
// jobType: "download_video" | "download_audio" | "process" | "upload"
// status:  "running" | "done" | "error"
// progress: 0-100
```
Floating `JobProgressPanel` in bottom-right corner shows live cards.
Sidebar shows spinning loader + count of active jobs.

## Video Categories (predefined)

Defined in `artifacts/yt-auto-pro/src/lib/categories.ts`:
`fish cutting`, `cooking`, `cake making`, `woodwork`, `satisfying`, `custom`

Used in: Videos tab (download + upload + edit), Audio tab, Process tab (filter), Schedule tab (default category).

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/healthz` | Health check |
| GET | `/api/auth/status` | Auth state + drive/youtube connectivity |
| GET | `/api/auth/google` | Redirect to Google OAuth |
| GET | `/api/auth/callback` | OAuth callback handler |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/videos` | List downloaded videos |
| PATCH | `/api/videos/:id/category` | Update video category |
| GET | `/api/audios` | List downloaded audio tracks |
| POST | `/api/download/video` | Queue Kuaishou video download(s) with socket progress |
| POST | `/api/download/audio` | Queue yt-dlp audio download(s) with socket progress |
| POST | `/api/process/preview` | Preview which videos/audio will be merged |
| POST | `/api/process` | Merge videos + audio → Drive + queue; socket progress |
| GET | `/api/queue` | List upload queue |
| POST | `/api/schedule` | Schedule a queue item |
| POST | `/api/upload-now` | Immediately upload a queue item to YouTube |
| GET | `/api/settings` | Get app settings |
| PATCH | `/api/settings` | Update app settings |
| GET | `/api/status` | Dashboard stats |
| GET | `/api/logs` | Activity logs |
| POST | `/api/upload/video` | Upload video file from device (multipart) |
| POST | `/api/upload/audio` | Upload audio file from device (multipart) |

## File Structure (api-server)

```
artifacts/api-server/src/
  app.ts              — Express app, CORS, session, pino-http
  index.ts            — HTTP server + Socket.io init + scheduler start
  lib/
    logger.ts         — Pino logger singleton
    socket.ts         — Socket.io singleton (setIO / getIO / emitJobUpdate)
  routes/             — Route handlers (auth, videos, audios, download, process, queue, settings, status, logs, upload, health)
  services/
    auth.ts           — OAuth2 client + globalTokens (setGlobalTokens / getGlobalTokens)
    data.ts           — JSON storage (videos, audios, queue, settings, logs)
    drive.ts          — Google Drive upload / download
    youtube.ts        — YouTube upload
    kuaishou.ts       — Puppeteer scraping with dynamic chromium path detection
    ytdlp.ts          — spawn-based yt-dlp with real-time progress + full metadata extraction
    ffmpeg.ts         — fluent-ffmpeg concat + 9:16 scale/pad with progress events
    scheduler.ts      — node-cron: due queue items + daily auto-cycle
  middlewares/
    auth.ts           — requireAuth + getSessionTokens helpers
  data/               — JSON storage files (auto-created at runtime)
```

## File Structure (yt-auto-pro frontend)

```
artifacts/yt-auto-pro/src/
  App.tsx                          — Root: sidebar nav + active job count + JobProgressPanel
  hooks/useSocket.ts               — Socket.io client hook (auto-remove done/error after 4s)
  lib/categories.ts                — VIDEO_CATEGORIES constant (predefined list)
  components/
    JobProgressPanel.tsx           — Floating bottom-right progress cards for all active jobs
    tabs/
      DashboardTab.tsx             — Stats + videos-by-category chart
      VideosTab.tsx                — Download from URL / upload from device / library table + category select
      AudioTab.tsx                 — Download from URL / upload from device / expandable metadata rows
      ProcessTab.tsx               — Config (audio pick + category filter) + preview plan + FFmpeg progress
      QueueTab.tsx                 — Upload queue management
      ScheduleTab.tsx              — Daily schedule + YouTube defaults + Drive folder mapping
      LogsTab.tsx                  — Activity log viewer
```

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
