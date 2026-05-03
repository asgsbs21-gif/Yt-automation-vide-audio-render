import { useState, useRef, useCallback } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download, Edit2, Check, X, Loader2, PlayCircle,
  ExternalLink, Upload, FolderOpen, Trash2,
  HardDrive, CheckCircle2, VolumeX, Plus, FilePlus2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VIDEO_CATEGORIES } from "@/lib/categories";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoUploadItem {
  id: string;
  file: File;
  category: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VideosTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL download state
  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState("fish cutting");

  // Category editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");

  // Single-item action state
  const [mutingId, setMutingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk upload queue
  const [uploadQueue, setUploadQueue] = useState<VideoUploadItem[]>([]);

  // Library bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMutingIds, setBulkMutingIds] = useState<Set<string>>(new Set());

  const { data: videos, isLoading } = useListVideos();
  const downloadMutation = useDownloadVideos();
  const updateCategoryMutation = useUpdateVideoCategory();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });

  // ── URL download ─────────────────────────────────────────────────────────────

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

  // ── Bulk file upload ──────────────────────────────────────────────────────────

  const updateQueueItem = useCallback((id: string, patch: Partial<VideoUploadItem>) => {
    setUploadQueue((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newItems: VideoUploadItem[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      category: "fish cutting",
      progress: 0,
      status: "pending",
    }));
    setUploadQueue((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadOne = useCallback((item: VideoUploadItem): Promise<void> =>
    new Promise((resolve) => {
      updateQueueItem(item.id, { status: "uploading", progress: 0 });

      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append("file", item.file);
      form.append("category", item.category);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          updateQueueItem(item.id, { progress: Math.round((e.loaded / e.total) * 100) });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateQueueItem(item.id, { status: "done", progress: 100 });
        } else {
          let err = "Upload failed";
          try { err = JSON.parse(xhr.responseText).error || err; } catch {}
          updateQueueItem(item.id, { status: "error", error: err });
        }
        resolve();
      };

      xhr.onerror = () => {
        updateQueueItem(item.id, { status: "error", error: "Network error" });
        resolve();
      };

      xhr.open("POST", "/api/upload/video");
      xhr.send(form);
    }),
  [updateQueueItem]);

  const handleUploadAll = async () => {
    const pending = uploadQueue.filter((x) => x.status === "pending");
    if (!pending.length) return;
    await Promise.all(pending.map((item) => uploadOne(item)));
    invalidate();
    const done = uploadQueue.filter((x) => x.status === "done").length + pending.length;
    toast({ title: "Upload Complete", description: `${pending.length} file(s) sent to server.` });
  };

  const removeQueueItem = (id: string) =>
    setUploadQueue((prev) => prev.filter((x) => x.id !== id));

  const clearDone = () =>
    setUploadQueue((prev) => prev.filter((x) => x.status !== "done"));

  // ── Library single actions ────────────────────────────────────────────────────

  const handleMuteAndDrive = async (id: string, filename: string) => {
    setMutingId(id);
    try {
      const res = await fetch(`/api/videos/${id}/mute-and-drive`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as any).error || "Failed";
        if ((data as any).requiresAuth) {
          toast({ title: "Google Not Connected", description: msg, variant: "destructive" });
        } else {
          throw new Error(msg);
        }
        return;
      }
      toast({ title: "Mute & Drive Started", description: `"${filename}" — watch the progress panel.` });
      setTimeout(invalidate, 8000);
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setMutingId(null);
    }
  };

  const handleDelete = async (id: string, filename: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      toast({ title: "Deleted", description: `${filename} removed.` });
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

  // ── Library bulk operations ───────────────────────────────────────────────────

  const selectableVideos = ((videos as any[]) ?? []).filter((v) => v.localExists && !v.driveLink);

  const allSelected =
    selectableVideos.length > 0 && selectableVideos.every((v) => selectedIds.has(v.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableVideos.map((v) => v.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkMuteDrive = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBulkMutingIds(new Set(ids));
    setSelectedIds(new Set());

    await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/videos/${id}/mute-and-drive`, { method: "POST" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok && (data as any).requiresAuth) {
            toast({ title: "Google Not Connected", description: (data as any).error, variant: "destructive" });
          }
        } catch {}
      })
    );

    setBulkMutingIds(new Set());
    toast({ title: `${ids.length} Video(s) Queued`, description: "Mute & Drive jobs started — watch the progress panel." });
    setTimeout(invalidate, 10000);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const fmtSize = (bytes: number | null) =>
    bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;

  const pendingCount = uploadQueue.filter((x) => x.status === "pending").length;
  const doneCount = uploadQueue.filter((x) => x.status === "done").length;
  const isAnyUploading = uploadQueue.some((x) => x.status === "uploading");

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Videos</h2>
        <p className="text-muted-foreground">
          All videos are stored locally on the server. "Mute &amp; Send to Drive" strips audio and uploads to Google Drive.
        </p>
      </div>

      {/* ── Download from URL ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="w-4 h-4" /> Download from URL</CardTitle>
          <CardDescription>
            Kuaishou / Kwai → Puppeteer. YouTube, TikTok, all others → yt-dlp. Saved locally immediately.
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

      {/* ── Bulk Upload from Device ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload from Device</CardTitle>
          <CardDescription>Select multiple MP4/MOV/AVI/WEBM files (up to 500 MB each). Each file gets its own category and upload progress bar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Hidden multi-file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            <div className="space-y-1">
              <FilePlus2 className="w-7 h-7 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium">Click to select video files</p>
              <p className="text-xs text-muted-foreground">Hold Ctrl / Cmd to pick multiple files at once</p>
            </div>
          </div>

          {/* Upload queue */}
          {uploadQueue.length > 0 && (
            <div className="space-y-2">
              {uploadQueue.map((item) => (
                <div key={item.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    {/* File info */}
                    <PlayCircle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={item.file.name}>{item.file.name}</p>
                      <p className="text-xs text-muted-foreground">{(item.file.size / 1024 / 1024).toFixed(1)} MB</p>
                    </div>

                    {/* Status badge */}
                    <div className="shrink-0">
                      {item.status === "pending" && <Badge variant="outline" className="text-xs">Pending</Badge>}
                      {item.status === "uploading" && <Badge variant="outline" className="text-xs text-blue-500 border-blue-300">{item.progress}%</Badge>}
                      {item.status === "done" && <Badge variant="outline" className="text-xs text-green-600 border-green-300 bg-green-50 dark:bg-green-950/20">Done</Badge>}
                      {item.status === "error" && <Badge variant="destructive" className="text-xs">Error</Badge>}
                    </div>

                    {/* Remove button */}
                    {item.status !== "uploading" && (
                      <button
                        onClick={() => removeQueueItem(item.id)}
                        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Category selector — only for pending */}
                  {item.status === "pending" && (
                    <div className="flex items-center gap-2 pl-7">
                      <label className="text-xs text-muted-foreground shrink-0">Category:</label>
                      <Select
                        value={item.category}
                        onValueChange={(val) => updateQueueItem(item.id, { category: val })}
                      >
                        <SelectTrigger className="h-7 text-xs flex-1 max-w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {VIDEO_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Progress bar */}
                  {item.status === "uploading" && (
                    <div className="pl-7">
                      <Progress value={item.progress} className="h-1.5" />
                    </div>
                  )}

                  {/* Error message */}
                  {item.status === "error" && item.error && (
                    <p className="text-xs text-destructive pl-7">{item.error}</p>
                  )}
                </div>
              ))}

              {/* Queue actions */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  {doneCount > 0 && (
                    <button
                      onClick={clearDone}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      Clear {doneCount} done
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {pendingCount} pending · {uploadQueue.length} total
                  </span>
                  <Button
                    onClick={handleUploadAll}
                    disabled={pendingCount === 0 || isAnyUploading}
                    size="sm"
                    className="gap-1.5"
                  >
                    {isAnyUploading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                      : <><Upload className="w-3.5 h-3.5" /> Upload All ({pendingCount})</>
                    }
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Add more files button when queue is non-empty */}
          {uploadQueue.length > 0 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="w-3 h-3" /> Add more files
            </button>
          )}
        </CardContent>
      </Card>

      {/* ── Video Library ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Video Library ({(videos as any[])?.length ?? 0})</CardTitle>
              <CardDescription>
                Click <strong>Mute &amp; Drive</strong> to strip audio with FFmpeg and upload to Google Drive. Your local copy is never modified.
              </CardDescription>
            </div>
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                className="shrink-0 bg-blue-600 hover:bg-blue-700 gap-1.5"
                onClick={handleBulkMuteDrive}
                disabled={bulkMutingIds.size > 0}
              >
                {bulkMutingIds.size > 0
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
                  : <><VolumeX className="w-3.5 h-3.5" /> Mute &amp; Drive ({selectedIds.size})</>
                }
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : videos && (videos as any[]).length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* Select All checkbox */}
                    <TableHead className="w-10">
                      {selectableVideos.length > 0 && (
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      )}
                    </TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(videos as any[]).map((video) => {
                    const isSelectable = video.localExists && !video.driveLink;
                    const isSelected = selectedIds.has(video.id);
                    const isBulkMuting = bulkMutingIds.has(video.id);

                    return (
                      <TableRow key={video.id} className={isSelected ? "bg-accent/40" : undefined}>

                        {/* Row checkbox */}
                        <TableCell>
                          {isSelectable && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(video.id)}
                              aria-label={`Select ${video.filename}`}
                            />
                          )}
                        </TableCell>

                        {/* Filename + size */}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <PlayCircle className="w-4 h-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="truncate max-w-[200px] font-medium text-sm" title={video.filename}>{video.filename}</p>
                              {video.fileSize && <p className="text-xs text-muted-foreground">{fmtSize(video.fileSize)}</p>}
                            </div>
                          </div>
                        </TableCell>

                        {/* Category (editable) */}
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

                        {/* Storage badges */}
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
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 gap-1 text-xs">
                                <CheckCircle2 className="w-3 h-3" /> Drive
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-right text-muted-foreground tabular-nums">{video.usedCount}</TableCell>

                        <TableCell className="text-muted-foreground text-sm">
                          {video.lastUsed ? formatDistanceToNow(new Date(video.lastUsed), { addSuffix: true }) : "Never"}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">

                            {video.localExists && (
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" asChild>
                                <a href={`/api/videos/${video.id}/file`} target="_blank" rel="noopener noreferrer">
                                  <PlayCircle className="w-3 h-3" /> Preview
                                </a>
                              </Button>
                            )}

                            {video.localExists && !video.driveLink && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-8 gap-1 text-xs bg-blue-600 hover:bg-blue-700"
                                disabled={mutingId === video.id || isBulkMuting}
                                onClick={() => handleMuteAndDrive(video.id, video.filename)}
                              >
                                {mutingId === video.id || isBulkMuting
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <VolumeX className="w-3 h-3" />}
                                Mute &amp; Drive
                              </Button>
                            )}

                            {video.driveLink && (
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" asChild>
                                <a href={video.driveLink} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-3 h-3" /> Drive
                                </a>
                              </Button>
                            )}

                            <Button
                              size="icon" variant="ghost"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              disabled={deletingId === video.id}
                              onClick={() => handleDelete(video.id, video.filename)}
                            >
                              {deletingId === video.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>

                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <PlayCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No videos yet</p>
              <p className="text-sm mt-1">Paste Kuaishou or YouTube URLs above, or upload from your device.</p>
              <p className="text-sm mt-1 text-green-600 font-medium">✓ No Google connection needed to download or store videos.</p>
            </div>
          )}

          {/* Bulk selection hint */}
          {selectableVideos.length > 0 && selectedIds.size === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-3">
              Check rows to bulk-select videos for Mute &amp; Drive
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
