# YT Auto Pro — Workspace

## Overview

pnpm workspace monorepo using TypeScript. Full YouTube Shorts automation app.
Users log in with Google OAuth2 to connect Google Drive and YouTube. The app
downloads Kuaishou videos (Puppeteer), downloads audio (yt-dlp), merges them
with FFmpeg, and schedules uploads to YouTube.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS (dark theme)
- **API framework**: Express 5
- **Storage**: JSON files in `artifacts/api-server/data/` (no DB required)
- **Auth**: Google OAuth2 via `googleapis` + `express-session`
- **Video processing**: Puppeteer (Kuaishou scraping), yt-dlp (audio), FFmpeg (merge)
- **Scheduling**: node-cron
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (ESM bundle)

## Artifacts

| Artifact | Path | Description |
|---|---|---|
| `yt-auto-pro` | `/` | React frontend — 7-tab cockpit (Dashboard, Videos, Audio, Process, Queue, Schedule, Logs) |
| `api-server` | `/api` | Express API — auth, download, process, queue, upload |

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

1. User visits app → sees "Connect with Google" login page
2. Click redirects to `/api/auth/google` → Google OAuth consent screen
3. Google redirects to `/api/auth/callback` → tokens stored in session
4. Frontend shows full cockpit UI

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
| POST | `/api/download/video` | Queue Kuaishou video download(s) |
| POST | `/api/download/audio` | Queue yt-dlp audio download(s) |
| POST | `/api/process/preview` | Preview which videos/audio will be merged |
| POST | `/api/process` | Merge videos + audio → upload to Drive |
| GET | `/api/queue` | List upload queue |
| POST | `/api/schedule` | Schedule a queue item |
| POST | `/api/upload-now` | Immediately upload a queue item to YouTube |
| GET | `/api/settings` | Get app settings |
| PATCH | `/api/settings` | Update app settings |
| GET | `/api/status` | Dashboard stats |
| GET | `/api/logs` | Activity logs |

## File Structure (api-server)

```
artifacts/api-server/src/
  app.ts              — Express app, session middleware
  index.ts            — Server entry point
  routes/             — Route handlers (auth, videos, audios, download, process, queue, settings, status, logs)
  services/           — Business logic (auth, data, drive, youtube, kuaishou, ytdlp, ffmpeg, scheduler)
  middlewares/        — requireAuth middleware
  lib/logger.ts       — Pino logger singleton
  data/               — JSON storage files (auto-created at runtime)
```

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
