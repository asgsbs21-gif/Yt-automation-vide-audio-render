import { useState } from "react";
import { useListVideos, useDownloadVideos, useUpdateVideoCategory, getListVideosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Edit2, Check, X, Loader2, PlayCircle, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function VideosTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");

  const { data: videos, isLoading } = useListVideos();
  const downloadMutation = useDownloadVideos();
  const updateCategoryMutation = useUpdateVideoCategory();

  const handleDownload = () => {
    if (!urls.trim()) {
      toast({ title: "Error", description: "Please enter at least one URL", variant: "destructive" });
      return;
    }
    
    const urlList = urls.split("\n").map(u => u.trim()).filter(Boolean);
    
    downloadMutation.mutate(
      { data: { urls: urlList, category: category.trim() || "Uncategorized" } },
      {
        onSuccess: () => {
          toast({ title: "Download Started", description: `Queued ${urlList.length} videos for download.` });
          setUrls("");
          setCategory("");
          queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to start download", variant: "destructive" });
        }
      }
    );
  };

  const saveCategory = (id: string) => {
    updateCategoryMutation.mutate(
      { id, data: { category: editCategory } },
      {
        onSuccess: () => {
          toast({ title: "Updated", description: "Category updated successfully." });
          setEditingId(null);
          queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to update category", variant: "destructive" });
        }
      }
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "processing": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "unavailable": return "bg-red-500/10 text-red-500 border-red-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Videos</h2>
          <p className="text-muted-foreground">Manage your Kuaishou video library</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Download New Videos</CardTitle>
          <CardDescription>Enter Kuaishou URLs (one per line) to download and add to your library.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea 
            placeholder="https://v.kuaishou.com/..." 
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            className="min-h-[100px] font-mono text-sm"
          />
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Category (Optional)</label>
              <Input 
                placeholder="e.g., Gaming, Funny, Motivation" 
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
          <CardTitle>Video Library</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : videos && videos.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {videos.map(video => (
                    <TableRow key={video.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <PlayCircle className="w-4 h-4 text-muted-foreground" />
                          <span className="truncate max-w-[200px]" title={video.filename}>
                            {video.filename}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editingId === video.id ? (
                          <div className="flex items-center gap-2">
                            <Input 
                              value={editCategory} 
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="h-8 w-32"
                              autoFocus
                              onKeyDown={(e) => e.key === 'Enter' && saveCategory(video.id)}
                            />
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-500" onClick={() => saveCategory(video.id)}>
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group">
                            <Badge variant="secondary">{video.category}</Badge>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => {
                                setEditingId(video.id);
                                setEditCategory(video.category);
                              }}
                            >
                              <Edit2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusColor(video.status)}>
                          {video.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {video.usedCount}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {video.lastUsed ? formatDistanceToNow(new Date(video.lastUsed), { addSuffix: true }) : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        {video.driveLink && (
                          <Button size="icon" variant="ghost" asChild>
                            <a href={video.driveLink} target="_blank" rel="norenoopener noreferrer">
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
              <Video className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No videos found in your library.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
