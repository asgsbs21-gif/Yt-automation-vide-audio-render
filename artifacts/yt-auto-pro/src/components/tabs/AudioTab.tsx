import { useState, useRef } from "react";
import { useListAudios, useDownloadAudios, useGetAuthStatus, getListAudiosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Music, Loader2, ExternalLink, Upload, HardDriveUpload, FolderOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function AudioTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [urls, setUrls] = useState("");
  const [category, setCategory] = useState("");

  // Device upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Per-row save-to-drive state
  const [savingToDriveId, setSavingToDriveId] = useState<string | null>(null);

  const { data: auth } = useGetAuthStatus();
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
          setTimeout(() => queryClient.invalidateQueries({ queryKey: getListAudiosQueryKey() }), 2000);
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to start download", variant: "destructive" });
        },
      }
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !uploadTitle) {
      // Pre-fill title from filename (strip extension)
      setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleDeviceUpload = async () => {
    if (!selectedFile) {
      toast({ title: "No file selected", description: "Please pick an audio file first.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("category", uploadCategory.trim() || "");
      formData.append("title", uploadTitle.trim() || selectedFile.name.replace(/\.[^.]+$/, ""));

      const res = await fetch("/api/upload/audio", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Upload failed");
      }
      toast({ title: "Uploaded", description: `${selectedFile.name} added to your audio library.` });
      setSelectedFile(null);
      setUploadCategory("");
      setUploadTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: getListAudiosQueryKey() });
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
      const res = await fetch(`/api/drive/save-audio/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any).error || "Save to Drive failed");
      }
      toast({ title: "Saved to Drive", description: "Audio is now in your Google Drive folder." });
      queryClient.invalidateQueries({ queryKey: getListAudiosQueryKey() });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingToDriveId(null);
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return "—";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Audio</h2>
        <p className="text-muted-foreground">Manage your background music and audio tracks</p>
      </div>

      {/* Download from URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            Download from URL
          </CardTitle>
          <CardDescription>Enter YouTube / SoundCloud / Spotify URLs (one per line) to download audio and extract metadata.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="https://youtu.be/..."
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

      {/* Upload from Device */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload from Device
          </CardTitle>
          <CardDescription>
            Pick an audio file from your gallery or storage. Saved locally{auth?.authenticated ? " and synced to Google Drive if a folder is configured." : ". Connect Google to also sync to Drive."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3 text-sm">
                <Music className="w-5 h-5 text-primary" />
                <span className="font-medium text-foreground truncate max-w-[300px]">{selectedFile.name}</span>
                <span className="text-muted-foreground">({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              </div>
            ) : (
              <div className="space-y-2">
                <FolderOpen className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to browse gallery / storage</p>
                <p className="text-xs text-muted-foreground">MP3, M4A, WAV, FLAC, OGG — up to 200 MB</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title (Optional)</label>
              <Input
                placeholder="Track title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category (Optional)</label>
              <Input
                placeholder="e.g., Lofi, Phonk"
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleDeviceUpload}
              disabled={isUploading || !selectedFile}
              className="w-32"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audio Library */}
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
            <div className="rounded-md border overflow-x-auto">
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
                          <Music className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <span className="truncate max-w-[180px]" title={audio.title}>
                            {audio.title}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {audio.category ? (
                          <Badge variant="secondary">{audio.category}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatDuration(audio.duration)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[160px]">
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
                        <div className="flex items-center justify-end gap-1">
                          {!audio.driveLink && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5 text-xs"
                              disabled={savingToDriveId === audio.id}
                              onClick={() => handleSaveToDrive(audio.id)}
                              title="Save to Google Drive"
                            >
                              {savingToDriveId === audio.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <HardDriveUpload className="w-3 h-3" />
                              )}
                              Save to Drive
                            </Button>
                          )}
                          {audio.driveLink && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" asChild title="Open in Drive">
                              <a href={audio.driveLink} target="_blank" rel="noopener noreferrer">
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
              <Music className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No audio found. Download from a URL or upload from your device.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
