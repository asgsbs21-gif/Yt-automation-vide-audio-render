import { useEffect, useRef, useState } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Info } from "lucide-react";
import { VIDEO_CATEGORIES } from "@/lib/categories";

const YOUTUBE_CATEGORIES = [
  { id: "1",  name: "Film & Animation" },
  { id: "2",  name: "Autos & Vehicles" },
  { id: "10", name: "Music" },
  { id: "15", name: "Pets & Animals" },
  { id: "17", name: "Sports" },
  { id: "19", name: "Travel & Events" },
  { id: "20", name: "Gaming" },
  { id: "22", name: "People & Blogs" },
  { id: "23", name: "Comedy" },
  { id: "24", name: "Entertainment" },
  { id: "25", name: "News & Politics" },
  { id: "26", name: "Howto & Style" },
  { id: "27", name: "Education" },
  { id: "28", name: "Science & Technology" },
  { id: "29", name: "Nonprofits & Activism" },
];

export function ScheduleTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings();
  const updateMutation = useUpdateSettings();

  const [formData, setFormData] = useState({
    dailyUploadTime: "09:00",
    autoCycleEnabled: false,
    maxRetries: 3,
    defaultCategory: "satisfying",
    youtubeCategoryId: "22",
    driveVideoFolderId: "",
    driveAudioFolderId: "",
    driveOutputFolderId: "",
  });

  const initRef = useRef(false);

  useEffect(() => {
    if (settings && !initRef.current) {
      setFormData({
        dailyUploadTime: settings.dailyUploadTime || "09:00",
        autoCycleEnabled: settings.autoCycleEnabled || false,
        maxRetries: settings.maxRetries || 3,
        defaultCategory: settings.defaultCategory || "satisfying",
        youtubeCategoryId: settings.youtubeCategoryId || "22",
        driveVideoFolderId: settings.driveVideoFolderId || "",
        driveAudioFolderId: settings.driveAudioFolderId || "",
        driveOutputFolderId: settings.driveOutputFolderId || "",
      });
      initRef.current = true;
    }
  }, [settings]);

  const set = (field: string, value: any) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSave = () => {
    updateMutation.mutate(
      { data: formData },
      {
        onSuccess: () => {
          toast({ title: "Settings Saved", description: "Scheduler configuration updated." });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Save Failed", description: err.message || "Failed to save settings", variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Automation Settings</h2>
        <p className="text-muted-foreground">Configure daily auto-upload, cycling, and Google Drive folder mappings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Schedule */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Schedule</CardTitle>
            <CardDescription>
              When Auto-Cycle is enabled, the app automatically picks the least-used videos + an unused audio track, merges them with FFmpeg, and uploads to YouTube every day at the set time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="auto-cycle" className="flex flex-col space-y-1">
                <span>Enable Auto-Cycle</span>
                <span className="font-normal text-[0.8rem] text-muted-foreground">
                  Process + upload one video per day automatically
                </span>
              </Label>
              <Switch
                id="auto-cycle"
                checked={formData.autoCycleEnabled}
                onCheckedChange={(v) => set("autoCycleEnabled", v)}
              />
            </div>

            <div className="space-y-2">
              <Label>Daily Upload Time</Label>
              <Input
                type="time"
                value={formData.dailyUploadTime}
                onChange={(e) => set("dailyUploadTime", e.target.value)}
              />
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="w-3 h-3" /> Server local time. Google account must be connected for uploads to work.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Max Retries on Failure</Label>
              <Input
                type="number"
                min={0}
                max={10}
                value={formData.maxRetries}
                onChange={(e) => set("maxRetries", parseInt(e.target.value) || 0)}
              />
            </div>
          </CardContent>
        </Card>

        {/* YouTube Defaults */}
        <Card>
          <CardHeader>
            <CardTitle>YouTube Upload Defaults</CardTitle>
            <CardDescription>
              Title, description, and hashtags are taken from the audio track's extracted metadata. These settings control the YouTube category.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Default Video Category (for cycling)</Label>
              <Select value={formData.defaultCategory} onValueChange={(v) => set("defaultCategory", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>YouTube Category</Label>
              <Select value={formData.youtubeCategoryId} onValueChange={(v) => set("youtubeCategoryId", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YOUTUBE_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Google Drive Mapping */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Google Drive Folder Mapping</CardTitle>
            <CardDescription>
              Folder IDs from your Google Drive. Find the ID in the Drive URL: drive.google.com/drive/folders/<strong>FOLDER_ID</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Video Input Folder ID</Label>
              <Input
                placeholder="1A2B3C4D..."
                value={formData.driveVideoFolderId}
                onChange={(e) => set("driveVideoFolderId", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Where downloaded Kuaishou videos are stored</p>
            </div>
            <div className="space-y-2">
              <Label>Audio Input Folder ID</Label>
              <Input
                placeholder="1A2B3C4D..."
                value={formData.driveAudioFolderId}
                onChange={(e) => set("driveAudioFolderId", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Where downloaded audio tracks are stored</p>
            </div>
            <div className="space-y-2">
              <Label>Output Folder ID</Label>
              <Input
                placeholder="1A2B3C4D..."
                value={formData.driveOutputFolderId}
                onChange={(e) => set("driveOutputFolderId", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Where processed output videos are uploaded</p>
            </div>
          </CardContent>
          <CardFooter className="bg-muted/50 border-t border-border flex justify-end py-4">
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Save className="w-4 h-4 mr-2" />}
              Save Configuration
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
