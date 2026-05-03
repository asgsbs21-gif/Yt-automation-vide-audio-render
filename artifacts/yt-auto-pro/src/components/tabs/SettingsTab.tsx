import { useState, useEffect } from "react";
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
import {
  Chrome, CheckCircle2, XCircle, Eye, EyeOff, Save,
  ExternalLink, Copy, Loader2, LogOut, ShieldCheck,
  KeyRound, Info, ChevronRight,
} from "lucide-react";

export function SettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: auth, refetch: refetchAuth } = useGetAuthStatus();
  const { data: settings } = useGetSettings();
  const logout = useLogout();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Populate from saved settings once loaded
  useEffect(() => {
    if (settings) {
      setClientId((settings as any).googleClientId ?? "");
      setClientSecret((settings as any).googleClientSecret ?? "");
      setDirty(false);
    }
  }, [settings]);

  const isAuthenticated = auth?.authenticated ?? false;
  const isConfigured = clientId.trim().length > 0 && clientSecret.trim().length > 0;

  // The redirect URI Google must whitelist — always derived from the browser origin
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
        body: JSON.stringify({
          googleClientId: clientId.trim(),
          googleClientSecret: clientSecret.trim(),
        }),
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: `${label} copied`, description: text })
    );
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Configure your own Google OAuth credentials so anyone can run this app with their own Google account.
        </p>
      </div>

      {/* ── Current connection status ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="w-4 h-4" /> Google Connection
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isAuthenticated && auth?.user ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {auth.user.picture ? (
                  <img src={auth.user.picture} alt="Avatar" className="w-10 h-10 rounded-full border border-border" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-sm border border-border">
                    {auth.user.name?.charAt(0) ?? "G"}
                  </div>
                )}
                <div>
                  <p className="font-medium text-sm">{auth.user.name}</p>
                  <p className="text-sm text-muted-foreground">{auth.user.email}</p>
                </div>
                <Badge variant="outline" className="ml-auto gap-1 bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={`gap-1 text-xs ${(auth.user as any).driveConnected ? "bg-blue-500/10 text-blue-600 border-blue-500/20" : "bg-muted text-muted-foreground"}`}>
                  {(auth.user as any).driveConnected
                    ? <><CheckCircle2 className="w-3 h-3" /> Drive: active</>
                    : <><XCircle className="w-3 h-3" /> Drive: no access</>}
                </Badge>
                <Badge variant="outline" className={`gap-1 text-xs ${(auth.user as any).youtubeConnected ? "bg-red-500/10 text-red-600 border-red-500/20" : "bg-muted text-muted-foreground"}`}>
                  {(auth.user as any).youtubeConnected
                    ? <><CheckCircle2 className="w-3 h-3" /> YouTube: active</>
                    : <><XCircle className="w-3 h-3" /> YouTube: no access</>}
                </Badge>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10"
                onClick={() => logout.mutate(undefined, { onSuccess: () => { refetchAuth(); } })}
              >
                <LogOut className="w-4 h-4 mr-2" /> Disconnect Google
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4 text-destructive" />
                Not connected to Google
              </div>
              {isConfigured && (
                <a href="/api/auth/google">
                  <Button className="gap-2 bg-blue-600 hover:bg-blue-700">
                    <Chrome className="w-4 h-4" /> Connect Google
                  </Button>
                </a>
              )}
              {!isConfigured && (
                <p className="text-xs text-muted-foreground">
                  Save your Google credentials below first, then the Connect button will appear.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Google OAuth credentials ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Google OAuth Credentials
          </CardTitle>
          <CardDescription>
            Enter your own Google Cloud credentials. They're saved in <code className="text-xs bg-muted px-1 py-0.5 rounded">data/settings.json</code> on the server — no Replit secrets needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Step guide */}
          <div className="rounded-lg bg-muted/50 border border-border p-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-500" /> How to get your credentials
            </p>
            <ol className="space-y-2 text-sm text-muted-foreground">
              {[
                <>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">console.cloud.google.com <ExternalLink className="w-3 h-3" /></a> → create a project</>,
                <>Enable <strong className="text-foreground">YouTube Data API v3</strong> and <strong className="text-foreground">Google Drive API</strong></>,
                <>APIs &amp; Services → Credentials → <strong className="text-foreground">Create OAuth client ID</strong> → Application type: <em>Web application</em></>,
                <>Under <strong className="text-foreground">Authorized redirect URIs</strong>, add exactly:</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/15 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            {/* Redirect URI copy box */}
            <div className="ml-7 flex items-center gap-2 bg-background border border-border rounded-md px-3 py-2">
              <code className="text-xs flex-1 break-all font-mono text-foreground">{redirectUri}</code>
              <button
                onClick={() => copyToClipboard(redirectUri, "Redirect URI")}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                title="Copy redirect URI"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="ml-7 text-xs text-muted-foreground">
              5. Copy the <strong className="text-foreground">Client ID</strong> and <strong className="text-foreground">Client Secret</strong> shown after creating the credential, then paste them below.
            </p>
          </div>

          <Separator />

          {/* Inputs */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="gClientId">Google Client ID</Label>
              <Input
                id="gClientId"
                placeholder="1234567890-abc123def456.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setDirty(true); }}
                className="font-mono text-sm"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gClientSecret">Google Client Secret</Label>
              <div className="relative">
                <Input
                  id="gClientSecret"
                  type={showSecret ? "text" : "password"}
                  placeholder="GOCSPX-••••••••••••••••••••••••••"
                  value={clientSecret}
                  onChange={(e) => { setClientSecret(e.target.value); setDirty(true); }}
                  className="font-mono text-sm pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving || !dirty || !clientId.trim() || !clientSecret.trim()}
              className="gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving…" : "Save Credentials"}
            </Button>

            {isConfigured && !dirty && !isAuthenticated && (
              <a href="/api/auth/google">
                <Button variant="outline" className="gap-2 border-blue-300 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20">
                  <Chrome className="w-4 h-4" />
                  Connect Google
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </a>
            )}

            {isConfigured && !dirty && isAuthenticated && (
              <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50 dark:bg-green-950/20">
                <CheckCircle2 className="w-3 h-3" /> Active
              </Badge>
            )}
          </div>

          {isConfigured && !dirty && (
            <p className="text-xs text-muted-foreground">
              Credentials saved. {isAuthenticated
                ? "Google is connected — Drive uploads and YouTube publishing are enabled."
                : "Click 'Connect Google' to sign in and authorise access."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Scopes note ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Requested Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              { scope: "Google Drive (full)", reason: "Upload muted videos and audio files to your Drive folders" },
              { scope: "YouTube upload", reason: "Publish processed Shorts to your YouTube channel" },
              { scope: "YouTube manage", reason: "Read channel stats shown on the Dashboard" },
              { scope: "Profile / email", reason: "Display your name and avatar in the sidebar" },
            ].map(({ scope, reason }) => (
              <li key={scope} className="flex gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-green-500 mt-0.5" />
                <span><strong className="text-foreground">{scope}</strong> — {reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            All OAuth tokens are stored only in your server session (memory) and never sent to any third party.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
