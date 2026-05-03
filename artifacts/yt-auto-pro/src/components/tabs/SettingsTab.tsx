import { useEffect, useRef, useState } from "react";
import { useGetAuthStatus, useGetSettings, useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Chrome, CheckCircle2, XCircle, Eye, EyeOff, Save, ExternalLink, Copy, Loader2, LogOut, ShieldCheck, KeyRound, Info, ChevronRight, Upload, Trash2 } from "lucide-react";

export function SettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cookieInputRef = useRef<HTMLInputElement>(null);

  const { data: auth, refetch: refetchAuth } = useGetAuthStatus();
  const { data: settings } = useGetSettings();
  const logout = useLogout();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cookieBusy, setCookieBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setClientId((settings as any).googleClientId ?? "");
      setClientSecret((settings as any).googleClientSecret ?? "");
      setDirty(false);
    }
  }, [settings]);

  const isAuthenticated = auth?.authenticated ?? false;
  const isConfigured = clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const hasCookie = Boolean((settings as any)?.hasCookie);
  const redirectUri = `${window.location.origin}/api/auth/callback`;

  const handleSave = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({ title: "Both fields are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleClientId: clientId.trim(), googleClientSecret: clientSecret.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      await refetchAuth();
      setDirty(false);
      toast({ title: "Credentials saved", description: "Click 'Connect Google' to authorise the app." });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCookieUpload = async (file: File) => {
    setCookieBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/settings/cookies", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Cookie uploaded", description: "yt-dlp will use this automatically." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setCookieBusy(false);
      if (cookieInputRef.current) cookieInputRef.current.value = "";
    }
  };

  const handleRemoveCookie = async () => {
    setCookieBusy(true);
    try {
      const res = await fetch("/api/settings/cookies", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Remove failed");
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Cookie removed" });
    } catch (err: any) {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
    } finally {
      setCookieBusy(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ title: `${label} copied`, description: text }));
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Configure your own Google OAuth credentials and yt-dlp cookies.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="w-4 h-4" /> Google Connection</CardTitle>
        </CardHeader>
        <CardContent>
          {isAuthenticated && auth?.user ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {auth.user.picture ? <img src={auth.user.picture} alt="Avatar" className="w-10 h-10 rounded-full border border-border" /> : <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-sm border border-border">{auth.user.name?.charAt(0) ?? "G"}</div>}
                <div><p className="font-medium text-sm">{auth.user.name}</p><p className="text-sm text-muted-foreground">{auth.user.email}</p></div>
                <Badge variant="outline" className="ml-auto gap-1 bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle2 className="w-3 h-3" /> Connected</Badge>
              </div>
              <Button variant="outline" size="sm" className="text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10" onClick={() => logout.mutate(undefined, { onSuccess: () => { refetchAuth(); } })}><LogOut className="w-4 h-4 mr-2" /> Disconnect Google</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground text-sm"><XCircle className="w-4 h-4 text-destructive" /> Not connected to Google</div>
              {isConfigured && <a href="/api/auth/google"><Button className="gap-2 bg-blue-600 hover:bg-blue-700"><Chrome className="w-4 h-4" /> Connect Google</Button></a>}
              {!isConfigured && <p className="text-xs text-muted-foreground">Save your Google credentials below first, then the Connect button will appear.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4" /> Google OAuth Credentials</CardTitle>
          <CardDescription>Enter your own Google Cloud credentials. They're saved in <code className="text-xs bg-muted px-1 py-0.5 rounded">data/settings.json</code>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg bg-muted/50 border border-border p-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-1.5"><Info className="w-4 h-4 text-blue-500" /> How to get your credentials</p>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/15 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">1</span><span>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">console.cloud.google.com <ExternalLink className="w-3 h-3" /></a> → create a project</span></li>
              <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/15 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">2</span><span>Enable <strong className="text-foreground">YouTube Data API v3</strong> and <strong className="text-foreground">Google Drive API</strong></span></li>
              <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/15 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">3</span><span>APIs &amp; Services → Credentials → <strong className="text-foreground">Create OAuth client ID</strong> → Web application</span></li>
              <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/15 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">4</span><span>Add this redirect URI:</span></li>
            </ol>
            <div className="ml-7 flex items-center gap-2 bg-background border border-border rounded-md px-3 py-2"><code className="text-xs flex-1 break-all font-mono text-foreground">{redirectUri}</code><button onClick={() => copyToClipboard(redirectUri, "Redirect URI")} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"><Copy className="w-3.5 h-3.5" /></button></div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="gClientId">Google Client ID</Label><Input id="gClientId" placeholder="1234567890-abc123def456.apps.googleusercontent.com" value={clientId} onChange={(e) => { setClientId(e.target.value); setDirty(true); }} className="font-mono text-sm" autoComplete="off" /></div>
            <div className="space-y-1.5"><Label htmlFor="gClientSecret">Google Client Secret</Label><div className="relative"><Input id="gClientSecret" type={showSecret ? "text" : "password"} placeholder="GOCSPX-••••••••••••••••••••••••••" value={clientSecret} onChange={(e) => { setClientSecret(e.target.value); setDirty(true); }} className="font-mono text-sm pr-10" autoComplete="off" /><button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>{showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div></div>
          </div>

          <div className="flex items-center gap-3"><Button onClick={handleSave} disabled={saving || !dirty || !clientId.trim() || !clientSecret.trim()} className="gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saving ? "Saving…" : "Save Credentials"}</Button>{isConfigured && !dirty && !isAuthenticated && <a href="/api/auth/google"><Button variant="outline" className="gap-2 border-blue-300 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"><Chrome className="w-4 h-4" />Connect Google<ChevronRight className="w-3.5 h-3.5" /></Button></a>}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> YouTube Cookie</CardTitle>
          <CardDescription>Upload a cookies.txt file to help yt-dlp access age-restricted or private videos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input ref={cookieInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleCookieUpload(file); }} />
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" onClick={() => cookieInputRef.current?.click()} disabled={cookieBusy} className="gap-2"><Upload className="w-4 h-4" /> Upload cookies.txt</Button>
            <Button variant="outline" onClick={handleRemoveCookie} disabled={cookieBusy || !hasCookie} className="gap-2 text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /> Remove Cookie</Button>
            <Badge variant="outline" className={hasCookie ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-muted text-muted-foreground"}>{hasCookie ? "Cookie active" : "No cookie - some videos may fail"}</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
