import { useGetAuthStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { SiGoogle } from "react-icons/si";

export function Login() {
  const { data } = useGetAuthStatus();

  const handleLogin = () => {
    if (data?.authUrl) {
      window.location.href = data.authUrl;
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-md space-y-8 p-8 border border-border bg-card rounded-xl shadow-2xl">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">YT Auto Pro</h1>
          <p className="text-muted-foreground">Sign in to your automation cockpit</p>
        </div>

        <div className="pt-4 space-y-4">
          <Button 
            className="w-full py-6 text-base" 
            size="lg" 
            onClick={handleLogin}
            disabled={!data?.authUrl}
          >
            <SiGoogle className="mr-3 w-5 h-5" />
            Connect with Google
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Requires Google Drive and YouTube permissions to automate your workflow.
          </p>
        </div>
      </div>
    </div>
  );
}
