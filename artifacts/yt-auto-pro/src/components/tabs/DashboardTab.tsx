import { useGetStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Video, Music, ListOrdered, CheckCircle2, XCircle } from "lucide-react";

export function DashboardTab() {
  const { data: status, isLoading } = useGetStatus();

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Videos</CardTitle>
            <Video className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.totalVideos}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {status.availableVideos} available
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Audio</CardTitle>
            <Music className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.totalAudios}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {status.unusedAudios} unused
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Queue Status</CardTitle>
            <ListOrdered className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.queueCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {status.scheduledCount} scheduled
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Jobs</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.activeJobs}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {status.uploadedCount} uploaded total
            </p>
          </CardContent>
        </Card>
      </div>

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
