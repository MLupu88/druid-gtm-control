import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { SampleModeProvider } from "@/lib/sample-mode";
import { AppShell } from "@/components/app-shell";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import AccountsPage from "@/pages/accounts";
import AccountDetailPage from "@/pages/account-detail";
import SampleLeadPage from "@/pages/sample-lead";
import SettingsPage from "@/pages/settings";
import SettingsIcpProfilesPage from "@/pages/settings-icp-profiles";
import IcpProfileDetailPage from "@/pages/icp-profile-detail";
import ReportsPage from "@/pages/reports";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/accounts" component={AccountsPage} />
      <Route path="/accounts/:accountId" component={AccountDetailPage} />
      <Route path="/queue" component={() => <Redirect to="/accounts?view=attention" />} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/sample-lead" component={SampleLeadPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/settings/icp-profiles" component={SettingsIcpProfilesPage} />
      <Route
        path="/settings/icp-profiles/:profileId"
        component={IcpProfileDetailPage}
      />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { isLoading, isAuthed } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthed) {
    return <LoginPage />;
  }

  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <SampleModeProvider>
            <AppContent />
          </SampleModeProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
