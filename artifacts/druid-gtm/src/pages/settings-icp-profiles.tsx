import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Plus } from "lucide-react";
import { SettingsNav } from "@/components/settings-nav";
import { InlineNotice } from "@/components/inline-notice";
import { PageHeader, PageLayout } from "@/components/page-layout";
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
import {
  deriveProfileBadges,
  latestProfileActivityAt,
  classificationLabel,
  classificationBadgeVariant,
  describeProfileTargetSummary,
} from "@/lib/icp-profile-presentation";

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
    <InlineNotice tone="danger" title="Could not load ICP profiles">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </InlineNotice>
  );
}

// ─── Profile row ────────────────────────────────────────────────────────────

function ProfileRow({ profile }: { profile: IcpProfileListItem }) {
  const badges = deriveProfileBadges(profile);
  const lastUpdated = latestProfileActivityAt(profile);
  const targetSummary = describeProfileTargetSummary(profile);

  return (
    <Link href={`/settings/icp-profiles/${profile.id}`}>
      <Card className="border-border bg-card hover:bg-white/[0.03] transition-colors cursor-pointer">
        <div className="flex items-start gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {profile.name}
              </span>
              <Badge
                variant={classificationBadgeVariant(profile.classification)}
                className="text-[10px] px-1.5 py-0"
              >
                {classificationLabel(profile.classification)}
              </Badge>
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
            <p className="text-xs text-foreground/80 mt-1 leading-relaxed line-clamp-2">
              {targetSummary}
            </p>
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
    <PageLayout width="narrow" className="space-y-6">
      <SettingsNav />

      <PageHeader
        title="ICP Profiles"
        description="Define and manage the criteria used to evaluate accounts against your ideal customer profile."
        actions={
          <Button onClick={() => setNewProfileOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            New ICP profile
          </Button>
        }
      />

      {profilesQ.isLoading && <ListSkeleton />}

      {!profilesQ.isLoading && profilesQ.isError && (
        <ListErrorState error={profilesQ.error} onRetry={() => void profilesQ.refetch()} />
      )}

      {!profilesQ.isLoading && !profilesQ.isError && profiles.length === 0 && (
        <Empty>
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
    </PageLayout>
  );
}
