import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Settings,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  activeAppNavigationLabel,
  isAppNavigationItemActive,
} from "@/components/app-navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import logoWhite from "@/assets/new_logo_white.png";

const ANALYTICS_URL: string =
  (import.meta.env.VITE_MARKETPLACE_ANALYTICS_URL as string | undefined) ||
  "https://datastudio.google.com/u/0/reporting/8475305e-1260-4c51-851d-b2f755d4c82c/page/p_92rv9whn3d";

interface NavigationItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

const NAVIGATION_GROUPS: ReadonlyArray<{
  label: string;
  items: readonly NavigationItem[];
}> = [
  {
    label: "Workspace",
    items: [
      { path: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { path: "/accounts", label: "Accounts", icon: Building2 },
    ],
  },
  {
    label: "Insights",
    items: [{ path: "/reports", label: "Reports", icon: BarChart3 }],
  },
  {
    label: "Administration",
    items: [{ path: "/settings", label: "Settings", icon: Settings }],
  },
];

const NAVIGATION_ITEMS = NAVIGATION_GROUPS.flatMap((group) => group.items);

function NavigationLink({ item }: { item: NavigationItem }) {
  const [location] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isAppNavigationItemActive(location, item.path)}
        tooltip={item.label}
        className="h-8 text-[13px] data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground"
      >
        <Link
          href={item.path}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
        >
          <item.icon className="size-4" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppSidebar() {
  const { logout, operator } = useAuth();

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border px-3">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <img
            src={logoWhite}
            alt="DRUID"
            className="h-7 w-auto max-w-[116px] object-contain group-data-[collapsible=icon]:hidden"
          />
          <span className="hidden size-7 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-sm font-semibold text-primary group-data-[collapsible=icon]:flex">
            D
          </span>
          <div className="min-w-0 border-l border-sidebar-border pl-3 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-[11px] font-semibold leading-4 text-sidebar-accent-foreground">
              Mission Control
            </p>
            <p className="truncate text-[10px] leading-4 text-sidebar-foreground">
              GTM operations
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <nav aria-label="Primary navigation">
          {NAVIGATION_GROUPS.map((group) => (
            <SidebarGroup key={group.label} className="py-1.5">
              <SidebarGroupLabel className="h-6 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/70">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <NavigationLink key={item.path} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>

        {ANALYTICS_URL && (
          <SidebarGroup className="mt-auto py-2 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="h-6 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/70">
              External
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <a
                href={ANALYTICS_URL}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                <span>Marketplace Analytics</span>
              </a>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        {operator?.name && (
          <p className="truncate px-2 py-1 text-[10px] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            Acting as {operator.name}
          </p>
        )}

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="h-8 text-sidebar-foreground hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-4" />
              <span>{logout.isPending ? "Signing out…" : "Sign out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function AppTopbar() {
  const [location] = useLocation();
  const sectionLabel = activeAppNavigationLabel(location, NAVIGATION_ITEMS);

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-[var(--page-gutter)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:h-14">
      <SidebarTrigger className="size-8" />
      <div className="h-4 w-px bg-border" aria-hidden="true" />
      <p className="truncate text-sm font-medium text-foreground">{sectionLabel}</p>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <AppTopbar />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export { ANALYTICS_URL, NAVIGATION_GROUPS };
