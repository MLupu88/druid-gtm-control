import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, ChevronRight, Plus } from "lucide-react";
import { SettingsNav } from "@/components/settings-nav";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { NewIcpProfileDialog } from "@/components/icp-new-profile-dialog";
import {
  fetchIcpProfiles,
  icpProfilesListQueryKey,
  type IcpProfileListItem,
} from "@/lib/icp-profiles-api";
import { deriveProfileBadges, latestProfileActivityAt } from "@/lib/icp-profile-presentation";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// ─── Sub-states ─────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function ListErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : "Could not load ICP profiles.";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <p className="text-sm text-red-300">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ─── Profile row ────────────────────────────────────────────────────────────

function ProfileRow({ profile }: { profile: IcpProfileListItem }) {
  const badges = deriveProfileBadges(profile);
  const lastUpdated = latestProfileActivityAt(profile);

  return (
    <Link href={`/settings/icp-profiles/${profile.id}`}>
      <Card className="border-border bg-card hover:bg-white/[0.03] transition-colors cursor-pointer">
        <div className="flex items-start gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {profile.name}
              </span>
              {badges.map((badge) => (
                <Badge
                  key={badge.key}
                  variant={badge.variant}
                  className="text-[10px] px-1.5 py-0"
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
            {profile.description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                {profile.description}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/60 mt-1.5">
              Last updated {formatDateTime(lastUpdated)}
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        </div>
      </Card>
    </Link>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettingsIcpProfilesPage() {
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const profilesQ = useQuery({
    queryKey: icpProfilesListQueryKey(),
    queryFn: fetchIcpProfiles,
  });

  const profiles = profilesQ.data ?? [];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <SettingsNav />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
            ICP Profiles
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define and manage the criteria used to evaluate accounts against your
            ideal customer profile.
          </p>
        </div>
        <Button onClick={() => setNewProfileOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          New ICP profile
        </Button>
      </div>

      {profilesQ.isLoading && <ListSkeleton />}

      {!profilesQ.isLoading && profilesQ.isError && (
        <ListErrorState error={profilesQ.error} onRetry={() => void profilesQ.refetch()} />
      )}

      {!profilesQ.isLoading && !profilesQ.isError && profiles.length === 0 && (
        <Empty className="border border-border rounded-xl bg-card py-10">
          <EmptyHeader>
            <EmptyTitle>No ICP profiles yet</EmptyTitle>
            <EmptyDescription>
              ICP profiles define the criteria — fit, buying intent, and eligibility
              — used to evaluate accounts. Create one to get started.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!profilesQ.isLoading && !profilesQ.isError && profiles.length > 0 && (
        <div className="space-y-2">
          {profiles.map((profile) => (
            <ProfileRow key={profile.id} profile={profile} />
          ))}
        </div>
      )}

      <NewIcpProfileDialog open={newProfileOpen} onOpenChange={setNewProfileOpen} />
    </div>
  );
}
