import { useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, AlertCircle, Info } from "lucide-react";
import { SettingsNav } from "@/components/settings-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { TechnicalDetails } from "@/components/technical-details";
import { IcpProfileDraftEditor } from "@/components/icp-profile-draft-editor";
import { ActivateVersionAction, CloneVersionAction } from "@/components/icp-profile-lifecycle-actions";
import { DraftVsActiveComparison } from "@/components/icp-profile-comparison";
import { cn } from "@/lib/utils";
import {
  fetchIcpProfileDetail,
  icpProfileDetailQueryKey,
  type IcpProfileDetail,
  type IcpProfileVersion,
} from "@/lib/icp-profiles-api";
import {
  humanizeVersionStatus,
  selectDefaultVersionId,
  summarizeVersionConfig,
} from "@/lib/icp-profile-presentation";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// ─── Sub-states ─────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-1/2 rounded-lg" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

// ─── Meta field (mirrors ../pages/account-detail.tsx's identical helper) ────
function MetaField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{label}</p>
      <p className="text-foreground font-medium mt-0.5">
        {value ?? <span className="text-muted-foreground font-normal">Not available</span>}
      </p>
    </div>
  );
}

// ─── Configuration summary counts ────────────────────────────────────────────
function SummaryCount({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-lg font-semibold text-foreground tabular-nums">
        {value === null ? "—" : value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Version history list ────────────────────────────────────────────────────
function VersionHistoryList({
  versions,
  activeVersionId,
  selectedVersionId,
  onSelect,
}: {
  /** Already ordered newest-first by the caller. */
  versions: IcpProfileVersion[];
  activeVersionId: string | null;
  selectedVersionId: string | null;
  onSelect: (versionId: string) => void;
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Version history
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {versions.map((version) => {
          const isSelected = version.id === selectedVersionId;
          const isActive = version.id === activeVersionId;
          return (
            <button
              key={version.id}
              type="button"
              onClick={() => onSelect(version.id)}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2 transition-colors border",
                isSelected
                  ? "bg-primary/10 border-primary/30"
                  : "border-transparent hover:bg-white/[0.03]",
              )}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium text-foreground">
                  Version {version.versionNumber}
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {humanizeVersionStatus(version.status)}
                </Badge>
                {isActive && (
                  <Badge className="text-[10px] px-1.5 py-0">Active</Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                {version.status === "published"
                  ? `Published ${formatDateTime(version.publishedAt)}`
                  : `Created ${formatDateTime(version.createdAt)}`}
              </p>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Selected version's read-only configuration summary ─────────────────────
function VersionSummaryCard({
  profileId,
  version,
  isActive,
  hasDraft,
}: {
  profileId: string;
  version: IcpProfileVersion;
  isActive: boolean;
  hasDraft: boolean;
}) {
  const summary = summarizeVersionConfig(version.config);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-sm font-semibold text-foreground">
            Version {version.versionNumber}
          </CardTitle>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {humanizeVersionStatus(version.status)}
          </Badge>
          {isActive && <Badge className="text-[10px] px-1.5 py-0">Active</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {version.status === "published" && (
          <div className="flex flex-wrap items-center gap-3 pb-1 border-b border-border/60">
            <ActivateVersionAction profileId={profileId} version={version} isActive={isActive} />
            {hasDraft ? (
              <p className="text-[11px] text-muted-foreground">
                Only one draft can exist at a time — publish or continue the
                current draft before cloning another version.
              </p>
            ) : (
              <CloneVersionAction profileId={profileId} version={version} />
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <MetaField label="Created" value={formatDateTime(version.createdAt)} />
          <MetaField label="Created by" value={version.createdBy} />
          <MetaField
            label="Published"
            value={version.status === "published" ? formatDateTime(version.publishedAt) : null}
          />
          <MetaField label="Notes" value={version.notes} />
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            Configuration summary
          </p>
          {summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <SummaryCount label="Fit rules" value={summary.fitRuleCount} />
              <SummaryCount label="Fit tiers" value={summary.fitTierCount} />
              <SummaryCount label="Intent rules" value={summary.intentRuleCount} />
              <SummaryCount label="Intent tiers" value={summary.intentTierCount} />
              <SummaryCount
                label="Actionability rules"
                value={summary.actionabilityRuleCount}
              />
              <SummaryCount
                label="Hard disqualifiers"
                value={summary.hardDisqualifierCount}
              />
              <SummaryCount label="Restrictions" value={summary.restrictionCount} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Configuration details are not available for this version.
            </p>
          )}
        </div>

        <TechnicalDetails>
          <div className="space-y-1.5 font-mono text-[11px] text-muted-foreground/80">
            <p>
              <span className="text-muted-foreground/50">Version ID:</span> {version.id}
            </p>
            <p>
              <span className="text-muted-foreground/50">Profile ID:</span> {version.profileId}
            </p>
            <pre className="whitespace-pre-wrap break-all mt-2 leading-relaxed">
              {JSON.stringify(version.config, null, 2)}
            </pre>
          </div>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

// ─── No-editable-draft message ───────────────────────────────────────────────
// Truthful: cloning a published version into a new draft is the way to
// start editing again once nothing is left in draft — that action lives
// on each published version's card below (Version history → select a
// published version → "Clone into new draft"), not here, since the
// source version must be explicit.
function NoDraftMessage() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Draft
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This profile has no editable draft. Select a published version below
          and clone it into a new draft to start editing again.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Content ──────────────────────────────────────────────────────────────────
function ProfileDetailContent({
  detail,
  onDraftDirtyChange,
}: {
  detail: IcpProfileDetail;
  onDraftDirtyChange: (dirty: boolean) => void;
}) {
  const { profile, versions } = detail;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(() =>
    selectDefaultVersionId(versions, profile.activeVersionId),
  );

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;
  const draftVersion = versions.find((v) => v.status === "draft") ?? null;
  const activeVersion = versions.find((v) => v.id === profile.activeVersionId) ?? null;

  // The API returns versions ordered by versionNumber ascending; history
  // reads better newest-first.
  const historyDescending = [...versions].sort(
    (a, b) => b.versionNumber - a.versionNumber,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
          {profile.name}
        </h1>
        {profile.description && (
          <p className="text-sm text-muted-foreground mt-1">{profile.description}</p>
        )}
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Activating a version doesn&apos;t change past evaluations</AlertTitle>
        <AlertDescription>
          Activating a new profile version does not automatically change evaluations
          already saved on existing accounts. Each saved evaluation stays tied to the
          profile version it was actually run against.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
              Active version
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeVersion ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  Version {activeVersion.versionNumber}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Published {formatDateTime(activeVersion.publishedAt)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No version is currently active.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
              Draft
            </CardTitle>
          </CardHeader>
          <CardContent>
            {draftVersion ? (
              <p className="text-sm font-medium text-foreground">
                Version {draftVersion.versionNumber} · in progress
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No draft in progress.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {draftVersion ? (
        <IcpProfileDraftEditor
          profile={profile}
          draftVersion={draftVersion}
          onDirtyChange={onDraftDirtyChange}
        />
      ) : (
        <NoDraftMessage />
      )}

      {draftVersion && (
        <DraftVsActiveComparison draftVersion={draftVersion} activeVersion={activeVersion} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
        {versions.length > 0 ? (
          <>
            <VersionHistoryList
              versions={historyDescending}
              activeVersionId={profile.activeVersionId}
              selectedVersionId={selectedVersionId}
              onSelect={setSelectedVersionId}
            />
            {selectedVersion && (
              <VersionSummaryCard
                profileId={profile.id}
                version={selectedVersion}
                isActive={selectedVersion.id === profile.activeVersionId}
                hasDraft={draftVersion !== null}
              />
            )}
          </>
        ) : (
          <Card className="border-border bg-card lg:col-span-2">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No versions exist yet for this profile.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function IcpProfileDetailPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const [draftDirty, setDraftDirty] = useState(false);

  const detailQ = useQuery({
    queryKey: icpProfileDetailQueryKey(profileId ?? ""),
    queryFn: () => fetchIcpProfileDetail(profileId!),
    enabled: !!profileId,
  });

  // Guards only this page's own "Back to ICP profiles" link — wouter has
  // no navigation-blocking hook to intercept the shared SettingsNav or
  // sidebar links the same way (see
  // ../components/icp-profile-draft-editor.tsx's beforeunload effect,
  // which covers tab close/refresh/typed-URL navigation instead). A
  // known gap, not silently pretended away — see the Slice 2 report.
  function handleBackClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!draftDirty) return;
    const confirmed = window.confirm(
      "You have unsaved changes to this draft. Leave without saving them?",
    );
    if (!confirmed) {
      e.preventDefault();
    }
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <SettingsNav />
      <Link
        href="/settings/icp-profiles"
        onClick={handleBackClick}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to ICP profiles
      </Link>

      {detailQ.isLoading && <DetailSkeleton />}

      {detailQ.isError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">
            {detailQ.error instanceof Error
              ? detailQ.error.message
              : "Could not load this ICP profile."}
          </p>
        </div>
      )}

      {!detailQ.isLoading && !detailQ.isError && detailQ.data === null && (
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No ICP profile exists with that ID.
          </p>
        </div>
      )}

      {detailQ.data && (
        <ProfileDetailContent detail={detailQ.data} onDraftDirtyChange={setDraftDirty} />
      )}
    </div>
  );
}
