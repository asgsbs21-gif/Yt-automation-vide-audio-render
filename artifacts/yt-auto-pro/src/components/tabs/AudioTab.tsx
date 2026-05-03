import { useState } from "react";
import { useListAudios, useDownloadAudios, getListAudiosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Music, Loader2, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function AudioTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState("");

  const { data: audios, isLoading } = useListAudios();
  const downloadMutation = useDownloadAudios();

  const handleDownload = () => {
    if (!urls.trim()) {
      toast({ title: "Error", description: "Please enter at least one URL", variant: "destructive" });
      return;
    }
    
    const urlList = urls.split("\n").map(u => u.trim()).filter(Boolean);
    
    downloadMutation.mutate(
      { data: { urls: urlList, category: category.trim() || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Download Started", description: `Queued ${urlList.length} audio files for download.` });
          setUrls("");
          setCategory("");
          queryClient.invalidateQueries({ queryKey: getListAudiosQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to start download", variant: "destructive" });
        }
      }
    );
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Audio</h2>
          <p className="text-muted-foreground">Manage your background music and audio tracks</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Download New Audio</CardTitle>
          <CardDescription>Enter URLs (one per line) to download audio and extract metadata.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea 
            placeholder="https://..." 
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            className="min-h-[100px] font-mono text-sm"
          />
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Category (Optional)</label>
              <Input 
                placeholder="e.g., Lofi, Phonk, Epic" 
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <Button 
              onClick={handleDownload} 
              disabled={downloadMutation.isPending || !urls.trim()}
              className="w-32"
            >
              {downloadMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Download
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audio Library</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : audios && audios.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audios.map(audio => (
                    <TableRow key={audio.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Music className="w-4 h-4 text-muted-foreground" />
                          <span className="truncate max-w-[200px]" title={audio.title}>
                            {audio.title}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {audio.category ? (
                          <Badge variant="secondary">{audio.category}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatDuration(audio.duration)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {audio.tags.slice(0, 3).map((tag, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>
                          ))}
                          {audio.tags.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">+{audio.tags.length - 3}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {audio.used ? (
                          <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20">Used</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">New</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {audio.driveLink && (
                          <Button size="icon" variant="ghost" asChild>
                            <a href={audio.driveLink} target="_blank" rel="norenoopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Music className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No audio found in your library.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
