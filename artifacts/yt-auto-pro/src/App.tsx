import { useState } from "react";
import { useGetAuthStatus, useLogout } from "@workspace/api-client-react";
import { DashboardTab } from "./components/tabs/DashboardTab";
import { VideosTab } from "./components/tabs/VideosTab";
import { AudioTab } from "./components/tabs/AudioTab";
import { ProcessTab } from "./components/tabs/ProcessTab";
import { QueueTab } from "./components/tabs/QueueTab";
import { ScheduleTab } from "./components/tabs/ScheduleTab";
import { LogsTab } from "./components/tabs/LogsTab";
import { JobProgressPanel } from "./components/JobProgressPanel";
import { useSocket } from "./hooks/useSocket";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Video,
  Music,
  Settings2,
  ListOrdered,
  CalendarClock,
  TerminalSquare,
  LogOut,
  Chrome,
  Loader2,
} from "lucide-react";

type TabId = "dashboard" | "videos" | "audio" | "process" | "queue" | "schedule" | "logs";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, component: DashboardTab },
  { id: "videos",    label: "Videos",    icon: Video,           component: VideosTab },
  { id: "audio",     label: "Audio",     icon: Music,           component: AudioTab },
  { id: "process",   label: "Process",   icon: Settings2,       component: ProcessTab },
  { id: "queue",     label: "Queue",     icon: ListOrdered,     component: QueueTab },
  { id: "schedule",  label: "Schedule",  icon: CalendarClock,   component: ScheduleTab },
  { id: "logs",      label: "Logs",      icon: TerminalSquare,  component: LogsTab },
] as const;

export default function App() {
  const { data: auth } = useGetAuthStatus();
  const logout = useLogout();
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const { runningCount } = useSocket();

  const ActiveComponent = TABS.find((t) => t.id === activeTab)?.component ?? DashboardTab;
  const isAuthenticated = auth?.authenticated ?? false;

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground selection:bg-primary/30">
      {/* Sidebar */}
      <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border bg-sidebar flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-4 md:p-6 flex items-center gap-3 border-b border-border">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold shrink-0 shadow-lg shadow-primary/20">
            YT
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-sm tracking-tight leading-none text-foreground">Auto Pro</h1>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono mt-1 block">Cockpit</span>
          </div>
          {runningCount > 0 && (
            <div className="flex items-center gap-1 text-primary">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[10px] font-mono font-bold">{runningCount}</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4 px-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible hide-scrollbar">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabId)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all shrink-0 md:shrink ${
                  isActive
                    ? "bg-accent text-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-primary" : ""}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Footer: Google account */}
        <div className="p-4 border-t border-border bg-sidebar/50">
          {isAuthenticated && auth?.user ? (
            <>
              <div className="flex items-center gap-2 overflow-hidden mb-3">
                {auth.user.picture ? (
                  <img src={auth.user.picture} alt="Avatar" className="w-8 h-8 rounded-full border border-border shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold text-xs border border-border shrink-0">
                    {auth.user.name?.charAt(0) ?? "G"}
                  </div>
                )}
                <div className="text-xs truncate">
                  <div className="font-medium truncate text-foreground">{auth.user.name}</div>
                  <div className="text-muted-foreground truncate">{auth.user.email}</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10 transition-colors"
                onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.reload() })}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect Google
              </Button>
            </>
          ) : (
            <a href="/api/auth/google" className="block">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <Chrome className="w-4 h-4 text-primary" />
                Connect Google
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background/50">
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
            <ActiveComponent />
          </div>
        </main>
      </div>

      {/* Floating job progress panel */}
      <JobProgressPanel />
    </div>
  );
}
