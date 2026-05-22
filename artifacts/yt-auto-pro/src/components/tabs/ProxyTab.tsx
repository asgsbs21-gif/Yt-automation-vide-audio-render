import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, ShieldCheck, ShieldOff, Zap, Trash2, RefreshCw,
  CheckCircle2, XCircle, Loader2, Globe, Info, ChevronRight,
} from "lucide-react";

interface ProxyStatus {
  active: boolean;
  proxy: string | null;
  type: string;
  xrayInstalled: boolean;
  vmessLink: string | null;
}

interface TestResult {
  ok: boolean;
  ip?: string;
  latency_ms?: number;
  error?: string;
}

interface BulkJob {
  id: string;
  mode: string;
  status: string;
  createdAt: number;
  finishedAt: number | null;
  items: Array<{
    index: number;
    url: string;
    status: string;
    title: string | null;
    fileName: string | null;
    error: string | null;
    sizeBytes: number;
  }>;
  summary: { total: number; ok: number; failed: number };
}

const MODE_LABELS: Record<string, string> = {
  video_audio: "Video + Audio",
  audio: "Audio only",
  video: "Video only",
};

export function ProxyTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [testResult, setTestResult]   = useState<TestResult | null>(null);
  const [vmessInput, setVmessInput]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [removing, setRemoving] = useState(false);

  const [urlsText, setUrlsText]   = useState("");
  const [mode, setMode]           = useState<"video_audio" | "audio" | "video">("video_audio");
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs]           = useState<BulkJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const r = await fetch("/api/proxy/status");
      if (r.ok) setProxyStatus(await r.json() as ProxyStatus);
    } catch {}
  };

  const fetchJobs = async () => {
    try {
      const r = await fetch("/api/bulk-jobs");
      if (r.ok) {
        const data = await r.json() as { jobs: BulkJob[] };
        setJobs(data.jobs);
      }
    } catch {}
  };

  useEffect(() => {
    void fetchStatus();
    void fetchJobs();
    pollRef.current = setInterval(() => { void fetchJobs(); }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleSave = async () => {
    if (!vmessInput.trim()) {
      toast({ title: "Please enter a proxy link", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/proxy/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vmessLink: vmessInput.trim() }),
      });
      const data = await r.json() as { ok?: boolean; message?: string; error?: string };
      if (!r.ok) throw new Error(data.error || "Save failed");
      toast({ title: "Proxy saved", description: data.message });
      setVmessInput("");
      await fetchStatus();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const r = await fetch("/api/proxy/save", { method: "DELETE" });
      if (!r.ok) throw new Error("Remove failed");
      setTestResult(null);
      toast({ title: "Proxy removed" });
      await fetchStatus();
    } catch (e: any) {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/proxy/test", { method: "POST" });
      const data = await r.json() as TestResult;
      setTestResult(data);
      if (data.ok) {
        toast({ title: `Proxy working`, description: `IP: ${data.ip} | ${data.latency_ms}ms` });
      } else {
        toast({ title: "Proxy test failed", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Test error", description: e.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleBulkSubmit = async () => {
    if (!urlsText.trim()) {
      toast({ title: "Enter at least one URL", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/bulk-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urlsText, mode }),
      });
      const data = await r.json() as { ok?: boolean; jobId?: string; error?: string };
      if (!r.ok) throw new Error(data.error || "Failed");
      toast({ title: "Bulk job started", description: `Job ID: ${data.jobId}` });
      setUrlsText("");
      await fetchJobs();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteJob = async (id: string) => {
    try {
      await fetch(`/api/bulk-jobs/${id}`, { method: "DELETE" });
      await fetchJobs();
    } catch {}
  };

  const proxyActive = proxyStatus?.active ?? false;
  const proxyType   = proxyStatus?.type ?? "direct";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Config</h2>
        <p className="text-muted-foreground">VMess/VLESS/Trojan/SOCKS5 proxy for yt-dlp + bulk YouTube download.</p>
      </div>

      {/* Proxy Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {proxyActive ? <ShieldCheck className="w-4 h-4 text-green-500" /> : <ShieldOff className="w-4 h-4 text-muted-foreground" />}
            Proxy Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className={proxyActive ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-muted text-muted-foreground"}>
              {proxyActive ? `Active — ${proxyType}` : "No proxy (direct)"}
            </Badge>
            {proxyStatus?.proxy && (
              <span className="text-xs font-mono text-muted-foreground">{proxyStatus.proxy}</span>
            )}
            {!proxyStatus?.xrayInstalled && (
              <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-xs">
                xray not installed — passthrough/socks5 only
              </Badge>
            )}
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 ${testResult.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"}`}>
              {testResult.ok
                ? <><CheckCircle2 className="w-4 h-4 shrink-0" /> IP: <strong>{testResult.ip}</strong> | {testResult.latency_ms}ms</>
                : <><XCircle className="w-4 h-4 shrink-0" /> {testResult.error}</>
              }
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void fetchStatus()}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            {proxyActive && (
              <>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleTest()} disabled={testing}>
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {testing ? "Testing…" : "Test Proxy"}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => void handleRemove()} disabled={removing}>
                  {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Remove
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Save Proxy Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="w-4 h-4" /> Set Proxy Link</CardTitle>
          <CardDescription>Paste a vmess://, vless://, trojan://, ss://, or socks5:// link.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1.5">
            <p className="text-xs font-semibold flex items-center gap-1.5"><Info className="w-3.5 h-3.5 text-blue-500" /> Supported formats</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li><code className="font-mono">vmess://eyJ2IjoiMiIsInBzIjoi...</code></li>
              <li><code className="font-mono">vless://uuid@host:port?type=ws&amp;security=tls&amp;...</code></li>
              <li><code className="font-mono">trojan://password@host:port?sni=...</code></li>
              <li><code className="font-mono">ss://BASE64@host:port</code></li>
              <li><code className="font-mono">socks5://user:pass@host:port</code></li>
            </ul>
          </div>

          <Textarea
            placeholder="Paste your proxy link here…"
            value={vmessInput}
            onChange={(e) => setVmessInput(e.target.value)}
            rows={3}
            className="font-mono text-xs resize-none"
          />

          <Button onClick={() => void handleSave()} disabled={saving || !vmessInput.trim()} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            {saving ? "Saving…" : "Save & Start Proxy"}
          </Button>
        </CardContent>
      </Card>

      {/* Bulk Download Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="w-4 h-4" /> Bulk YouTube Download</CardTitle>
          <CardDescription>Paste YouTube URLs (one per line). Downloads via proxy using 5 client strategies.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(["video_audio", "audio", "video"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${mode === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          <Textarea
            placeholder={"https://youtube.com/shorts/abc\nhttps://youtube.com/shorts/xyz\n…"}
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            rows={5}
            className="font-mono text-xs resize-none"
          />

          <Button onClick={() => void handleBulkSubmit()} disabled={submitting || !urlsText.trim()} className="gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            {submitting ? "Starting…" : "Start Bulk Download"}
          </Button>
        </CardContent>
      </Card>

      {/* Jobs List */}
      {jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bulk Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{job.id}</span>
                  <Badge variant="outline" className={
                    job.status === "done"    ? "bg-green-500/10 text-green-600 border-green-500/20" :
                    job.status === "running" ? "bg-blue-500/10 text-blue-600 border-blue-500/20 animate-pulse" :
                    job.status === "failed"  ? "bg-destructive/10 text-destructive border-destructive/20" :
                    "bg-muted text-muted-foreground"
                  }>
                    {job.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{MODE_LABELS[job.mode] ?? job.mode}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {job.summary.ok}/{job.summary.total} OK
                    {job.summary.failed > 0 && `, ${job.summary.failed} failed`}
                  </span>
                  <button
                    onClick={() => void handleDeleteJob(job.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Progress bar */}
                {job.status === "running" && (
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500 rounded-full"
                      style={{ width: `${Math.round(((job.summary.ok + job.summary.failed) / job.summary.total) * 100)}%` }}
                    />
                  </div>
                )}

                {/* Items */}
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {job.items.map((item) => (
                    <div key={item.index} className="flex items-start gap-2 text-xs">
                      <span className={`shrink-0 mt-0.5 ${
                        item.status === "ready"       ? "text-green-500" :
                        item.status === "failed"      ? "text-destructive" :
                        item.status === "downloading" ? "text-blue-500" :
                        "text-muted-foreground"
                      }`}>
                        {item.status === "ready"       ? "✓" :
                         item.status === "failed"      ? "✗" :
                         item.status === "downloading" ? "↓" : "·"}
                      </span>
                      <span className="text-muted-foreground truncate flex-1">
                        {item.title || item.url.split("/").pop() || item.url.slice(0, 40)}
                        {item.fileName && <span className="text-foreground ml-1">{item.fileName.slice(0, 30)}</span>}
                        {item.error && <span className="text-destructive ml-1">{item.error.split("\n")[0].slice(0, 60)}</span>}
                      </span>
                      {item.sizeBytes > 0 && (
                        <span className="shrink-0 text-muted-foreground">{(item.sizeBytes / (1024 * 1024)).toFixed(1)}MB</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
