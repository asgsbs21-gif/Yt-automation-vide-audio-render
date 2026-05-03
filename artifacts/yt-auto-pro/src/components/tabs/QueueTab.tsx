import { useState } from "react";
import { useListQueue, useScheduleUpload, useUploadNow, getListQueueQueryKey, getGetStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Upload, Calendar, ExternalLink, Youtube, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function QueueTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: queue, isLoading } = useListQueue();
  const scheduleMutation = useScheduleUpload();
  const uploadNowMutation = useUploadNow();

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>("");

  const handleUploadNow = (id: string) => {
    uploadNowMutation.mutate(
      { data: { queueItemId: id } },
      {
        onSuccess: () => {
          toast({ title: "Upload Started", description: "Video is currently uploading to YouTube." });
          queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatusQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Upload Failed", description: err.message || "Failed to start upload", variant: "destructive" });
        }
      }
    );
  };

  const handleScheduleSubmit = () => {
    if (!selectedItemId || !scheduleDate) return;
    
    // Append time to date if needed, or use datetime-local input directly
    const isoDate = new Date(scheduleDate).toISOString();

    scheduleMutation.mutate(
      { data: { queueItemId: selectedItemId, scheduledAt: isoDate } },
      {
        onSuccess: () => {
          toast({ title: "Scheduled", description: `Video scheduled for ${format(new Date(isoDate), 'PPpp')}` });
          setScheduleModalOpen(false);
          queryClient.invalidateQueries({ queryKey: getListQueueQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatusQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Schedule Failed", description: err.message || "Failed to schedule", variant: "destructive" });
        }
      }
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="secondary" className="bg-gray-500/10 text-gray-500">Pending</Badge>;
      case "scheduled": return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">Scheduled</Badge>;
      case "uploading": return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 animate-pulse">Uploading</Badge>;
      case "uploaded": return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Uploaded</Badge>;
      case "failed": return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">Failed</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Upload Queue</h2>
          <p className="text-muted-foreground">Manage your output videos and YouTube scheduling</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue Items</CardTitle>
          <CardDescription>Processed videos ready for upload to YouTube</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : queue && queue.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium max-w-[250px]">
                        <div className="truncate" title={item.title}>{item.title}</div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {item.tags.slice(0, 3).map(t => `#${t}`).join(" ")}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.scheduledAt ? format(new Date(item.scheduledAt), 'PPp') : '-'}
                      </TableCell>
                      <TableCell>
                        {item.error && (
                          <div className="flex items-center text-xs text-destructive max-w-[150px] truncate" title={item.error}>
                            <AlertCircle className="w-3 h-3 mr-1 shrink-0" />
                            <span className="truncate">{item.error}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {item.status === 'uploaded' && item.youtubeUrl ? (
                            <Button size="sm" variant="outline" asChild>
                              <a href={item.youtubeUrl} target="_blank" rel="noopener noreferrer">
                                <Youtube className="w-4 h-4 mr-2 text-red-500" />
                                View
                              </a>
                            </Button>
                          ) : (
                            <>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                disabled={item.status === 'uploading' || item.status === 'uploaded'}
                                onClick={() => {
                                  setSelectedItemId(item.id);
                                  setScheduleDate("");
                                  setScheduleModalOpen(true);
                                }}
                              >
                                <Calendar className="w-4 h-4 mr-2" />
                                Schedule
                              </Button>
                              <Button 
                                size="sm"
                                disabled={item.status === 'uploading' || item.status === 'uploaded' || uploadNowMutation.isPending}
                                onClick={() => handleUploadNow(item.id)}
                              >
                                {uploadNowMutation.isPending && uploadNowMutation.variables?.data.queueItemId === item.id ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <Upload className="w-4 h-4 mr-2" />
                                )}
                                Upload Now
                              </Button>
                            </>
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
              <Upload className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No items in your queue.</p>
              <p className="text-sm mt-2">Go to the Process tab to merge new videos.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Upload</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Date & Time</label>
              <Input 
                type="datetime-local" 
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleScheduleSubmit} 
              disabled={!scheduleDate || scheduleMutation.isPending}
            >
              {scheduleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
