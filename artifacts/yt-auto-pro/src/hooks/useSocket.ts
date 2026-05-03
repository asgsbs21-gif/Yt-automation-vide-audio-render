import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export interface JobUpdate {
  jobId: string;
  jobType: "download_video" | "download_audio" | "process" | "upload";
  status: "running" | "done" | "error";
  message: string;
  progress: number;
}

const AUTO_REMOVE_MS = 4000;

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [jobs, setJobs] = useState<Map<string, JobUpdate>>(new Map());

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io({
        path: "/api/socket.io",
        transports: ["polling", "websocket"],
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
      });
    }

    const socket = socketRef.current;

    const handleUpdate = (data: JobUpdate) => {
      setJobs((prev) => {
        const next = new Map(prev);
        next.set(data.jobId, data);
        return next;
      });

      if (data.status === "done" || data.status === "error") {
        setTimeout(() => {
          setJobs((prev) => {
            const next = new Map(prev);
            next.delete(data.jobId);
            return next;
          });
        }, AUTO_REMOVE_MS);
      }
    };

    socket.on("job:update", handleUpdate);

    return () => {
      socket.off("job:update", handleUpdate);
    };
  }, []);

  const activeJobs = Array.from(jobs.values());
  const runningCount = activeJobs.filter((j) => j.status === "running").length;

  return { jobs: activeJobs, runningCount };
}
