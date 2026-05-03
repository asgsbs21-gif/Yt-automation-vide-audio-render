import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const DATA_DIR = path.resolve(process.cwd(), "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
}

export type QueueStatus =
  | "pending"
  | "scheduled"
  | "uploading"
  | "uploaded"
  | "failed";

export interface QueueItem {
  id: string;
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
}

// ── Upload slots ──────────────────────────────────────────────────────────────

export interface UploadSlot {
  id: string;       // stable identifier: "morning" | "afternoon" | "night"
  label: string;    // English label
  labelBn: string;  // Bangla label
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
  // Legacy field kept for backward compatibility — ignored by scheduler
  dailyUploadTime?: string;
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
};

// ── Videos ───────────────────────────────────────────────────────────────────

export function getVideos(): Video[] {
  return readJson<Video[]>("videos.json", []);
}

export function saveVideos(videos: Video[]): void {
  writeJson("videos.json", videos);
}

export function addVideo(video: Omit<Video, "id" | "addedAt">): Video {
  const videos = getVideos();
  const newVideo: Video = {
    ...video,
    id: uuidv4(),
    addedAt: new Date().toISOString(),
  };
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

export function getVideosByCategory(category: string): Video[] {
  return getVideos().filter((v) => v.category === category && v.available);
}

export function pickVideosForDuration(
  category: string | null,
  durationSeconds: number
): Video[] {
  let pool = getVideos().filter((v) => v.available && v.status === "available");
  if (category) pool = pool.filter((v) => v.category === category);

  pool.sort((a, b) => {
    if (a.usedCount !== b.usedCount) return a.usedCount - b.usedCount;
    const aTime = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
    const bTime = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
    return aTime - bTime;
  });

  const avgDuration = 30;
  const needed = Math.ceil(durationSeconds / avgDuration);
  const selected = pool.slice(0, Math.max(1, needed));

  const allUsed = pool.every((v) => v.usedCount > 0);
  if (allUsed && pool.length > 0) {
    const videos = getVideos();
    for (const v of pool) {
      const idx = videos.findIndex((x) => x.id === v.id);
      if (idx !== -1) videos[idx].usedCount = 0;
    }
    saveVideos(videos);
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
  return readJson<Audio[]>("audios.json", []);
}

export function saveAudios(audios: Audio[]): void {
  writeJson("audios.json", audios);
}

export function addAudio(audio: Omit<Audio, "id" | "addedAt">): Audio {
  const audios = getAudios();
  const newAudio: Audio = {
    ...audio,
    id: uuidv4(),
    addedAt: new Date().toISOString(),
  };
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

// ── Queue ────────────────────────────────────────────────────────────────────

export function getQueue(): QueueItem[] {
  return readJson<QueueItem[]>("queue.json", []);
}

export function saveQueue(queue: QueueItem[]): void {
  writeJson("queue.json", queue);
}

export function addQueueItem(
  item: Omit<QueueItem, "id" | "createdAt">
): QueueItem {
  const queue = getQueue();
  const newItem: QueueItem = {
    ...item,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  queue.push(newItem);
  saveQueue(queue);
  return newItem;
}

export function updateQueueItem(
  id: string,
  update: Partial<QueueItem>
): QueueItem | null {
  const queue = getQueue();
  const idx = queue.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  queue[idx] = { ...queue[idx], ...update };
  saveQueue(queue);
  return queue[idx];
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  const raw = readJson<Partial<AppSettings>>("settings.json", {});

  // Migrate: old settings may have dailyUploadTime but no uploadSlots
  if (!raw.uploadSlots || raw.uploadSlots.length === 0) {
    const legacyTime = (raw as any).dailyUploadTime as string | undefined;
    raw.uploadSlots = DEFAULT_SLOTS.map((s, i) =>
      i === 0 && legacyTime ? { ...s, time: legacyTime, enabled: true } : s
    );
  }

  // Ensure all 3 slot ids exist (in case we add slots in future)
  const existingIds = new Set(raw.uploadSlots.map((s) => s.id));
  for (const def of DEFAULT_SLOTS) {
    if (!existingIds.has(def.id)) raw.uploadSlots.push({ ...def });
  }

  return { ...defaultSettings, ...raw } as AppSettings;
}

export function saveSettings(settings: AppSettings): void {
  writeJson("settings.json", settings);
}

// ── Logs ─────────────────────────────────────────────────────────────────────

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
