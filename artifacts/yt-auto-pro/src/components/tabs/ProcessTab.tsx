import { useState } from "react";
import {
  useListAudios,
  usePreviewProcess,
  useProcessVideo,
  getListQueueQueryKey,
  getGetStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/useSocket";
import { Loader2, Settings2, Play, AlertCircle, Clock, Video, Music, Scissors } from "lucide-react";
import { VIDEO_CATEGORIES } from "@/lib/categories";

export function ProcessTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [audioId, setAudioId] = useState<string>("random");
  const [categoryFilter, setCategoryFilter] = useState<string>("any");
  const [addToQueue, setAddToQueue] = useState(true);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: audios, isLoading: audiosLoading } = useListAudios();
  const previewMutation = usePreviewProcess();
  const processMutation = useProcessVideo();
  const { jobs } = useSocket();

  const activeJob = activeJobId ? jobs.find((j) => j.jobId === activeJobId) : null;

  const handlePreview = () => {
    previewMutation.mutate(
      {
        data: {
          audioId: audioId === "random" ? undefined : audioId,
          categoryFilter: categoryFilter === "any" ? undefined : categoryFilter,
        },
      },
      {
        onError: (err: any) => {
          toast({ title: "Preview Error", description: err.message || "Failed to generate preview", variant: "destructive" });
        },
      }
    );
  };

  const handleProcess = () => {
    processMutation.mutate(
      {
        data: {
          audioId: audioId === "random" ? undefined : audioId,
          categoryFilter: categoryFilter === "any" ? undefined : categoryFilter,
          addToQueue,
        },
      },
      {
        onSuccess: (data: any) => {
          toast({ title: "Processing Started", description: "FFmpeg is merging your clips. Watch the progress panel." });
          if (data?.jobId) setActiveJobId(data.jobId);
          queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatusQueryKey() });
          previewMutation.reset();
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to start processing", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Process & Merge</h2>
        <p className="text-muted-foreground">
          Pick an audio track, filter videos by category, and FFmpeg will concat clips, mute originals, and overlay the audio in 9:16 (1080×1920).
        </p>
      </div>

      {/* Active job progress */}
      {activeJob && (
        <Card className={`border-2 ${
          activeJob.status === "error" ? "border-red-500/40 bg-red-500/5" :
          activeJob.status === "done"  ? "border-green-500/40 bg-green-500/5" :
          "border-primary/40 bg-primary/5"
        }`}>
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {activeJob.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                <span className="font-medium">{activeJob.message}</span>
              </div>
              <span className="text-muted-foreground">{activeJob.progress}%</span>
            </div>
            <Progress
              value={activeJob.status === "done" ? 100 : activeJob.status === "error" ? 0 : activeJob.progress}
              className={`h-2 ${activeJob.status === "error" ? "[&>div]:bg-red-500" : activeJob.status === "done" ? "[&>div]:bg-green-500" : ""}`}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Configuration */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Pick your audio and video category</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Audio Track</Label>
              <Select value={audioId} onValueChange={setAudioId} disabled={audiosLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select audio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">🎲 Random Unused Audio</SelectItem>
                  {audios?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="truncate max-w-[200px]">
                        {a.title} ({Math.floor(a.duration / 60)}:{Math.floor(a.duration % 60).toString().padStart(2, "0")})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {audios && audios.length === 0 && (
                <p className="text-xs text-muted-foreground">No audio in library yet — go to the Audio tab to download some.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Video Category Filter</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Any category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All Categories</SelectItem>
                  {VIDEO_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Least-used videos are picked first. Cycle resets when all are used.
              </p>
            </div>

            <div className="flex items-center justify-between space-x-2 pt-2 border-t border-border">
              <Label htmlFor="add-queue" className="flex flex-col space-y-1">
                <span>Add to Queue</span>
                <span className="font-normal text-[0.8rem] text-muted-foreground">Schedule upload after processing</span>
              </Label>
              <Switch id="add-queue" checked={addToQueue} onCheckedChange={setAddToQueue} />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button
              variant="secondary"
              className="w-full"
              onClick={handlePreview}
              disabled={previewMutation.isPending}
            >
              {previewMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Settings2 className="w-4 h-4 mr-2" />}
              Preview Plan
            </Button>
            <Button
              className="w-full"
              onClick={handleProcess}
              disabled={processMutation.isPending || !previewMutation.data}
            >
              {processMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Play className="w-4 h-4 mr-2" />}
              Start Processing
            </Button>
          </CardFooter>
        </Card>

        {/* Preview */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Preview Plan</CardTitle>
            <CardDescription>
              {previewMutation.data
                ? "What will be merged — click 'Start Processing' to run FFmpeg"
                : "Click 'Preview Plan' to see which clips and audio will be used"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {previewMutation.isPending ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                <p>Selecting clips by usage count…</p>
              </div>
            ) : previewMutation.isError ? (
              <div className="flex flex-col items-center justify-center py-12 text-destructive">
                <AlertCircle className="w-8 h-8 mb-4" />
                <p>No matching videos or audio found. Check your library.</p>
              </div>
            ) : previewMutation.data ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-secondary/50 p-4 rounded-lg border border-border">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Music className="w-3 h-3" /> Audio
                    </div>
                    <div className="font-medium truncate text-sm" title={previewMutation.data.audio?.title}>
                      {previewMutation.data.audio?.title || "Unknown"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {Math.floor(previewMutation.data.estimatedDuration / 60)}:{Math.floor(previewMutation.data.estimatedDuration % 60).toString().padStart(2, "0")} duration
                    </div>
                    {previewMutation.data.audio?.tags && previewMutation.data.audio.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {previewMutation.data.audio.tags.slice(0, 3).map((t: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px]">#{t}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="bg-secondary/50 p-4 rounded-lg border border-border">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Scissors className="w-3 h-3" /> Output
                    </div>
                    <div className="font-medium text-sm">{previewMutation.data.videoCount} clip(s)</div>
                    <div className="text-xs text-muted-foreground mt-2">9:16 · 1080×1920 · H.264 + AAC</div>
                    <div className="text-xs text-muted-foreground mt-1">Original audio muted</div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Video className="w-4 h-4" /> Clip Sequence (least-used first)
                  </h4>
                  <div className="space-y-2">
                    {previewMutation.data.videos.map((v: any, i: number) => (
                      <div key={v.id} className="flex items-center justify-between p-2 rounded border border-border bg-card text-sm">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0 font-mono">{i + 1}</Badge>
                          <span className="truncate max-w-[220px] text-xs" title={v.filename}>{v.filename}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary" className="text-xs capitalize">{v.category}</Badge>
                          <span className="text-xs text-muted-foreground">×{v.usedCount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Settings2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Click "Preview Plan" to see the processing plan.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
