import { useEffect, useRef, useState } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Info, Sun, Sunset, Moon, Clock, CheckCircle2, Bell, RefreshCw } from "lucide-react";

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

interface UploadSlot {
  id: string;
  label: string;
  labelBn: string;
  time: string;
  enabled: boolean;
}

const DEFAULT_SLOTS: UploadSlot[] = [
  { id: "morning",   label: "Morning",   labelBn: "সকাল", time: "09:00", enabled: true  },
  { id: "afternoon", label: "Afternoon", labelBn: "দুপুর", time: "14:00", enabled: false },
  { id: "night",     label: "Night",     labelBn: "রাত",   time: "19:00", enabled: false },
];

const SLOT_ICONS = { morning: Sun, afternoon: Sunset, night: Moon };
const SLOT_COLORS = {
  morning:   "from-amber-50 to-orange-50 border-amber-200 dark:from-amber-950/20 dark:to-orange-950/20 dark:border-amber-800/40",
  afternoon: "from-sky-50 to-blue-50 border-sky-200 dark:from-sky-950/20 dark:to-blue-950/20 dark:border-sky-800/40",
  night:     "from-indigo-50 to-purple-50 border-indigo-200 dark:from-indigo-950/20 dark:to-purple-950/20 dark:border-indigo-800/40",
};
const SLOT_ICON_COLORS = { morning: "text-amber-500", afternoon: "text-sky-500", night: "text-indigo-500" };

export function ScheduleTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings();
  const updateMutation = useUpdateSettings();

  const [slots, setSlots] = useState<UploadSlot[]>(DEFAULT_SLOTS);
  const [autoCycleEnabled, setAutoCycleEnabled] = useState(false);
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(false);
  const [maxRetries, setMaxRetries] = useState(3);
  const [youtubeCategoryId, setYoutubeCategoryId] = useState("22");
  const [thumbnailEnabled, setThumbnailEnabled] = useState(false);
  const [thumbnailBgColor, setThumbnailBgColor] = useState("yellow");
  const [driveVideoFolderId, setDriveVideoFolderId] = useState("");
  const [driveAudioFolderId, setDriveAudioFolderId] = useState("");
  const [driveOutputFolderId, setDriveOutputFolderId] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [testingTelegram, setTestingTelegram] = useState(false);

  const initRef = useRef(false);

  useEffect(() => {
    if (settings && !initRef.current) {
      initRef.current = true;
      const s = settings as any;

      const rawSlots = s.uploadSlots as UploadSlot[] | undefined;
      if (rawSlots && rawSlots.length > 0) {
        const merged = DEFAULT_SLOTS.map((def) => {
          const saved = rawSlots.find((sl) => sl.id === def.id);
          return saved ? { ...def, ...saved } : def;
        });
        setSlots(merged);
      }

      setAutoCycleEnabled(s.autoCycleEnabled ?? false);
      setAutoRetryEnabled(s.autoRetryEnabled ?? false);
      setMaxRetries(s.maxRetries ?? 3);
      setYoutubeCategoryId(s.youtubeCategoryId ?? "22");
      setThumbnailEnabled(s.thumbnailEnabled ?? false);
      setThumbnailBgColor(s.thumbnailBgColor ?? "yellow");
      setDriveVideoFolderId(s.driveVideoFolderId ?? "");
      setDriveAudioFolderId(s.driveAudioFolderId ?? "");
      setDriveOutputFolderId(s.driveOutputFolderId ?? "");
      setTelegramEnabled(s.telegramEnabled ?? false);
      setTelegramBotToken(s.telegramBotToken ?? "");
      setTelegramChatId(s.telegramChatId ?? "");
    }
  }, [settings]);

  const updateSlot = (id: string, patch: Partial<UploadSlot>) =>
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const enabledCount = slots.filter((s) => s.enabled).length;

  const handleTestTelegram = async () => {
    if (!telegramBotToken || !telegramChatId) {
      toast({ title: "Missing Fields", description: "Enter bot token and chat ID first.", variant: "destructive" });
      return;
    }
    setTestingTelegram(true);
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChatId, text: "✅ YT Auto Pro — Telegram test message. Notifications are working!" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.description || "Telegram API error");
      toast({ title: "Test Sent!", description: "Check your Telegram for the test message." });
    } catch (err: any) {
      toast({ title: "Test Failed", description: err.message, variant: "destructive" });
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleSave = () => {
    updateMutation.mutate(
      {
        data: {
          uploadSlots: slots,
          autoCycleEnabled,
          autoRetryEnabled,
          maxRetries,
          youtubeCategoryId,
          thumbnailEnabled,
          thumbnailBgColor,
          driveVideoFolderId: driveVideoFolderId || null,
          driveAudioFolderId: driveAudioFolderId || null,
          driveOutputFolderId: driveOutputFolderId || null,
          telegramEnabled,
          telegramBotToken: telegramBotToken || null,
          telegramChatId: telegramChatId || null,
        } as any,
      },
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
        <p className="text-muted-foreground">Configure daily upload slots, auto-cycle, Telegram notifications, and Drive folder mappings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Daily Upload Slots */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Daily Upload Slots
                </CardTitle>
                <CardDescription className="mt-1">
                  Enable one or more slots. Each enabled slot uploads <strong>one video per day</strong> automatically via Auto-Cycle.
                  {enabledCount > 0 && (
                    <span className="ml-1 text-green-600 font-medium">
                      {enabledCount} slot{enabledCount > 1 ? "s" : ""} active → {enabledCount} video{enabledCount > 1 ? "s" : ""}/day
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="auto-cycle" className="text-sm font-medium whitespace-nowrap">Auto-Cycle</Label>
                <Switch id="auto-cycle" checked={autoCycleEnabled} onCheckedChange={setAutoCycleEnabled} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {slots.map((slot) => {
                const Icon = SLOT_ICONS[slot.id as keyof typeof SLOT_ICONS] ?? Clock;
                const colorClass = SLOT_COLORS[slot.id as keyof typeof SLOT_COLORS] ?? "";
                const iconColor = SLOT_ICON_COLORS[slot.id as keyof typeof SLOT_ICON_COLORS] ?? "text-muted-foreground";

                return (
                  <div
                    key={slot.id}
                    className={`relative rounded-xl border bg-gradient-to-br p-5 transition-all duration-200 ${colorClass} ${slot.enabled ? "shadow-sm" : "opacity-60"}`}
                  >
                    {slot.enabled && <CheckCircle2 className="absolute top-3 right-3 w-4 h-4 text-green-500" />}
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`p-2 rounded-lg bg-white/60 dark:bg-black/20 ${iconColor}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm leading-tight">{slot.label}</p>
                        <p className="text-base font-bold leading-tight" style={{ fontFamily: "serif" }}>{slot.labelBn}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Upload Time</Label>
                        <Input
                          type="time"
                          value={slot.time}
                          onChange={(e) => updateSlot(slot.id, { time: e.target.value })}
                          className="h-9 bg-white/70 dark:bg-black/30 font-mono"
                        />
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <Label htmlFor={`slot-${slot.id}`} className="text-sm font-medium cursor-pointer select-none">
                          {slot.enabled
                            ? <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/20">Enabled</Badge>
                            : <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>}
                        </Label>
                        <Switch
                          id={`slot-${slot.id}`}
                          checked={slot.enabled}
                          onCheckedChange={(v) => updateSlot(slot.id, { enabled: v })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {enabledCount === 0 && (
              <p className="mt-4 text-sm text-muted-foreground flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-lg px-4 py-3">
                <Info className="w-4 h-4 text-amber-500 shrink-0" />
                No slots enabled. Enable at least one slot and turn on Auto-Cycle to start automatic uploads.
              </p>
            )}

            {autoCycleEnabled && enabledCount > 0 && (
              <p className="mt-4 text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 rounded-lg px-4 py-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Auto-Cycle is active. {enabledCount} video{enabledCount > 1 ? "s" : ""} will upload automatically per day.
              </p>
            )}

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="space-y-1">
                <Label>Max Retries on Failure</Label>
                <Input
                  type="number" min={0} max={10}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
                  className="max-w-[120px]"
                />
              </div>
              <div className="flex items-center gap-3 pt-5">
                <Switch id="auto-retry" checked={autoRetryEnabled} onCheckedChange={setAutoRetryEnabled} />
                <Label htmlFor="auto-retry" className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" /> Auto-Retry Failed Uploads
                  </span>
                  <span className="font-normal text-xs text-muted-foreground">Retry automatically after 30 min</span>
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* YouTube Defaults */}
        <Card>
          <CardHeader>
            <CardTitle>YouTube Upload Defaults</CardTitle>
            <CardDescription>Title, description, and hashtags come from the audio track's extracted metadata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>YouTube Category</Label>
              <Select value={youtubeCategoryId} onValueChange={setYoutubeCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YOUTUBE_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-t border-border pt-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Auto-Generate Thumbnail</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Extract frame at 30% and overlay Bengali title text</p>
                </div>
                <Switch checked={thumbnailEnabled} onCheckedChange={setThumbnailEnabled} />
              </div>

              {thumbnailEnabled && (
                <div className="space-y-2">
                  <Label className="text-sm">Text Background Color</Label>
                  <div className="flex gap-2">
                    {(["yellow", "green", "red"] as const).map((color) => {
                      const hex = { yellow: "#FACC15", green: "#22C55E", red: "#EF4444" }[color];
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setThumbnailBgColor(color)}
                          className={`w-9 h-9 rounded-full border-4 transition-all ${
                            thumbnailBgColor === color
                              ? "border-foreground scale-110 shadow-md"
                              : "border-transparent opacity-70 hover:opacity-100"
                          }`}
                          style={{ backgroundColor: hex }}
                          title={color.charAt(0).toUpperCase() + color.slice(1)}
                        />
                      );
                    })}
                    <span className="self-center text-sm text-muted-foreground capitalize ml-1">{thumbnailBgColor}</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Telegram Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4" /> Telegram Notifications
            </CardTitle>
            <CardDescription>
              Get a message in Telegram after each successful YouTube upload.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Enable Notifications</Label>
              <Switch checked={telegramEnabled} onCheckedChange={setTelegramEnabled} />
            </div>

            <div className="space-y-1.5">
              <Label>Bot Token</Label>
              <Input
                type="password"
                placeholder="123456789:ABCdef…"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline">@BotFather</a>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Chat ID</Label>
              <Input
                placeholder="-100123456789"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your personal chat ID or a group/channel ID
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleTestTelegram}
              disabled={testingTelegram || !telegramBotToken || !telegramChatId}
            >
              {testingTelegram
                ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                : <Bell className="w-3.5 h-3.5 mr-2" />}
              Send Test Message
            </Button>
          </CardContent>
        </Card>

        {/* Google Drive Folders */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Google Drive Folder Mapping</CardTitle>
            <CardDescription>
              Find the folder ID in the Drive URL: drive.google.com/drive/folders/<strong>FOLDER_ID</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Video Input Folder ID</Label>
              <Input placeholder="1A2B3C4D…" value={driveVideoFolderId} onChange={(e) => setDriveVideoFolderId(e.target.value)} />
              <p className="text-xs text-muted-foreground">Destination for "Mute &amp; Drive" uploads</p>
            </div>
            <div className="space-y-2">
              <Label>Audio Input Folder ID</Label>
              <Input placeholder="1A2B3C4D…" value={driveAudioFolderId} onChange={(e) => setDriveAudioFolderId(e.target.value)} />
              <p className="text-xs text-muted-foreground">Destination for audio Drive backups</p>
            </div>
            <div className="space-y-2">
              <Label>Output Folder ID</Label>
              <Input placeholder="1A2B3C4D…" value={driveOutputFolderId} onChange={(e) => setDriveOutputFolderId(e.target.value)} />
              <p className="text-xs text-muted-foreground">Where auto-cycle merged output videos go</p>
            </div>
          </CardContent>
        </Card>

        {/* Save */}
        <Card className="md:col-span-2">
          <CardFooter className="flex justify-end py-4">
            <Button onClick={handleSave} disabled={updateMutation.isPending} size="lg">
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
