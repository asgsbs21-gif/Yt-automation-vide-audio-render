import { useState, useCallback, useEffect } from "react";
import {
  useListQueue,
  useScheduleUpload,
  useUploadNow,
  getListQueueQueryKey,
  getGetStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "@/hooks/useSocket";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Upload, Calendar, ExternalLink,
  Youtube, AlertCircle, PlayCircle, X,
  HardDrive, FileVideo, Image, Save,
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ThumbnailCanvas, type ThumbBgColor } from "@/components/ThumbnailCanvas";

export function QueueTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: queue, isLoading } = useListQueue();
  const scheduleMutation = useScheduleUpload();
  const uploadNowMutation = useUploadNow();
  const { jobs } = useSocket();

  // Invalidate queue whenever any process/upload job completes via socket
  useEffect(() => {
    const done = jobs.filter((j) => j.status === "done" || j.status === "error");
    if (done.length > 0) {
      queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStatusQueryKey() });
    }
  }, [jobs, queryClient]);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<{ jobId: string; title: string } | null>(null);

  const [thumbOpen, setThumbOpen] = useState(false);
  const [thumbItem, setThumbItem] = useState<{ id: string; title: string } | null>(null);
  const [thumbBgColor, setThumbBgColor] = useState<ThumbBgColor>("yellow");
  const [thumbTitle, setThumbTitle] = useState("");
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);
  const [thumbSaving, setThumbSaving] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatusQueryKey() });
  };

  const handleUploadNow = (id: string) => {
    uploadNowMutation.mutate(
      { data: { queueItemId: id } },
      {
        onSuccess: () => {
          toast({ title: "Upload Started", description: "Video is uploading to YouTube." });
          invalidate();
        },
        onError: (err: any) => {
          toast({ title: "Upload Failed", description: err.message || "Failed to start upload", variant: "destructive" });
        },
      }
    );
  };

  const handleScheduleSubmit = () => {
    if (!selectedItemId || !scheduleDate) return;
    const isoDate = new Date(scheduleDate).toISOString();
    scheduleMutation.mutate(
      { data: { queueItemId: selectedItemId, scheduledAt: isoDate } },
      {
        onSuccess: () => {
          toast({ title: "Scheduled", description: `Scheduled for ${format(new Date(isoDate), "PPpp")}` });
          setScheduleOpen(false);
          invalidate();
        },
        onError: (err: any) => {
          toast({ title: "Schedule Failed", description: err.message || "Failed to schedule", variant: "destructive" });
        },
      }
    );
  };

  const openPreview = (jobId: string, title: string) => {
    setPreviewItem({ jobId, title });
    setPreviewOpen(true);
  };

  const openThumbnail = (id: string, title: string) => {
    setThumbItem({ id, title });
    setThumbTitle(title);
    setThumbBgColor("yellow");
    setThumbDataUrl(null);
    setThumbOpen(true);
  };

  const handleThumbDataUrl = useCallback((dataUrl: string) => {
    setThumbDataUrl(dataUrl);
  }, []);

  const handleSaveThumbnail = async () => {
    if (!thumbItem || !thumbDataUrl) return;
    setThumbSaving(true);
    try {
      const res = await fetch(`/api/queue/${thumbItem.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: thumbDataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to save thumbnail");
      }
      toast({ title: "Thumbnail Saved", description: "Will be uploaded to YouTube with the video." });
      setThumbOpen(false);
      invalidate();
    } catch (err: any) {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    } finally {
      setThumbSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":   return <Badge variant="secondary" className="bg-gray-500/10 text-gray-500">Pending</Badge>;
      case "scheduled": return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">Scheduled</Badge>;
      case "uploading": return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 animate-pulse">Uploading…</Badge>;
      case "uploaded":  return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Uploaded</Badge>;
      case "failed":    return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">Failed</Badge>;
      default:          return <Badge>{status}</Badge>;
    }
  };

  const fmtSize = (bytes: number | null) =>
    bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Upload Queue</h2>
        <p className="text-muted-foreground">
          Processed videos waiting to go to YouTube. Preview each video or edit its thumbnail before uploading.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue Items ({queue?.length ?? 0})</CardTitle>
          <CardDescription>Use the play button to preview, or the image button to edit the thumbnail.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : queue && queue.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20"></TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(queue as any[]).map((item) => {
                    const hasPreview = !!item.jobId;
                    const hasThumbnail = !!item.thumbnailPath;

                    return (
                      <TableRow key={item.id}>

                        {/* Preview + thumbnail buttons */}
                        <TableCell className="pr-0">
                          <div className="flex items-center gap-0.5">
                            {hasPreview ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-primary hover:bg-primary/10"
                                title="Preview video"
                                onClick={() => openPreview(item.jobId, item.title)}
                              >
                                <PlayCircle className="w-5 h-5" />
                              </Button>
                            ) : (
                              <span
                                className="flex items-center justify-center h-8 w-8 text-muted-foreground/30"
                                title="No preview — file was processed before preview support was added"
                              >
                                <FileVideo className="w-4 h-4" />
                              </span>
                            )}

                            {hasThumbnail ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-orange-500 hover:bg-orange-500/10"
                                title="Edit thumbnail"
                                onClick={() => openThumbnail(item.id, item.title)}
                              >
                                <Image className="w-4 h-4" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>

                        {/* Title + tags */}
                        <TableCell className="font-medium max-w-[220px]">
                          <div className="truncate" title={item.title}>{item.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {(item.tags as string[]).slice(0, 3).map((t) => `#${t}`).join(" ")}
                          </div>
                        </TableCell>

                        <TableCell>{getStatusBadge(item.status)}</TableCell>

                        {/* Storage indicator */}
                        <TableCell>
                          {item.localExists ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 gap-1 text-xs">
                              <HardDrive className="w-3 h-3" />
                              {fmtSize(item.fileSize) ?? "Local"}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-xs">
                              Drive only
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {item.scheduledAt ? format(new Date(item.scheduledAt), "PPp") : "—"}
                        </TableCell>

                        <TableCell>
                          {item.error && (
                            <div className="flex items-center text-xs text-destructive max-w-[140px]" title={item.error}>
                              <AlertCircle className="w-3 h-3 mr-1 shrink-0" />
                              <span className="truncate">{item.error}</span>
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {item.status === "uploaded" && item.youtubeUrl ? (
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" asChild>
                                <a href={item.youtubeUrl} target="_blank" rel="noopener noreferrer">
                                  <Youtube className="w-3.5 h-3.5 text-red-500" /> View
                                </a>
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1 text-xs"
                                  disabled={item.status === "uploading" || item.status === "uploaded"}
                                  onClick={() => { setSelectedItemId(item.id); setScheduleDate(""); setScheduleOpen(true); }}
                                >
                                  <Calendar className="w-3.5 h-3.5" /> Schedule
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-8 gap-1 text-xs"
                                  disabled={item.status === "uploading" || item.status === "uploaded" || uploadNowMutation.isPending}
                                  onClick={() => handleUploadNow(item.id)}
                                >
                                  {uploadNowMutation.isPending && uploadNowMutation.variables?.data.queueItemId === item.id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <Upload className="w-3.5 h-3.5" />}
                                  Upload Now
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-14 text-muted-foreground">
              <Upload className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">No items in the queue</p>
              <p className="text-sm mt-1">Go to the Process tab to merge videos.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Schedule modal ──────────────────────────────────────────────────── */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Upload</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Date &amp; Time</label>
              <Input
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button onClick={handleScheduleSubmit} disabled={!scheduleDate || scheduleMutation.isPending}>
              {scheduleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Video preview modal ─────────────────────────────────────────────── */}
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null);
          setPreviewOpen(open);
        }}
      >
        <DialogContent className="max-w-3xl p-0 overflow-hidden rounded-xl">
          <DialogHeader className="px-5 pt-4 pb-2 flex flex-row items-center justify-between">
            <DialogTitle className="truncate pr-8 text-base">
              {previewItem?.title ?? "Preview"}
            </DialogTitle>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 absolute right-4 top-4 rounded-full"
              onClick={() => { setPreviewOpen(false); setPreviewItem(null); }}
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogHeader>

          <div className="bg-black flex items-center justify-center" style={{ minHeight: "420px" }}>
            {previewItem && (
              <video
                key={previewItem.jobId}
                controls
                autoPlay
                playsInline
                className="max-h-[520px] max-w-full w-full"
                style={{ aspectRatio: "9/16", maxWidth: "300px", margin: "0 auto", display: "block" }}
                src={`/api/preview/${previewItem.jobId}`}
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.display = "none";
                  const parent = el.parentElement;
                  if (parent && !parent.querySelector(".preview-error")) {
                    const msg = document.createElement("p");
                    msg.className = "preview-error text-white/60 text-sm text-center px-6 py-10";
                    msg.textContent = "Could not load video. The output file may have been deleted from /data/output/.";
                    parent.appendChild(msg);
                  }
                }}
              />
            )}
          </div>

          <div className="px-5 py-3 flex items-center justify-between border-t text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              Streaming from <code className="font-mono bg-muted px-1 rounded">/data/output/</code>
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
              <a
                href={previewItem ? `/api/preview/${previewItem.jobId}` : "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-3 h-3" /> Open in new tab
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Thumbnail editor modal ──────────────────────────────────────────── */}
      <Dialog open={thumbOpen} onOpenChange={(open) => { if (!open) setThumbItem(null); setThumbOpen(open); }}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden rounded-xl">
          <DialogHeader className="px-5 pt-4 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Image className="w-4 h-4 text-orange-500" />
              Thumbnail Editor
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col md:flex-row gap-0">
            {/* Canvas preview */}
            <div className="bg-muted/40 flex items-center justify-center p-4 md:w-64 shrink-0">
              {thumbItem && (
                <div className="w-full max-w-[200px]">
                  <ThumbnailCanvas
                    thumbnailUrl={`/api/queue/${thumbItem.id}/thumbnail?t=${Date.now()}`}
                    title={thumbTitle}
                    bgColor={thumbBgColor}
                    onDataUrl={handleThumbDataUrl}
                    className="rounded-lg shadow-lg"
                  />
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex-1 p-5 space-y-5">
              <div className="space-y-2">
                <Label>Title Text (Bengali)</Label>
                <Textarea
                  value={thumbTitle}
                  onChange={(e) => setThumbTitle(e.target.value)}
                  rows={3}
                  placeholder="বাংলা শিরোনাম লিখুন…"
                  className="resize-none font-sans"
                  style={{ fontFamily: '"Hind Siliguri", "Noto Sans Bengali", sans-serif' }}
                />
                <p className="text-xs text-muted-foreground">
                  Words are never split mid-word. Long titles wrap automatically.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Background Color</Label>
                <div className="flex gap-3">
                  {(["yellow", "green", "red"] as ThumbBgColor[]).map((color) => {
                    const hex = { yellow: "#FACC15", green: "#22C55E", red: "#EF4444" }[color];
                    const label = color.charAt(0).toUpperCase() + color.slice(1);
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setThumbBgColor(color)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                          thumbBgColor === color
                            ? "border-foreground bg-foreground/5"
                            : "border-border hover:border-foreground/40"
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: hex }}
                        />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-4 py-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-medium">What happens when you save:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>The composed thumbnail replaces the raw frame on the server</li>
                  <li>When uploaded to YouTube, it will be set as the video thumbnail</li>
                  <li>YouTube requires a verified channel to set custom thumbnails</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="px-5 py-3 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setThumbOpen(false); setThumbItem(null); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveThumbnail}
              disabled={thumbSaving || !thumbDataUrl}
              className="gap-1.5"
            >
              {thumbSaving
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Save className="w-4 h-4" />}
              Save Thumbnail
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
