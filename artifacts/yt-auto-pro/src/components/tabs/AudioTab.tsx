import { useState, useRef, useCallback } from "react";
import {
  useListAudios,
  useDownloadAudios,
  getListAudiosQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download, Music, Loader2, ExternalLink, Upload,
  HardDriveUpload, FolderOpen, Tag, HardDrive,
  CheckCircle2, Trash2, ChevronDown, ChevronRight, Scissors,
  FilePlus2, Plus, X,
} from "lucide-react";
import { VIDEO_CATEGORIES } from "@/lib/categories";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrimState {
  start: string;
  end: string;
  saving: boolean;
}

interface AudioUploadItem {
  id: string;
  file: File;
  title: string;
  category: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AudioTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL download state
  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState("satisfying");

  // Single-item action state
  const [savingToDriveId, setSavingToDriveId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trimStates, setTrimStates] = useState<Record<string, TrimState>>({});

  // Bulk upload queue
  const [uploadQueue, setUploadQueue] = useState<AudioUploadItem[]>([]);

  // Library bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDriveIds, setBulkDriveIds] = useState<Set<string>>(new Set());

  const { data: audios, isLoading } = useListAudios();
  const downloadMutation = useDownloadAudios();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAudiosQueryKey() });

  // ── Trim expand ───────────────────────────────────────────────────────────────

  const handleExpand = (audioId: string, audio: any) => {
    const next = expandedId === audioId ? null : audioId;
    setExpandedId(next);
    if (next && !trimStates[audioId]) {
      setTrimStates((prev) => ({
        ...prev,
        [audioId]: {
          start: audio.trimStart != null ? String(audio.trimStart) : "",
          end: audio.trimEnd != null ? String(audio.trimEnd) : "",
          saving: false,
        },
      }));
    }
  };

  const handleSetTrim = async (audioId: string, duration: number) => {
    const state = trimStates[audioId];
    if (!state) return;
    const trimStart = state.start !== "" ? parseFloat(state.start) : null;
    const trimEnd = state.end !== "" ? parseFloat(state.end) : null;
    if (trimStart != null && isNaN(trimStart)) {
      toast({ title: "Invalid Start", description: "Enter a valid number.", variant: "destructive" });
      return;
    }
    if (trimEnd != null && isNaN(trimEnd)) {
      toast({ title: "Invalid End", description: "Enter a valid number.", variant: "destructive" });
      return;
    }
    setTrimStates((prev) => ({ ...prev, [audioId]: { ...prev[audioId], saving: true } }));
    try {
      const res = await fetch(`/api/audios/${audioId}/trim`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimStart, trimEnd }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to save trim");
      const effective = (trimEnd ?? duration) - (trimStart ?? 0);
      toast({ title: "Trim Saved", description: `${effective.toFixed(1)}s (${trimStart ?? 0}s → ${trimEnd ?? duration}s)` });
      invalidate();
    } catch (err: any) {
      toast({ title: "Trim Failed", description: err.message, variant: "destructive" });
    } finally {
      setTrimStates((prev) => ({ ...prev, [audioId]: { ...prev[audioId], saving: false } }));
    }
  };

  const handleClearTrim = async (audioId: string) => {
    setTrimStates((prev) => ({ ...prev, [audioId]: { start: "", end: "", saving: true } }));
    try {
      await fetch(`/api/audios/${audioId}/trim`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trimStart: null, trimEnd: null }),
      });
      toast({ title: "Trim Cleared" });
      invalidate();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setTrimStates((prev) => ({ ...prev, [audioId]: { ...prev[audioId], saving: false } }));
    }
  };

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
          toast({ title: "Download Started", description: "Title, tags, and description will be auto-extracted." });
          setUrls("");
          setTimeout(invalidate, 5000);
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  // ── Bulk file upload ──────────────────────────────────────────────────────────

  const updateQueueItem = useCallback((id: string, patch: Partial<AudioUploadItem>) => {
    setUploadQueue((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newItems: AudioUploadItem[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      title: file.name.replace(/\.[^.]+$/, ""),
      category: "satisfying",
      progress: 0,
      status: "pending",
    }));
    setUploadQueue((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadOne = useCallback(async (item: AudioUploadItem): Promise<void> => {
    updateQueueItem(item.id, { status: "uploading", progress: 0 });

    const form = new FormData();
    form.append("file", item.file);
    form.append("category", item.category);
    form.append("title", item.title.trim() || item.file.name.replace(/\.[^.]+$/, ""));

    // Get duration via browser Audio API
    try {
      const dur = await new Promise<number>((resolve) => {
        const a = document.createElement("audio");
        a.onloadedmetadata = () => resolve(a.duration || 0);
        a.onerror = () => resolve(0);
        a.src = URL.createObjectURL(item.file);
      });
      if (dur > 0) form.append("duration", String(dur));
    } catch {}

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();

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

      xhr.open("POST", "/api/upload/audio");
      xhr.send(form);
    });
  }, [updateQueueItem]);

  const handleUploadAll = async () => {
    const pending = uploadQueue.filter((x) => x.status === "pending");
    if (!pending.length) return;
    await Promise.all(pending.map((item) => uploadOne(item)));
    invalidate();
    toast({ title: "Upload Complete", description: `${pending.length} audio file(s) sent to server.` });
  };

  const removeQueueItem = (id: string) =>
    setUploadQueue((prev) => prev.filter((x) => x.id !== id));

  const clearDone = () =>
    setUploadQueue((prev) => prev.filter((x) => x.status !== "done"));

  // ── Library single actions ────────────────────────────────────────────────────

  const handleSaveToDrive = async (id: string) => {
    setSavingToDriveId(id);
    try {
      const res = await fetch(`/api/drive/save-audio/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "Save failed");
      toast({ title: "Saved to Drive", description: "Audio copied to your Google Drive folder." });
      invalidate();
    } catch (err: any) {
      toast({ title: "Drive Save Failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingToDriveId(null);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/audios/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      toast({ title: "Deleted", description: `"${title}" removed from library.` });
      invalidate();
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Library bulk operations ───────────────────────────────────────────────────

  const selectableAudios = ((audios as any[]) ?? []).filter((a) => a.localExists && !a.driveLink);

  const allSelected =
    selectableAudios.length > 0 && selectableAudios.every((a) => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableAudios.map((a) => a.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkSaveToDrive = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBulkDriveIds(new Set(ids));
    setSelectedIds(new Set());

    await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/drive/save-audio/${id}`, { method: "POST" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok && (data as any).requiresAuth) {
            toast({ title: "Google Not Connected", description: (data as any).error, variant: "destructive" });
          }
        } catch {}
      })
    );

    setBulkDriveIds(new Set());
    toast({ title: `${ids.length} Audio(s) Queued`, description: "Drive upload started for all selected tracks." });
    setTimeout(invalidate, 5000);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const fmt = (s: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}` : "—";
  const fmtSize = (bytes: number | null) => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;

  const pendingCount = uploadQueue.filter((x) => x.status === "pending").length;
  const doneCount = uploadQueue.filter((x) => x.status === "done").length;
  const isAnyUploading = uploadQueue.some((x) => x.status === "uploading");

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Audio</h2>
        <p className="text-muted-foreground">
          Download audio from any URL — title, tags, and description are auto-extracted. Set trim points per track.
        </p>
      </div>

      {/* ── Download from URL ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="w-4 h-4" /> Download from URL</CardTitle>
          <CardDescription>Any yt-dlp supported URL (YouTube, SoundCloud, etc.). Metadata extracted automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder={"https://youtu.be/dQw4w9WgXcQ\nhttps://soundcloud.com/..."}
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
          <CardDescription>Select multiple MP3/M4A/WAV/FLAC files (up to 200 MB each). Set a title and category per track before uploading.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Hidden multi-file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
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
              <p className="text-sm font-medium">Click to select audio files</p>
              <p className="text-xs text-muted-foreground">Hold Ctrl / Cmd to pick multiple files at once</p>
            </div>
          </div>

          {/* Upload queue */}
          {uploadQueue.length > 0 && (
            <div className="space-y-2">
              {uploadQueue.map((item) => (
                <div key={item.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <Music className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
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

                    {/* Remove */}
                    {item.status !== "uploading" && (
                      <button
                        onClick={() => removeQueueItem(item.id)}
                        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Title + Category — only for pending */}
                  {item.status === "pending" && (
                    <div className="pl-7 grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Title</label>
                        <Input
                          value={item.title}
                          onChange={(e) => updateQueueItem(item.id, { title: e.target.value })}
                          placeholder="Track title"
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Category</label>
                        <Select
                          value={item.category}
                          onValueChange={(val) => updateQueueItem(item.id, { category: val })}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VIDEO_CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* Progress bar */}
                  {item.status === "uploading" && (
                    <div className="pl-7">
                      <Progress value={item.progress} className="h-1.5" />
                    </div>
                  )}

                  {/* Error */}
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

      {/* ── Audio Library ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Audio Library ({(audios as any[])?.length ?? 0})</CardTitle>
              <CardDescription>Click a row to view metadata and set trim points. Trim is applied in FFmpeg during processing.</CardDescription>
            </div>
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5 border-blue-300 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                onClick={handleBulkSaveToDrive}
                disabled={bulkDriveIds.size > 0}
              >
                {bulkDriveIds.size > 0
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
                  : <><HardDriveUpload className="w-3.5 h-3.5" /> Save to Drive ({selectedIds.size})</>
                }
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : audios && (audios as any[]).length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* Select All checkbox */}
                    <TableHead className="w-10">
                      {selectableAudios.length > 0 && (
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      )}
                    </TableHead>
                    <TableHead className="w-5"></TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(audios as any[]).map((audio) => {
                    const isSelectable = audio.localExists && !audio.driveLink;
                    const isSelected = selectedIds.has(audio.id);
                    const isBulkDriving = bulkDriveIds.has(audio.id);

                    return (
                      <>
                        <TableRow
                          key={audio.id}
                          className={`cursor-pointer hover:bg-accent/30 ${isSelected ? "bg-accent/40" : ""}`}
                          onClick={() => handleExpand(audio.id, audio)}
                        >
                          {/* Row checkbox — stop propagation so row expand doesn't trigger */}
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {isSelectable && (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(audio.id)}
                                aria-label={`Select ${audio.title}`}
                              />
                            )}
                          </TableCell>

                          <TableCell className="pr-0">
                            {expandedId === audio.id
                              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Music className="w-4 h-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="truncate max-w-[180px] font-medium text-sm" title={audio.title}>{audio.title}</p>
                                {audio.fileSize && <p className="text-xs text-muted-foreground">{fmtSize(audio.fileSize)}</p>}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            {audio.category
                              ? <Badge variant="secondary" className="capitalize">{audio.category}</Badge>
                              : <span className="text-muted-foreground text-sm">—</span>}
                          </TableCell>

                          <TableCell className="text-muted-foreground tabular-nums">
                            <div>
                              {fmt(audio.duration)}
                              {(audio.trimStart != null || audio.trimEnd != null) && (
                                <div className="text-xs text-orange-500 mt-0.5 flex items-center gap-0.5">
                                  <Scissors className="w-2.5 h-2.5" />
                                  {audio.trimStart ?? 0}s→{audio.trimEnd ?? "end"}s
                                </div>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-1">
                              {audio.localExists ? (
                                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 gap-1 text-xs">
                                  <HardDrive className="w-3 h-3" /> Local
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-xs">Missing</Badge>
                              )}
                              {audio.driveLink && (
                                <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 gap-1 text-xs">
                                  <CheckCircle2 className="w-3 h-3" /> Drive
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            {audio.used
                              ? <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20">Used</Badge>
                              : <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Available</Badge>}
                          </TableCell>

                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {audio.localExists && (
                                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" asChild>
                                  <a href={`/api/audios/${audio.id}/file`} target="_blank" rel="noopener noreferrer">
                                    <Music className="w-3 h-3" /> Play
                                  </a>
                                </Button>
                              )}
                              {!audio.driveLink && audio.localExists && (
                                <Button
                                  size="sm" variant="outline" className="h-8 gap-1 text-xs"
                                  disabled={savingToDriveId === audio.id || isBulkDriving}
                                  onClick={() => handleSaveToDrive(audio.id)}
                                >
                                  {savingToDriveId === audio.id || isBulkDriving
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <HardDriveUpload className="w-3 h-3" />}
                                  Drive
                                </Button>
                              )}
                              {audio.driveLink && (
                                <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                                  <a href={audio.driveLink} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-4 h-4" />
                                  </a>
                                </Button>
                              )}
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                disabled={deletingId === audio.id}
                                onClick={() => handleDelete(audio.id, audio.title)}
                              >
                                {deletingId === audio.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded trim + metadata row */}
                        {expandedId === audio.id && (
                          <TableRow key={`${audio.id}-exp`} className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={8} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">

                                {/* Description */}
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">YouTube Description</p>
                                  {audio.description ? (
                                    <p className="text-foreground/80 whitespace-pre-wrap line-clamp-5 text-xs leading-relaxed">{audio.description}</p>
                                  ) : (
                                    <p className="text-xs text-muted-foreground italic">No description extracted</p>
                                  )}
                                </div>

                                {/* Tags */}
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                    <Tag className="w-3 h-3" /> Tags ({audio.tags?.length ?? 0})
                                  </p>
                                  {audio.tags?.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {audio.tags.map((tag: string, i: number) => (
                                        <Badge key={i} variant="secondary" className="text-xs">#{tag}</Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground italic">No tags extracted</p>
                                  )}
                                  {audio.uploader && (
                                    <p className="text-xs text-muted-foreground mt-2">Uploader: {audio.uploader}</p>
                                  )}
                                </div>

                                {/* Trim Controls */}
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <Scissors className="w-3 h-3" /> Audio Trim (seconds)
                                  </p>
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <Label className="text-xs">Start (s)</Label>
                                        <Input
                                          type="number" min={0} step={0.1} placeholder="0"
                                          className="h-8 text-sm"
                                          value={trimStates[audio.id]?.start ?? ""}
                                          onChange={(e) =>
                                            setTrimStates((prev) => ({ ...prev, [audio.id]: { ...prev[audio.id], start: e.target.value } }))
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">End (s) — blank = full</Label>
                                        <Input
                                          type="number" min={0} step={0.1}
                                          placeholder={audio.duration > 0 ? String(Math.floor(audio.duration)) : "end"}
                                          className="h-8 text-sm"
                                          value={trimStates[audio.id]?.end ?? ""}
                                          onChange={(e) =>
                                            setTrimStates((prev) => ({ ...prev, [audio.id]: { ...prev[audio.id], end: e.target.value } }))
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                      </div>
                                    </div>
                                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                      <Button
                                        size="sm" className="h-7 text-xs flex-1"
                                        disabled={trimStates[audio.id]?.saving}
                                        onClick={() => handleSetTrim(audio.id, audio.duration)}
                                      >
                                        {trimStates[audio.id]?.saving
                                          ? <Loader2 className="w-3 h-3 animate-spin" />
                                          : <><Scissors className="w-3 h-3 mr-1" /> Save Trim</>
                                        }
                                      </Button>
                                      {(audio.trimStart != null || audio.trimEnd != null) && (
                                        <Button
                                          size="sm" variant="ghost" className="h-7 text-xs"
                                          disabled={trimStates[audio.id]?.saving}
                                          onClick={() => handleClearTrim(audio.id)}
                                        >
                                          Clear
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>

                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Music className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No audio yet</p>
              <p className="text-sm mt-1">Paste YouTube or SoundCloud URLs above, or upload audio files from your device.</p>
            </div>
          )}

          {/* Bulk selection hint */}
          {selectableAudios.length > 0 && selectedIds.size === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-3">
              Check rows to bulk-select tracks for Drive upload
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
