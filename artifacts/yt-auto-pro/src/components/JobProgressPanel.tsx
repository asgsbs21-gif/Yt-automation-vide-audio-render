import { useSocket, type JobUpdate } from "@/hooks/useSocket";
import { Progress } from "@/components/ui/progress";
import { Download, Music, Settings2, Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";

function jobIcon(type: JobUpdate["jobType"]) {
  switch (type) {
    case "download_video": return <Download className="w-3.5 h-3.5 shrink-0" />;
    case "download_audio": return <Music className="w-3.5 h-3.5 shrink-0" />;
    case "process":        return <Settings2 className="w-3.5 h-3.5 shrink-0" />;
    case "upload":         return <Upload className="w-3.5 h-3.5 shrink-0" />;
  }
}

function jobLabel(type: JobUpdate["jobType"]) {
  switch (type) {
    case "download_video": return "Video";
    case "download_audio": return "Audio";
    case "process":        return "Process";
    case "upload":         return "Upload";
  }
}

function statusIcon(status: JobUpdate["status"]) {
  if (status === "done")  return <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />;
  if (status === "error") return <XCircle className="w-3 h-3 text-red-500 shrink-0" />;
  return <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />;
}

export function JobProgressPanel() {
  const { jobs } = useSocket();

  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[340px] w-full pointer-events-none">
      {jobs.map((job) => (
        <div
          key={job.jobId}
          className={`pointer-events-auto rounded-lg border shadow-lg bg-card/95 backdrop-blur-sm p-3 text-xs transition-all duration-300 ${
            job.status === "error"
              ? "border-red-500/30 bg-red-500/5"
              : job.status === "done"
              ? "border-green-500/30 bg-green-500/5"
              : "border-border"
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className={
              job.status === "error" ? "text-red-500" :
              job.status === "done"  ? "text-green-500" : "text-primary"
            }>
              {jobIcon(job.jobType)}
            </span>
            <span className="font-semibold text-foreground">{jobLabel(job.jobType)}</span>
            <div className="flex-1" />
            {statusIcon(job.status)}
          </div>
          <p className="text-muted-foreground truncate mb-2" title={job.message}>
            {job.message}
          </p>
          <Progress
            value={job.status === "done" ? 100 : job.status === "error" ? 0 : job.progress}
            className={`h-1.5 ${
              job.status === "error" ? "[&>div]:bg-red-500" :
              job.status === "done"  ? "[&>div]:bg-green-500" : ""
            }`}
          />
        </div>
      ))}
    </div>
  );
}
