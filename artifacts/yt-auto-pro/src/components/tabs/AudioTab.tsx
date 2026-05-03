import { useState, useRef } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download, Music, Loader2, ExternalLink, Upload,
  HardDriveUpload, FolderOpen, Tag, HardDrive,
  CheckCircle2, Trash2, ChevronDown, ChevronRight, Scissors,
} from "lucide-react";
import { VIDEO_CATEGORIES } from "@/lib/categories";

interface TrimState {
  start: string;
  end: string;
  saving: boolean;
}

export function AudioTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState("satisfying");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState("satisfying");
  const [uploadTitle, setUploadTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [savingToDriveId, setSavingToDriveId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trimStates, setTrimStates] = useState<Record<string, TrimState>>({});

  const { data: audios, isLoading } = useListAudios();
  const downloadMutation = useDownloadAudios();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAudiosQueryKey() });

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
      toast({ title: "Invalid Start", description: "Enter a valid number for trim start.", variant: "destructive" });
      return;
    }
    if (trimEnd != null && isNaN(trimEnd)) {
      toast({ title: "Invalid End", description: "Enter a valid number for trim end.", variant: "destructive" });
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
      toast({ title: "Trim Saved", description: `Audio trimmed to ${effective.toFixed(1)}s (${trimStart ?? 0}s → ${trimEnd ?? duration}s)` });
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
      toast({ title: "Trim Cleared", description: "Audio will use full duration." });
      invalidate();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setTrimStates((prev) => ({ ...prev, [audioId]: { ...prev[audioId], saving: false } }));
    }
  };

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

  const handleDeviceUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      form.append("category", uploadCategory);
      form.append("title", uploadTitle.trim() || selectedFile.name.replace(/\.[^.]+$/, ""));
      const res = await fetch("/api/upload/audio", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      toast({ title: "Uploaded", description: `${selectedFile.name} saved to library.` });
      setSelectedFile(null);
      setUploadTitle("");
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

  const fmt = (s: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}` : "—";
  const fmtSize = (bytes: number | null) => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Audio</h2>
        <p className="text-muted-foreground">
          Download audio from any URL — title, tags, and description are auto-extracted. Set trim points per track.
        </p>
      </div>

      {/* Download from URL */}
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

      {/* Upload from Device */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload from Device</CardTitle>
          <CardDescription>MP3, M4A, WAV, FLAC — up to 200 MB. Saved locally.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setSelectedFile(f);
              if (f && !uploadTitle) setUploadTitle(f.name.replace(/\.[^.]+$/, ""));
            }} />
          <div onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors">
            {selectedFile ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <Music className="w-4 h-4 text-primary" />
                <span className="font-medium truncate max-w-[260px]">{selectedFile.name}</span>
                <span className="text-muted-foreground">({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              </div>
            ) : (
              <div className="space-y-1"><FolderOpen className="w-7 h-7 mx-auto text-muted-foreground" /><p className="text-sm text-muted-foreground">Click to browse audio files</p></div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Title</label>
              <Input placeholder="Track title" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VIDEO_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
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
          <CardTitle>Audio Library ({audios?.length ?? 0})</CardTitle>
          <CardDescription>Click a row to view metadata and set trim points. Trim is applied in FFmpeg during processing.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : audios && audios.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
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
                  {(audios as any[]).map((audio) => (
                    <>
                      <TableRow key={audio.id} className="cursor-pointer hover:bg-accent/30"
                        onClick={() => handleExpand(audio.id, audio)}>
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
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs"
                                disabled={savingToDriveId === audio.id}
                                onClick={() => handleSaveToDrive(audio.id)}>
                                {savingToDriveId === audio.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDriveUpload className="w-3 h-3" />}
                                Drive
                              </Button>
                            )}
                            {audio.driveLink && (
                              <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                                <a href={audio.driveLink} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a>
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              disabled={deletingId === audio.id}
                              onClick={() => handleDelete(audio.id, audio.title)}>
                              {deletingId === audio.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {expandedId === audio.id && (
                        <TableRow key={`${audio.id}-exp`} className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={7} className="px-6 py-4">
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
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        placeholder="0"
                                        className="h-8 text-sm"
                                        value={trimStates[audio.id]?.start ?? ""}
                                        onChange={(e) =>
                                          setTrimStates((prev) => ({
                                            ...prev,
                                            [audio.id]: { ...prev[audio.id], start: e.target.value },
                                          }))
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">End (s) — blank = full</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        placeholder={audio.duration > 0 ? String(Math.floor(audio.duration)) : "end"}
                                        className="h-8 text-sm"
                                        value={trimStates[audio.id]?.end ?? ""}
                                        onChange={(e) =>
                                          setTrimStates((prev) => ({
                                            ...prev,
                                            [audio.id]: { ...prev[audio.id], end: e.target.value },
                                          }))
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  </div>
                                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      size="sm"
                                      className="flex-1 h-7 text-xs"
                                      disabled={trimStates[audio.id]?.saving}
                                      onClick={() => handleSetTrim(audio.id, audio.duration)}
                                    >
                                      {trimStates[audio.id]?.saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Scissors className="w-3 h-3 mr-1" />}
                                      Set Trim
                                    </Button>
                                    {(audio.trimStart != null || audio.trimEnd != null) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        disabled={trimStates[audio.id]?.saving}
                                        onClick={() => handleClearTrim(audio.id)}
                                      >
                                        Clear
                                      </Button>
                                    )}
                                  </div>
                                  {(audio.trimStart != null || audio.trimEnd != null) && (
                                    <p className="text-xs text-orange-500">
                                      Active: {audio.trimStart ?? 0}s → {audio.trimEnd != null ? `${audio.trimEnd}s` : "end"} ({((audio.trimEnd ?? audio.duration) - (audio.trimStart ?? 0)).toFixed(1)}s effective)
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Music className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No audio yet</p>
              <p className="text-sm mt-1">Download from a YouTube or SoundCloud URL, or upload from your device.</p>
              <p className="text-sm mt-1 text-green-600 font-medium">✓ No Google connection needed — title, tags, and description are auto-extracted.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
