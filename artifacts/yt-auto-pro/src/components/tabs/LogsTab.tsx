import { useEffect, useState, useRef } from "react";
import { useGetLogs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Terminal } from "lucide-react";
import { format } from "date-fns";

export function LogsTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Use Tanstack Query with refetchInterval for polling
  const { data, isLoading } = useGetLogs(
    { limit: 100 }, 
    { query: { refetchInterval: 3000 } }
  );

  useEffect(() => {
    if (data) {
      setLogs(data);
    }
  }, [data]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case "info": return "text-blue-400";
      case "warn": return "text-yellow-400";
      case "error": return "text-red-400";
      case "success": return "text-green-400";
      default: return "text-gray-400";
    }
  };

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Logs</h2>
          <p className="text-muted-foreground">Real-time pipeline execution feed</p>
        </div>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden bg-black border-border shadow-inner">
        <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex items-center gap-2 shrink-0">
          <Terminal className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-mono text-zinc-400">stdout</span>
        </div>
        <CardContent className="flex-1 p-0 overflow-hidden relative">
          <div 
            ref={scrollRef}
            className="absolute inset-0 overflow-y-auto p-4 space-y-1 font-mono text-sm"
          >
            {logs.length === 0 && !isLoading ? (
              <div className="text-zinc-600 text-center py-10">No logs available</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="flex gap-3 hover:bg-zinc-900/50 p-1 rounded transition-colors group">
                  <span className="text-zinc-500 shrink-0 select-none">
                    {format(new Date(log.createdAt), 'HH:mm:ss')}
                  </span>
                  <span className={`shrink-0 w-16 select-none ${getLevelColor(log.level)}`}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="text-zinc-400 shrink-0 w-32 select-none truncate">
                    {log.jobType}
                  </span>
                  <span className="text-zinc-300 break-words">
                    {log.message}
                    {log.details && (
                      <span className="text-zinc-600 ml-2 hidden group-hover:inline">
                        — {log.details}
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
