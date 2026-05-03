import { useState, useRef } from "react";
import {
  useListVideos,
  useDownloadVideos,
  useUpdateVideoCategory,
  useGetAuthStatus,
  getListVideosQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download, Edit2, Check, X, Loader2, PlayCircle,
  ExternalLink, Upload, HardDriveUpload, FolderOpen,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VIDEO_CATEGORIES } from "@/lib/categories";

export function VideosTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState<string>("fish cutting");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<string>("");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>("fish cutting");
  const [isUploading, setIsUploading] = useState(false);

  const [savingToDriveId, setSavingToDriveId] = useState<string | null>(null);

  const { data: auth } = useGetAuthStatus();
  const { data: videos, isLoading } = useListVideos();
  const downloadMutation = useDownloadVideos();
  const updateCategoryMutation = useUpdateVideoCategory();

  const handleDownload = () => {
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urlList.length === 0) {
      toast({ title: "Error", description: "Please enter at least one URL", variant: "destructive" });
      return;
    }
    downloadMutation.mutate(
      { data: { urls: urlList, category } },
      {
        onSuccess: () => {
          toast({
            title: "Download Started",
            description: `${urlList.length} video(s) queued. Watch the progress panel bottom-right.`,
          });
          setUrls("");
          setTimeout(() => queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() }), 3000);
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to start download", variant: "destructive" });
        },
      }
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] ?? null);
  };

  const handleDeviceUpload = async () => {
    if (!selectedFile) {
      toast({ title: "No file selected", description: "Pick a video file first.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("category", uploadCategory);

      const res = await fetch("/api/upload/video", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Upload failed");
      }
      toast({ title: "Uploaded", description: `${selectedFile.name} added to library.` });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveToDrive = async (id: string) => {
    if (!auth?.authenticated) {
      toast({ title: "Not connected", description: "Click 'Connect Google' in the sidebar first.", variant: "destructive" });
      return;
    }
    setSavingToDriveId(id);
    try {
      const res = await fetch(`/api/drive/save-video/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "Save to Drive failed");
      toast({ title: "Saved to Drive", description: "Video is now in your Google Drive folder." });
      queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingToDriveId(null);
    }
  };

  const saveCategory = (id: string) => {
    updateCategoryMutation.mutate(
      { id, data: { category: editCategory } },
      {
        onSuccess: () => {
          toast({ title: "Updated", description: "Category updated." });
          setEditingId(null);
          queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to update", variant: "destructive" });
        },
      }
    );
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "available":   return "bg-green-500/10 text-green-500 border-green-500/20";
      case "processing":  return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "unavailable": return "bg-red-500/10 text-red-500 border-red-500/20";
      default:            return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Videos</h2>
        <p className="text-muted-foreground">Manage your Kuaishou video library</p>
      </div>

      {/* Download from Kuaishou URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-4 h-4" /> Download from Kuaishou URL
          </CardTitle>
          <CardDescription>
            Paste Kuaishou video URLs (one per line). Puppeteer will extract and download each video.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder={"https://v.kuaishou.com/abc123\nhttps://v.kuaishou.com/def456"}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            className="min-h-[100px] font-mono text-sm"
          />
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleDownload}
              disabled={downloadMutation.isPending || !urls.trim()}
              className="w-36"
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

      {/* Upload from Device */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" /> Upload from Device
          </CardTitle>
          <CardDescription>
            Pick a video from your storage (MP4, MOV, AVI, WEBM — up to 500 MB).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3 text-sm">
                <PlayCircle className="w-5 h-5 text-primary" />
                <span className="font-medium truncate max-w-[300px]">{selectedFile.name}</span>
                <span className="text-muted-foreground">({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              </div>
            ) : (
              <div className="space-y-2">
                <FolderOpen className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to browse files</p>
              </div>
            )}
          </div>
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleDeviceUpload} disabled={isUploading || !selectedFile} className="w-32">
              {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Video Library */}
      <Card>
        <CardHeader>
          <CardTitle>Video Library</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : videos && videos.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
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
                  {videos.map((video) => (
                    <TableRow key={video.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <PlayCircle className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <span className="truncate max-w-[200px]" title={video.filename}>{video.filename}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editingId === video.id ? (
                          <div className="flex items-center gap-2">
                            <Select value={editCategory} onValueChange={setEditCategory}>
                              <SelectTrigger className="h-8 w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {VIDEO_CATEGORIES.map((c) => (
                                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-500" onClick={() => saveCategory(video.id)}>
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group">
                            <Badge variant="secondary" className="capitalize">{video.category}</Badge>
                            <Button
                              size="icon" variant="ghost"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => { setEditingId(video.id); setEditCategory(video.category); }}
                            >
                              <Edit2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColor(video.status)}>{video.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{video.usedCount}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {video.lastUsed ? formatDistanceToNow(new Date(video.lastUsed), { addSuffix: true }) : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!video.driveLink && (
                            <Button
                              size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                              disabled={savingToDriveId === video.id}
                              onClick={() => handleSaveToDrive(video.id)}
                            >
                              {savingToDriveId === video.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <HardDriveUpload className="w-3 h-3" />}
                              Drive
                            </Button>
                          )}
                          {video.driveLink && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                              <a href={video.driveLink} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <PlayCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No videos yet. Download from a Kuaishou URL or upload from your device.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
