import { useGetStatus } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, Video, Music, ListOrdered, CheckCircle2, XCircle,
  TrendingUp, Users, Eye, Film, Clock, RefreshCw,
} from "lucide-react";
import { format } from "date-fns";

function useUploadStats() {
  return useQuery({
    queryKey: ["upload-stats"],
    queryFn: async () => {
      const res = await fetch("/api/upload-stats");
      if (!res.ok) throw new Error("Failed to fetch upload stats");
      return res.json() as Promise<{
        today: { total: number; uploaded: number; failed: number; pending: number };
        week: { total: number; uploaded: number; failed: number; pending: number };
        allTime: { total: number; uploaded: number; failed: number; pending: number };
        nextScheduled: { title: string; scheduledAt: string } | null;
        recentUploads: { id: string; title: string; youtubeUrl: string | null; createdAt: string }[];
      }>;
    },
    refetchInterval: 30000,
  });
}

function useChannelStats() {
  return useQuery({
    queryKey: ["channel-stats"],
    queryFn: async () => {
      const res = await fetch("/api/channel-stats");
      if (res.status === 401) return null;
      if (!res.ok) return null;
      return res.json() as Promise<{
        channelTitle: string;
        subscriberCount: string;
        viewCount: string;
        videoCount: string;
        cachedAt: string;
      }>;
    },
    retry: false,
    refetchInterval: 30 * 60 * 1000,
  });
}

export function DashboardTab() {
  const { data: status, isLoading } = useGetStatus();
  const { data: uploadStats, isLoading: statsLoading } = useUploadStats();
  const { data: channelStats } = useChannelStats();

  if (isLoading || !status) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Status</h2>
          <p className="text-muted-foreground">Overview of your automation pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={status.driveConnected ? "outline" : "destructive"} className="px-3 py-1">
            {status.driveConnected ? <CheckCircle2 className="w-3 h-3 mr-2 text-green-500" /> : <XCircle className="w-3 h-3 mr-2" />}
            Google Drive
          </Badge>
          <Badge variant={status.youtubeConnected ? "outline" : "destructive"} className="px-3 py-1">
            {status.youtubeConnected ? <CheckCircle2 className="w-3 h-3 mr-2 text-green-500" /> : <XCircle className="w-3 h-3 mr-2" />}
            YouTube
          </Badge>
        </div>
      </div>

      {/* System counts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Videos</CardTitle>
            <Video className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.totalVideos}</div>
            <p className="text-xs text-muted-foreground mt-1">{status.availableVideos} available</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Audio</CardTitle>
            <Music className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.totalAudios}</div>
            <p className="text-xs text-muted-foreground mt-1">{status.unusedAudios} unused</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Queue Status</CardTitle>
            <ListOrdered className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.queueCount}</div>
            <p className="text-xs text-muted-foreground mt-1">{status.scheduledCount} scheduled</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Jobs</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.activeJobs}</div>
            <p className="text-xs text-muted-foreground mt-1">{status.uploadedCount} uploaded total</p>
          </CardContent>
        </Card>
      </div>

      {/* Upload Report */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Upload Report
          </CardTitle>
          {statsLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            {(["today", "week", "allTime"] as const).map((period) => {
              const labels = { today: "Today", week: "Last 7 Days", allTime: "All Time" };
              const d = uploadStats?.[period];
              return (
                <div key={period} className="bg-muted/40 rounded-lg p-3 text-center border border-border">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {labels[period]}
                  </div>
                  <div className="text-3xl font-bold text-green-500">{d?.uploaded ?? 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    uploaded
                    {(d?.failed ?? 0) > 0 && (
                      <span className="ml-1 text-red-500">· {d?.failed} failed</span>
                    )}
                    {(d?.pending ?? 0) > 0 && (
                      <span className="ml-1 text-blue-500">· {d?.pending} pending</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {uploadStats?.nextScheduled && (
            <div className="flex items-center gap-2 text-sm border border-blue-500/20 bg-blue-500/5 rounded-lg px-4 py-2.5">
              <Clock className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="text-muted-foreground">Next scheduled:</span>
              <span className="font-medium truncate">{uploadStats.nextScheduled.title}</span>
              <span className="text-muted-foreground ml-auto shrink-0">
                {format(new Date(uploadStats.nextScheduled.scheduledAt!), "PPp")}
              </span>
            </div>
          )}

          {uploadStats && uploadStats.recentUploads.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent Uploads</p>
              <div className="space-y-1">
                {uploadStats.recentUploads.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                    <span className="truncate max-w-[280px] font-medium" title={item.title}>{item.title}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {item.youtubeUrl && (
                        <a
                          href={item.youtubeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-red-500 underline underline-offset-2 hover:text-red-400"
                        >
                          YouTube
                        </a>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(item.createdAt), "MMM d")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Channel Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" /> Channel Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!channelStats ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>Connect your Google account to see channel statistics.</p>
              <p className="text-xs mt-1 text-muted-foreground/60">Stats are cached for 30 minutes.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-semibold text-base">{channelStats.channelTitle}</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-muted/40 rounded-lg p-3 text-center border border-border">
                  <div className="flex items-center justify-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    <Users className="w-3 h-3" /> Subscribers
                  </div>
                  <div className="text-2xl font-bold">
                    {parseInt(channelStats.subscriberCount).toLocaleString()}
                  </div>
                </div>
                <div className="bg-muted/40 rounded-lg p-3 text-center border border-border">
                  <div className="flex items-center justify-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    <Eye className="w-3 h-3" /> Total Views
                  </div>
                  <div className="text-2xl font-bold">
                    {parseInt(channelStats.viewCount).toLocaleString()}
                  </div>
                </div>
                <div className="bg-muted/40 rounded-lg p-3 text-center border border-border">
                  <div className="flex items-center justify-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    <Film className="w-3 h-3" /> Videos
                  </div>
                  <div className="text-2xl font-bold">
                    {parseInt(channelStats.videoCount).toLocaleString()}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                Cached at {format(new Date(channelStats.cachedAt), "PPp")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Videos by Category */}
      <Card>
        <CardHeader>
          <CardTitle>Videos by Category</CardTitle>
        </CardHeader>
        <CardContent>
          {status.videosByCategory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No videos available</div>
          ) : (
            <div className="space-y-4">
              {status.videosByCategory.map(cat => (
                <div key={cat.category} className="flex items-center justify-between">
                  <div className="font-medium">{cat.category || "Uncategorized"}</div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{cat.usedCount} used</span>
                    <span className="font-bold">{cat.count} total</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
