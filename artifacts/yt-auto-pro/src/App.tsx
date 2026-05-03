import { useState } from "react";
import { useGetAuthStatus, useLogout } from "@workspace/api-client-react";
import { Login } from "./components/Login";
import { DashboardTab } from "./components/tabs/DashboardTab";
import { VideosTab } from "./components/tabs/VideosTab";
import { AudioTab } from "./components/tabs/AudioTab";
import { ProcessTab } from "./components/tabs/ProcessTab";
import { QueueTab } from "./components/tabs/QueueTab";
import { ScheduleTab } from "./components/tabs/ScheduleTab";
import { LogsTab } from "./components/tabs/LogsTab";
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
  Loader2
} from "lucide-react";

type TabId = 'dashboard' | 'videos' | 'audio' | 'process' | 'queue' | 'schedule' | 'logs';

export default function App() {
  const { data: auth, isLoading: authLoading } = useGetAuthStatus();
  const logout = useLogout();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!auth?.authenticated) {
    return <Login />;
  }

  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, component: DashboardTab },
    { id: 'videos', label: 'Videos', icon: Video, component: VideosTab },
    { id: 'audio', label: 'Audio', icon: Music, component: AudioTab },
    { id: 'process', label: 'Process', icon: Settings2, component: ProcessTab },
    { id: 'queue', label: 'Queue', icon: ListOrdered, component: QueueTab },
    { id: 'schedule', label: 'Schedule', icon: CalendarClock, component: ScheduleTab },
    { id: 'logs', label: 'Logs', icon: TerminalSquare, component: LogsTab },
  ] as const;

  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || DashboardTab;

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground selection:bg-primary/30">
      {/* Sidebar */}
      <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border bg-sidebar flex flex-col shrink-0">
        <div className="p-4 md:p-6 flex items-center gap-3 border-b border-border">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold shrink-0 shadow-lg shadow-primary/20">
            YT
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight leading-none text-foreground">Auto Pro</h1>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono mt-1 block">Cockpit</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4 px-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible hide-scrollbar">
          {TABS.map(tab => {
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
                <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : ''}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-border bg-sidebar/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 overflow-hidden">
              {auth.user?.picture ? (
                <img src={auth.user.picture} alt="Avatar" className="w-8 h-8 rounded-full border border-border" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold text-xs border border-border">
                  {auth.user?.name?.charAt(0) || "U"}
                </div>
              )}
              <div className="text-xs truncate">
                <div className="font-medium truncate text-foreground">{auth.user?.name}</div>
                <div className="text-muted-foreground truncate">{auth.user?.email}</div>
              </div>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10 transition-colors"
            onClick={() => {
              logout.mutate(undefined, {
                onSuccess: () => window.location.reload()
              });
            }}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background/50">
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
            <ActiveComponent />
          </div>
        </main>
      </div>
    </div>
  );
}
