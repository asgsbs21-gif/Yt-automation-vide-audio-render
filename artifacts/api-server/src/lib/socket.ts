import type { Server } from "socket.io";

let _io: Server | null = null;

export function setIO(io: Server): void {
  _io = io;
}

export function getIO(): Server | null {
  return _io;
}

export type JobType = "download_video" | "download_audio" | "process" | "upload";
export type JobStatus = "running" | "done" | "error";

export interface JobUpdate {
  jobId: string;
  jobType: JobType;
  status: JobStatus;
  message: string;
  progress: number;
}

export function emitJobUpdate(update: JobUpdate): void {
  _io?.emit("job:update", update);
}
