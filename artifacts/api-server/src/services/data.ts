import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const DATA_DIR = path.resolve(process.cwd(), "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(filename: string, defaultValue: T): T {
  ensureDataDir();
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return defaultValue;
  }
}

function writeJson<T>(filename: string, data: T): void {
  ensureDataDir();
  const file = path.join(DATA_DIR, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

// ── Types ────────────────────────────────────────────────────────────────────

export type VideoStatus = "available" | "processing" | "unavailable";

export interface Video {
  id: string;
  driveId: string;
  filename: string;
  category: string;
  duration: number;      // seconds; 0 = unknown (legacy video without probed duration)
  usedCount: number;
  lastUsed: string | null;
  available: boolean;
  driveLink: string | null;
  addedAt: string;
  status: VideoStatus;
}

export interface Audio {
  id: string;
  driveId: string;
  title: string;
  description: string;
  tags: string[];
  duration: number;
  category: string | null;
  uploader: string | null;
  used: boolean;
  driveLink: string | null;
  addedAt: string;
  trimStart: number | null;
  trimEnd: number | null;
}

export type QueueStatus =
  | "pending"
  | "scheduled"
  | "uploading"
  | "uploaded"
  | "failed";

export interface QueueItem {
  id: string;
  jobId: string | null;
  driveId: string;
  title: string;
  description: string;
  tags: string[];
  scheduledAt: string | null;
  status: QueueStatus;
  youtubeUrl: string | null;
  youtubeId: string | null;
  error: string | null;
  createdAt: string;
  thumbnailPath: string | null;
  retryCount: number;
  lastRetryAt: string | null;
}

export interface UploadSlot {
  id: string;
  label: string;
  labelBn: string;
  time: string;     // "HH:MM" 24-hour
  enabled: boolean;
}

export interface AppSettings {
  uploadSlots: UploadSlot[];
  autoCycleEnabled: boolean;
  maxRetries: number;
  defaultCategory: string;
  youtubeCategoryId: string;
  driveVideoFolderId: string | null;
  driveAudioFolderId: string | null;
  driveOutputFolderId: string | null;
  dailyUploadTime?: string;
  thumbnailEnabled: boolean;
  thumbnailBgColor: string;
  telegramEnabled: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  watermarkEnabled: boolean;
  speedMultiplier: number;
  normalizeVolume: boolean;
  autoRetryEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  vmessLink: string | null;
}

export type LogLevel = "info" | "warn" | "error" | "success";
export type JobType =
  | "download_video"
  | "download_audio"
  | "process"
  | "upload"
  | "schedule";

export interface LogEntry {
  id: string;
  jobType: JobType;
  level: LogLevel;
  message: string;
  details: string | null;
  createdAt: string;
}

// ── Default values ────────────────────────────────────────────────────────────

const DEFAULT_SLOTS: UploadSlot[] = [
  { id: "morning",   label: "Morning",   labelBn: "সকাল", time: "09:00", enabled: true  },
  { id: "afternoon", label: "Afternoon", labelBn: "দুপুর", time: "14:00", enabled: false },
  { id: "night",     label: "Night",     labelBn: "রাত",   time: "19:00", enabled: false },
];

const defaultSettings: AppSettings = {
  uploadSlots: DEFAULT_SLOTS,
  autoCycleEnabled: false,
  maxRetries: 3,
  defaultCategory: "satisfying",
  youtubeCategoryId: "22",
  driveVideoFolderId: null,
  driveAudioFolderId: null,
  driveOutputFolderId: null,
  thumbnailEnabled: false,
  thumbnailBgColor: "yellow",
  telegramEnabled: false,
  telegramBotToken: null,
  telegramChatId: null,
  watermarkEnabled: false,
  speedMultiplier: 1.0,
  normalizeVolume: false,
  autoRetryEnabled: false,
  googleClientId: "",
  googleClientSecret: "",
  vmessLink: null,
};

// ── Auto-cycle category rotation state ───────────────────────────────────────
//
// Persisted in data/state.json so rotation survives server restarts.

interface AutoCycleState {
  lastCategory: string | null;
}

function readState(): AutoCycleState {
  return readJson<AutoCycleState>("state.json", { lastCategory: null });
}

function writeState(state: AutoCycleState): void {
  writeJson("state.json", state);
}

/** Returns the category used in the most recent auto-cycle run. */
export function getLastAutoCycleCategory(): string | null {
  return readState().lastCategory;
}

/** Persists the category chosen for this auto-cycle run. */
export function setLastAutoCycleCategory(category: string): void {
  writeState({ ...readState(), lastCategory: category });
}

/**
 * Returns sorted unique category names that currently have at least one
 * available video. Used by the scheduler to build the rotation list.
 */
export function getDistinctVideoCategories(): string[] {
  const videos = getVideos().filter((v) => v.available && v.status === "available");
  const cats = [...new Set(videos.map((v) => v.category))];
  return cats.sort();
}

// ── Videos ───────────────────────────────────────────────────────────────────

export function getVideos(): Video[] {
  return readJson<Video[]>("videos.json", []).map((v) => ({
    duration: 0,    // default for legacy records without duration
    ...v,
  }));
}

export function saveVideos(videos: Video[]): void {
  writeJson("videos.json", videos);
}

export function addVideo(video: Omit<Video, "id" | "addedAt">): Video {
  const videos = getVideos();
  const newVideo: Video = { ...video, id: uuidv4(), addedAt: new Date().toISOString() };
  videos.push(newVideo);
  saveVideos(videos);
  return newVideo;
}

export function updateVideo(id: string, update: Partial<Video>): Video | null {
  const videos = getVideos();
  const idx = videos.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  videos[idx] = { ...videos[idx], ...update };
  saveVideos(videos);
  return videos[idx];
}

/**
 * Pick videos from the pool whose estimated total duration covers `durationSeconds`.
 *
 * Algorithm:
 *  1. Sort pool by least used (ties broken by oldest lastUsed).
 *  2. Greedily pick videos until cumulative duration ≥ target.
 *     Uses stored `duration` when > 0; falls back to FALLBACK_DURATION_S for
 *     legacy videos whose duration was never probed.
 *  3. If the entire unique pool is exhausted before covering the target, allow
 *     re-selecting from the beginning of the sorted pool (pool cycling) up to
 *     MAX_CYCLES passes. This handles pools where every video is too short.
 *  4. Auto-resets usedCount for the pool when all clips have been used at least
 *     once, so the scheduler never runs out of "fresh" videos.
 *
 * NOTE: The actual ffmpeg process probes real file durations after download and
 * fetches additional clips if the total is still short. This function is a fast
 * pre-selection that minimises unnecessary downloads.
 */
const FALLBACK_DURATION_S = 30; // assumed seconds for videos with no stored duration
const MAX_CYCLES = 5;           // maximum pool wrap-arounds before giving up

export function pickVideosForDuration(
  category: string | null,
  durationSeconds: number
): Video[] {
  let pool = getVideos().filter((v) => v.available && v.status === "available");
  if (category) pool = pool.filter((v) => v.category === category);
  if (pool.length === 0) return [];

  const sortPool = (p: Video[]) =>
    [...p].sort((a, b) => {
      if (a.usedCount !== b.usedCount) return a.usedCount - b.usedCount;
      const aT = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
      const bT = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
      return aT - bT;
    });

  let sorted = sortPool(pool);

  // Auto-reset if every video in the pool has been used at least once
  if (sorted.every((v) => v.usedCount > 0)) {
    const all = getVideos();
    for (const v of sorted) {
      const idx = all.findIndex((x) => x.id === v.id);
      if (idx !== -1) all[idx].usedCount = 0;
    }
    saveVideos(all);
    // Re-read after reset so fresh sort order applies
    pool = getVideos().filter(
      (v) => v.available && v.status === "available" && (!category || v.category === category)
    );
    sorted = sortPool(pool);
  }

  const selected: Video[] = [];
  let totalDuration = 0;
  let cycle = 0;
  let i = 0;

  while (totalDuration < durationSeconds) {
    if (i >= sorted.length) {
      // Wrap around — start a new cycle through the sorted pool
      cycle++;
      if (cycle >= MAX_CYCLES) break;
      i = 0;
    }

    const v = sorted[i];

    // Safety: don't pick the same clip more than MAX_CYCLES times
    const alreadyPicked = selected.filter((s) => s.id === v.id).length;
    if (alreadyPicked >= MAX_CYCLES) { i++; continue; }

    const clipDuration = v.duration > 0 ? v.duration : FALLBACK_DURATION_S;
    selected.push(v);
    totalDuration += clipDuration;
    i++;
  }

  return selected;
}

/**
 * Pick additional videos from the pool, excluding IDs already chosen.
 * Used by the process/scheduler after probing actual file durations to top up
 * when the real total duration is still less than the audio duration.
 */
export function pickAdditionalVideos(
  category: string | null,
  excludeIds: Set<string>,
  neededSeconds: number
): Video[] {
  let pool = getVideos().filter(
    (v) => v.available && v.status === "available" && !excludeIds.has(v.id)
  );
  if (category) pool = pool.filter((v) => v.category === category);
  if (pool.length === 0) return [];

  pool.sort((a, b) => {
    if (a.usedCount !== b.usedCount) return a.usedCount - b.usedCount;
    const aT = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
    const bT = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
    return aT - bT;
  });

  const selected: Video[] = [];
  let total = 0;
  for (const v of pool) {
    if (total >= neededSeconds) break;
    selected.push(v);
    total += v.duration > 0 ? v.duration : FALLBACK_DURATION_S;
  }
  return selected;
}

export function markVideosUsed(ids: string[]): void {
  const videos = getVideos();
  for (const id of ids) {
    const idx = videos.findIndex((v) => v.id === id);
    if (idx !== -1) {
      videos[idx].usedCount += 1;
      videos[idx].lastUsed = new Date().toISOString();
    }
  }
  saveVideos(videos);
}

// ── Audios ───────────────────────────────────────────────────────────────────

export function getAudios(): Audio[] {
  return readJson<Audio[]>("audios.json", []).map((a) => ({
    trimStart: null,
    trimEnd: null,
    ...a,
  }));
}

export function saveAudios(audios: Audio[]): void {
  writeJson("audios.json", audios);
}

export function addAudio(audio: Omit<Audio, "id" | "addedAt" | "trimStart" | "trimEnd">): Audio {
  const audios = getAudios();
  const newAudio: Audio = { trimStart: null, trimEnd: null, ...audio, id: uuidv4(), addedAt: new Date().toISOString() };
  audios.push(newAudio);
  saveAudios(audios);
  return newAudio;
}

export function getRandomUnusedAudio(category?: string | null): Audio | null {
  let pool = getAudios().filter((a) => !a.used);
  if (category) pool = pool.filter((a) => a.category === category);
  if (pool.length === 0) pool = getAudios();
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function updateAudio(id: string, update: Partial<Audio>): Audio | null {
  const audios = getAudios();
  const idx = audios.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  audios[idx] = { ...audios[idx], ...update };
  saveAudios(audios);
  return audios[idx];
}

export function markAudioUsed(id: string): void {
  const audios = getAudios();
  const idx = audios.findIndex((a) => a.id === id);
  if (idx !== -1) {
    audios[idx].used = true;
    saveAudios(audios);
  }
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export function getQueue(): QueueItem[] {
  return readJson<QueueItem[]>("queue.json", []).map((q) => ({
    retryCount: 0,
    lastRetryAt: null,
    jobId: null,
    thumbnailPath: null,
    ...q,
  }));
}

export function saveQueue(queue: QueueItem[]): void {
  writeJson("queue.json", queue);
}

export function addQueueItem(item: Omit<QueueItem, "id" | "createdAt" | "retryCount" | "lastRetryAt">): QueueItem {
  const queue = getQueue();
  const newItem: QueueItem = { retryCount: 0, lastRetryAt: null, ...item, id: uuidv4(), createdAt: new Date().toISOString() };
  queue.push(newItem);
  saveQueue(queue);
  return newItem;
}

export function updateQueueItem(id: string, update: Partial<QueueItem>): QueueItem | null {
  const queue = getQueue();
  const idx = queue.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  queue[idx] = { ...queue[idx], ...update };
  saveQueue(queue);
  return queue[idx];
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  const raw = readJson<Partial<AppSettings>>("settings.json", {});

  if (!raw.uploadSlots || raw.uploadSlots.length === 0) {
    const legacyTime = (raw as any).dailyUploadTime as string | undefined;
    raw.uploadSlots = DEFAULT_SLOTS.map((s, i) =>
      i === 0 && legacyTime ? { ...s, time: legacyTime, enabled: true } : s
    );
  }

  const existingIds = new Set(raw.uploadSlots.map((s) => s.id));
  for (const def of DEFAULT_SLOTS) {
    if (!existingIds.has(def.id)) raw.uploadSlots.push({ ...def });
  }

  return { ...defaultSettings, ...raw } as AppSettings;
}

export function saveSettings(settings: AppSettings): void {
  writeJson("settings.json", settings);
}

// ── Logs ──────────────────────────────────────────────────────────────────────

const MAX_LOGS = 500;

export function getLogs(): LogEntry[] {
  return readJson<LogEntry[]>("logs.json", []);
}

export function addLog(
  jobType: JobType,
  level: LogLevel,
  message: string,
  details?: string
): LogEntry {
  const logs = getLogs();
  const entry: LogEntry = {
    id: uuidv4(),
    jobType,
    level,
    message,
    details: details ?? null,
    createdAt: new Date().toISOString(),
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
  writeJson("logs.json", logs);
  return entry;
}
