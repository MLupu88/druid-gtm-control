import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  LayoutList,
  Building2,
  Settings,
  BarChart3,
  LogOut,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { SampleModeProvider } from "@/lib/sample-mode";
import { useTheme } from "@/lib/theme";
import logoWhite from "@/assets/new_logo_white.png";
import logoBlack from "@/assets/new-druid-logo-black.png";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import QueuePage from "@/pages/queue";
import AccountsPage from "@/pages/accounts";
import AccountDetailPage from "@/pages/account-detail";
import SampleLeadPage from "@/pages/sample-lead";
import SettingsPage from "@/pages/settings";
import ReportsPage from "@/pages/reports";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

const ANALYTICS_URL: string =
  (import.meta.env.VITE_MARKETPLACE_ANALYTICS_URL as string | undefined) ||
  "https://datastudio.google.com/u/0/reporting/8475305e-1260-4c51-851d-b2f755d4c82c/page/p_92rv9whn3d";

function AppSidebar() {
  const [location] = useLocation();
  const { logout, operator } = useAuth();
  const { theme, setTheme } = useTheme();

  const navItems = [
    { path: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { path: "/accounts", label: "Accounts", icon: Building2 },
    { path: "/queue", label: "Needs Your Attention", icon: LayoutList },
    { path: "/reports", label: "Reports", icon: BarChart3 },
    { path: "/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-4 border-b border-sidebar-border">
        {/* Expanded: logo stacked above app title */}
        <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
          <img
            src={logoWhite}
            alt="DRUID"
            className="logo-white h-8 w-auto max-w-[160px] object-contain"
            style={{ objectFit: "contain" }}
          />
          <img
            src={logoBlack}
            alt="DRUID"
            className="logo-black h-8 w-auto max-w-[160px] object-contain"
            style={{ objectFit: "contain" }}
          />
          <span className="text-[11px] font-semibold text-sidebar-foreground tracking-wide leading-tight">
            GTM Marketplace Signals
          </span>
        </div>
        {/* Collapsed: "D" initial */}
        <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center w-full py-0.5">
          <span className="text-sm font-bold text-primary font-display">D</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-3 flex flex-col">
        <SidebarMenu>
          {navItems.map(({ path, label, icon: Icon }) => (
            <SidebarMenuItem key={path}>
              <SidebarMenuButton
                asChild
                isActive={location === path || (path === "/dashboard" && location === "/")}
                tooltip={label}
              >
                <a href={path}>
                  <Icon className="size-4" />
                  <span>{label}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        {/* External analytics */}
        {ANALYTICS_URL && (
          <div className="mt-auto pt-4 px-2 group-data-[collapsible=icon]:hidden">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
              External analytics
            </p>
            <a
              href={ANALYTICS_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors w-full"
            >
              <ExternalLink className="size-3.5 shrink-0" />
              <span>Marketplace Analytics</span>
            </a>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="py-3 border-t border-sidebar-border">
        <SidebarMenu>
          {/* Appearance toggle */}
          <SidebarMenuItem>
            <div className="px-2 py-1.5 group-data-[collapsible=icon]:hidden">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                Appearance
              </p>
              <div className="flex gap-1 rounded-lg border border-sidebar-border p-0.5">
                <button
                  onClick={() => setTheme("light")}
                  className={[
                    "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    theme === "light"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  Light
                </button>
                <button
                  onClick={() => setTheme("dark")}
                  className={[
                    "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    theme === "dark"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  Dark
                </button>
              </div>
            </div>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              onClick={() => logout.mutate()}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {operator?.name && (
          <p className="px-3 pt-2 text-[10px] text-muted-foreground truncate group-data-[collapsible=icon]:hidden">
            Acting as {operator.name}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function AppShell() {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppSidebar />
        <SidebarInset className="flex-1 overflow-auto">
          <Switch>
            <Route path="/" component={() => <Redirect to="/dashboard" />} />
            <Route path="/dashboard" component={DashboardPage} />
            <Route path="/accounts" component={AccountsPage} />
            <Route path="/accounts/:accountId" component={AccountDetailPage} />
            <Route path="/queue" component={QueuePage} />
            <Route path="/reports" component={ReportsPage} />
            <Route path="/sample-lead" component={SampleLeadPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </SidebarInset>
      </div>
    </SidebarProvider>
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

  return <AppShell />;
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
