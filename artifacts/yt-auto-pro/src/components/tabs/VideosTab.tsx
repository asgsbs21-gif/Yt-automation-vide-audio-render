import { useState, useRef } from "react";
import {
  useListVideos,
  useDownloadVideos,
  useUpdateVideoCategory,
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
  ExternalLink, Upload, HardDriveUpload, FolderOpen, Trash2,
  HardDrive, CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VIDEO_CATEGORIES } from "@/lib/categories";

export function VideosTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState("fish cutting");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [savingToDriveId, setSavingToDriveId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState("fish cutting");
  const [isUploading, setIsUploading] = useState(false);

  const { data: videos, isLoading } = useListVideos();
  const downloadMutation = useDownloadVideos();
  const updateCategoryMutation = useUpdateVideoCategory();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });

  const handleDownload = () => {
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!urlList.length) {
      toast({ title: "Error", description: "Enter at least one URL", variant: "destructive" });
      return;
    }
    downloadMutation.mutate(
      { data: { urls: urlList, category } },
      {
        onSuccess: () => {
          toast({ title: "Download Started", description: `${urlList.length} URL(s) queued — watch the progress panel.` });
          setUrls("");
          setTimeout(invalidate, 4000);
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleDeviceUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      form.append("category", uploadCategory);
      const res = await fetch("/api/upload/video", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      toast({ title: "Uploaded", description: `${selectedFile.name} saved to library.` });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      invalidate();
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveToDrive = async (id: string) => {
    setSavingToDriveId(id);
    try {
      const res = await fetch(`/api/drive/save-video/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "Save failed");
      toast({ title: "Saved to Drive", description: "Video copied to your Google Drive folder." });
      invalidate();
    } catch (err: any) {
      toast({ title: "Drive Save Failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingToDriveId(null);
    }
  };

  const handleDelete = async (id: string, filename: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      toast({ title: "Deleted", description: `${filename} removed from library.` });
      invalidate();
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveCategory = (id: string) => {
    updateCategoryMutation.mutate(
      { id, data: { category: editCategory } },
      {
        onSuccess: () => { toast({ title: "Updated" }); setEditingId(null); invalidate(); },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  const fmtSize = (bytes: number | null) =>
    bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Videos</h2>
        <p className="text-muted-foreground">
          All videos are stored locally on the server. Google Drive is an optional backup.
        </p>
      </div>

      {/* Download from URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="w-4 h-4" /> Download from URL</CardTitle>
          <CardDescription>
            Kuaishou / Kwai URLs → Puppeteer. YouTube, TikTok, and all other URLs → yt-dlp. Saved locally immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder={"https://v.kuaishou.com/abc123\nhttps://youtube.com/watch?v=..."}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            className="min-h-[90px] font-mono text-sm"
          />
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VIDEO_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleDownload} disabled={downloadMutation.isPending || !urls.trim()} className="w-32">
              {downloadMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Upload from Device */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload from Device</CardTitle>
          <CardDescription>MP4, MOV, AVI, WEBM — up to 500 MB. Saved locally.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
          <div onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors">
            {selectedFile ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <PlayCircle className="w-4 h-4 text-primary" />
                <span className="font-medium truncate max-w-[260px]">{selectedFile.name}</span>
                <span className="text-muted-foreground">({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              </div>
            ) : (
              <div className="space-y-1"><FolderOpen className="w-7 h-7 mx-auto text-muted-foreground" /><p className="text-sm text-muted-foreground">Click to browse</p></div>
            )}
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VIDEO_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleDeviceUpload} disabled={isUploading || !selectedFile} className="w-28">
              {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Library */}
      <Card>
        <CardHeader>
          <CardTitle>Video Library ({videos?.length ?? 0})</CardTitle>
          <CardDescription>All files stored locally on the server. "Save to Drive" is optional.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : videos && videos.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {videos.map((video: any) => (
                    <TableRow key={video.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PlayCircle className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate max-w-[200px] font-medium text-sm" title={video.filename}>{video.filename}</p>
                            {video.fileSize && <p className="text-xs text-muted-foreground">{fmtSize(video.fileSize)}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editingId === video.id ? (
                          <div className="flex items-center gap-1">
                            <Select value={editCategory} onValueChange={setEditCategory}>
                              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {VIDEO_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-500" onClick={() => handleSaveCategory(video.id)}><Check className="w-4 h-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <Badge variant="secondary" className="capitalize">{video.category}</Badge>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100"
                              onClick={() => { setEditingId(video.id); setEditCategory(video.category); }}>
                              <Edit2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {video.localExists ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 gap-1 text-xs">
                              <HardDrive className="w-3 h-3" /> Local
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-xs">Missing</Badge>
                          )}
                          {video.driveLink && (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 gap-1 text-xs">
                              <CheckCircle2 className="w-3 h-3" /> Drive
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">{video.usedCount}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {video.lastUsed ? formatDistanceToNow(new Date(video.lastUsed), { addSuffix: true }) : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {video.localExists && (
                            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" asChild>
                              <a href={`/api/videos/${video.id}/file`} target="_blank" rel="noopener noreferrer">
                                <PlayCircle className="w-3 h-3" /> Preview
                              </a>
                            </Button>
                          )}
                          {!video.driveLink && video.localExists && (
                            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs"
                              disabled={savingToDriveId === video.id}
                              onClick={() => handleSaveToDrive(video.id)}>
                              {savingToDriveId === video.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDriveUpload className="w-3 h-3" />}
                              Drive
                            </Button>
                          )}
                          {video.driveLink && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                              <a href={video.driveLink} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a>
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            disabled={deletingId === video.id}
                            onClick={() => handleDelete(video.id, video.filename)}>
                            {deletingId === video.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <PlayCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No videos yet</p>
              <p className="text-sm mt-1">Paste Kuaishou or YouTube URLs above, or upload a file from your device.</p>
              <p className="text-sm mt-1 text-green-600 font-medium">✓ No Google connection needed to download or store videos.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
