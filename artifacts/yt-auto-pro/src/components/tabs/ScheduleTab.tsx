import { useEffect, useRef, useState } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";

export function ScheduleTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings();
  const updateSettingsMutation = useUpdateSettings();

  const [formData, setFormData] = useState({
    dailyUploadTime: "12:00",
    autoCycleEnabled: false,
    maxRetries: 3,
    defaultCategory: "Entertainment",
    youtubeCategoryId: "20",
    driveVideoFolderId: "",
    driveAudioFolderId: "",
    driveOutputFolderId: ""
  });

  const initRef = useRef(false);

  useEffect(() => {
    if (settings && !initRef.current) {
      setFormData({
        dailyUploadTime: settings.dailyUploadTime || "12:00",
        autoCycleEnabled: settings.autoCycleEnabled || false,
        maxRetries: settings.maxRetries || 3,
        defaultCategory: settings.defaultCategory || "Entertainment",
        youtubeCategoryId: settings.youtubeCategoryId || "20",
        driveVideoFolderId: settings.driveVideoFolderId || "",
        driveAudioFolderId: settings.driveAudioFolderId || "",
        driveOutputFolderId: settings.driveOutputFolderId || ""
      });
      initRef.current = true;
    }
  }, [settings]);

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    updateSettingsMutation.mutate(
      { data: formData },
      {
        onSuccess: () => {
          toast({ title: "Settings Saved", description: "Your configuration has been updated." });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Save Failed", description: err.message || "Failed to save settings", variant: "destructive" });
        }
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Automation Settings</h2>
          <p className="text-muted-foreground">Configure your pipeline defaults and folder mappings</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Schedule Defaults</CardTitle>
            <CardDescription>Control how and when the auto-cycler uploads</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="auto-cycle" className="flex flex-col space-y-1">
                <span>Enable Auto-Cycle</span>
                <span className="font-normal text-[0.8rem] text-muted-foreground">Automatically process and upload videos daily</span>
              </Label>
              <Switch 
                id="auto-cycle" 
                checked={formData.autoCycleEnabled} 
                onCheckedChange={(v) => handleChange('autoCycleEnabled', v)}
              />
            </div>

            <div className="space-y-2">
              <Label>Daily Upload Time</Label>
              <Input 
                type="time" 
                value={formData.dailyUploadTime}
                onChange={(e) => handleChange('dailyUploadTime', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Local timezone</p>
            </div>

            <div className="space-y-2">
              <Label>Max Retries (on failure)</Label>
              <Input 
                type="number" 
                min={0}
                max={10}
                value={formData.maxRetries}
                onChange={(e) => handleChange('maxRetries', parseInt(e.target.value))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content Defaults</CardTitle>
            <CardDescription>Default tags and categories for YouTube</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Default Category Name</Label>
              <Input 
                value={formData.defaultCategory}
                onChange={(e) => handleChange('defaultCategory', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>YouTube Category ID</Label>
              <Input 
                value={formData.youtubeCategoryId}
                onChange={(e) => handleChange('youtubeCategoryId', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">E.g., 20 for Gaming, 24 for Entertainment</p>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Google Drive Mapping</CardTitle>
            <CardDescription>Folder IDs where assets should be stored</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Video Input Folder ID</Label>
              <Input 
                placeholder="1A2B3C..."
                value={formData.driveVideoFolderId}
                onChange={(e) => handleChange('driveVideoFolderId', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Audio Input Folder ID</Label>
              <Input 
                placeholder="1A2B3C..."
                value={formData.driveAudioFolderId}
                onChange={(e) => handleChange('driveAudioFolderId', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Output Folder ID</Label>
              <Input 
                placeholder="1A2B3C..."
                value={formData.driveOutputFolderId}
                onChange={(e) => handleChange('driveOutputFolderId', e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="bg-muted/50 border-t border-border flex justify-end py-4">
            <Button 
              onClick={handleSave}
              disabled={updateSettingsMutation.isPending}
            >
              {updateSettingsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Configuration
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
