import { useState } from "react";
import { useListAudios, usePreviewProcess, useProcessVideo, getListQueueQueryKey, getGetStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Settings2, Play, AlertCircle, Clock, Video, Music } from "lucide-react";

export function ProcessTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [audioId, setAudioId] = useState<string>("random");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [addToQueue, setAddToQueue] = useState(true);

  const { data: audios, isLoading: audiosLoading } = useListAudios();
  const previewMutation = usePreviewProcess();
  const processMutation = useProcessVideo();

  const handlePreview = () => {
    previewMutation.mutate(
      { 
        data: { 
          audioId: audioId === "random" ? undefined : audioId,
          categoryFilter: categoryFilter.trim() || undefined
        } 
      },
      {
        onError: (err: any) => {
          toast({ title: "Preview Error", description: err.message || "Failed to generate preview", variant: "destructive" });
        }
      }
    );
  };

  const handleProcess = () => {
    processMutation.mutate(
      {
        data: {
          audioId: audioId === "random" ? undefined : audioId,
          categoryFilter: categoryFilter.trim() || undefined,
          addToQueue
        }
      },
      {
        onSuccess: () => {
          toast({ title: "Processing Started", description: "Video merging job has been queued." });
          queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatusQueryKey() });
          previewMutation.reset(); // Clear preview
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to start processing", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Process & Merge</h2>
          <p className="text-muted-foreground">Combine video clips with audio tracks</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Setup parameters for your next output video</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Audio Track</Label>
              <Select value={audioId} onValueChange={setAudioId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Audio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">🎲 Random Unused Audio</SelectItem>
                  {audios?.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.title} ({Math.floor(a.duration / 60)}:{Math.floor(a.duration % 60).toString().padStart(2, '0')})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Video Category Filter (Optional)</Label>
              <Input 
                placeholder="e.g., Gaming" 
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between space-x-2 pt-2 border-t border-border">
              <Label htmlFor="add-queue" className="flex flex-col space-y-1">
                <span>Add to Upload Queue</span>
                <span className="font-normal text-[0.8rem] text-muted-foreground">Automatically schedule after processing</span>
              </Label>
              <Switch 
                id="add-queue" 
                checked={addToQueue} 
                onCheckedChange={setAddToQueue}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button 
              variant="secondary" 
              className="w-full" 
              onClick={handlePreview}
              disabled={previewMutation.isPending}
            >
              {previewMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Settings2 className="w-4 h-4 mr-2" />}
              Generate Preview
            </Button>
            <Button 
              className="w-full" 
              onClick={handleProcess}
              disabled={processMutation.isPending || !previewMutation.data}
            >
              {processMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Start Processing
            </Button>
          </CardFooter>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {previewMutation.data 
                ? "Here is what will be merged based on your configuration" 
                : "Generate a preview to see selected assets"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {previewMutation.isPending ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                <p>Matching audio duration with video clips...</p>
              </div>
            ) : previewMutation.isError ? (
              <div className="flex flex-col items-center justify-center py-12 text-destructive">
                <AlertCircle className="w-8 h-8 mb-4" />
                <p>Failed to generate preview. Check if you have enough available videos.</p>
              </div>
            ) : previewMutation.data ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-secondary/50 p-4 rounded-lg border border-border">
                    <div className="text-sm text-muted-foreground mb-1 flex items-center"><Music className="w-3 h-3 mr-1"/> Selected Audio</div>
                    <div className="font-medium truncate" title={previewMutation.data.audio?.title}>
                      {previewMutation.data.audio?.title || "Unknown Audio"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      Target duration: {Math.floor(previewMutation.data.estimatedDuration / 60)}:{Math.floor(previewMutation.data.estimatedDuration % 60).toString().padStart(2, '0')}
                    </div>
                  </div>
                  <div className="bg-secondary/50 p-4 rounded-lg border border-border">
                    <div className="text-sm text-muted-foreground mb-1 flex items-center"><Video className="w-3 h-3 mr-1"/> Video Clips</div>
                    <div className="font-medium">
                      {previewMutation.data.videoCount} clips selected
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      Will be sequentially merged
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-3">Clip Sequence</h4>
                  <div className="space-y-2">
                    {previewMutation.data.videos.map((v, i) => (
                      <div key={v.id} className="flex items-center justify-between p-2 rounded border border-border bg-card text-sm">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">{i + 1}</Badge>
                          <span className="truncate max-w-[250px]" title={v.filename}>{v.filename}</span>
                        </div>
                        <Badge variant="secondary">{v.category}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Settings2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Click "Generate Preview" to see the processing plan.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
