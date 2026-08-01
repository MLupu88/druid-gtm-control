import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

// Secondary in-page navigation shared by every Settings-area page
// (../pages/settings.tsx, ../pages/settings-icp-profiles.tsx,
// ../pages/icp-profile-detail.tsx) — distinct from the primary app
// sidebar (../App.tsx's AppSidebar), which only links to the top-level
// /settings section once. This is what actually splits "General / GTM
// Operations" from "ICP Profiles" into two clearly separate areas rather
// than appending ICP Profiles to the bottom of the existing long
// settings page.
//
// "ICP Profiles" is considered active for both /settings/icp-profiles
// and any nested path under it (e.g. /settings/icp-profiles/:profileId)
// — a prefix match, unlike "General", which only matches the exact
// /settings path (so it doesn't also light up while viewing an ICP
// profile).
const SETTINGS_SECTIONS = [
  { path: "/settings", label: "General" },
  { path: "/settings/icp-profiles", label: "ICP Profiles" },
] as const;

export function SettingsNav() {
  const [location] = useLocation();

  return (
    <nav className="flex items-center gap-1 border-b border-border mb-6 -mt-1">
      {SETTINGS_SECTIONS.map((section) => {
        const isActive =
          section.path === "/settings"
            ? location === "/settings"
            : location === section.path || location.startsWith(`${section.path}/`);
        return (
          <Link
            key={section.path}
            href={section.path}
            className={cn(
              "px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
