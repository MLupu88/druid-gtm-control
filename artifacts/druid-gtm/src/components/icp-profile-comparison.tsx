import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TechnicalDetails } from "@/components/technical-details";
import { cn } from "@/lib/utils";
import type { IcpProfileVersion } from "@/lib/icp-profiles-api";
import { validateProfileConfigDraft } from "@/lib/icp-profile-config-validation";
import {
  diffProfileConfigs,
  profileConfigDiffIsEmpty,
  sectionHasDifferences,
  type SectionDiff,
  type DiffEntry,
} from "@/lib/icp-profile-config-diff";
import type { WeightedRule, ConditionRule, Tier } from "@workspace/evaluator";

// A pure configuration comparison between the current draft and the
// currently active published version — never an impact estimate,
// affected-account count, or re-score result (those would require
// running the evaluator against real accounts, out of scope here; see
// ../lib/icp-profile-config-diff.ts). Rules are matched by their stable
// id and tiers by their stable code (never array position), so
// reordering alone never shows as removed+added.

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// ─── Entry renderers (one per item shape) ────────────────────────────────────
function WeightedRuleEntryRow({ entry }: { entry: DiffEntry<WeightedRule> }) {
  const item = (entry.draft ?? entry.active)!;
  const changeParts: string[] = [];
  for (const field of entry.changedFields) {
    if (field === "points") {
      changeParts.push(`Points: ${entry.active?.points} → ${entry.draft?.points}`);
    } else if (field === "description") {
      changeParts.push("Description changed");
    } else if (field === "condition") {
      changeParts.push("Condition changed");
    }
  }
  return (
    <div>
      <span className="text-foreground">{item.description || "(no description)"}</span>
      <span className="text-muted-foreground"> · {item.points} pts</span>
      {changeParts.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{changeParts.join(" · ")}</p>
      )}
    </div>
  );
}

function ConditionRuleEntryRow({ entry }: { entry: DiffEntry<ConditionRule> }) {
  const item = (entry.draft ?? entry.active)!;
  const changeParts: string[] = [];
  for (const field of entry.changedFields) {
    if (field === "description") changeParts.push("Description changed");
    else if (field === "condition") changeParts.push("Condition changed");
  }
  return (
    <div>
      <span className="text-foreground">{item.description || "(no description)"}</span>
      {changeParts.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{changeParts.join(" · ")}</p>
      )}
    </div>
  );
}

function TierEntryRow({ entry }: { entry: DiffEntry<Tier> }) {
  const item = (entry.draft ?? entry.active)!;
  const changeParts: string[] = [];
  for (const field of entry.changedFields) {
    if (field === "minScore") {
      changeParts.push(`Minimum score: ${entry.active?.minScore} → ${entry.draft?.minScore}`);
    }
  }
  return (
    <div>
      <span className="text-foreground">{item.code}</span>
      <span className="text-muted-foreground"> · minimum score {item.minScore}</span>
      {changeParts.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{changeParts.join(" · ")}</p>
      )}
    </div>
  );
}

// ─── Generic section rendering (added/removed/changed/unchanged) ────────────
function DiffGroup<T>({
  label,
  tone,
  entries,
  renderEntry,
}: {
  label: string;
  tone: "added" | "removed" | "changed";
  entries: DiffEntry<T>[];
  renderEntry: (entry: DiffEntry<T>) => ReactNode;
}) {
  const toneClass =
    tone === "added" ? "text-emerald-400" : tone === "removed" ? "text-red-400" : "text-amber-400";
  return (
    <div>
      <p className={cn("text-xs font-medium mb-1", toneClass)}>
        {label} ({entries.length})
      </p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.key} className="text-xs">
            {renderEntry(entry)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffSection<T>({
  title,
  diff,
  renderEntry,
}: {
  title: string;
  diff: SectionDiff<T>;
  renderEntry: (entry: DiffEntry<T>) => ReactNode;
}) {
  const nothingAtAll =
    diff.unchangedCount === 0 &&
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0;
  if (nothingAtAll) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      {!sectionHasDifferences(diff) ? (
        <p className="text-xs text-muted-foreground">
          No differences — {diff.unchangedCount} unchanged.
        </p>
      ) : (
        <div className="space-y-2.5">
          {diff.added.length > 0 && (
            <DiffGroup label="Added" tone="added" entries={diff.added} renderEntry={renderEntry} />
          )}
          {diff.removed.length > 0 && (
            <DiffGroup
              label="Removed"
              tone="removed"
              entries={diff.removed}
              renderEntry={renderEntry}
            />
          )}
          {diff.changed.length > 0 && (
            <DiffGroup
              label="Changed"
              tone="changed"
              entries={diff.changed}
              renderEntry={renderEntry}
            />
          )}
          {diff.unchangedCount > 0 && (
            <p className="text-[11px] text-muted-foreground">{diff.unchangedCount} unchanged</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page-level component ────────────────────────────────────────────────────
export function DraftVsActiveComparison({
  draftVersion,
  activeVersion,
}: {
  draftVersion: IcpProfileVersion;
  activeVersion: IcpProfileVersion | null;
}) {
  if (!activeVersion) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
            Draft vs. active version
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            There&apos;s no active published version yet, so there&apos;s nothing to
            compare this draft against.
          </p>
        </CardContent>
      </Card>
    );
  }

  const draftValidation = validateProfileConfigDraft(draftVersion.config);
  const activeValidation = validateProfileConfigDraft(activeVersion.config);

  if (!draftValidation.valid || !activeValidation.valid) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
            Draft vs. active version {activeVersion.versionNumber}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This comparison isn&apos;t available right now — one of the two
            versions&apos; stored configuration couldn&apos;t be read.
          </p>
        </CardContent>
      </Card>
    );
  }

  const diff = diffProfileConfigs(
    draftValidation.config,
    activeValidation.config,
    draftVersion.notes,
    activeVersion.notes,
  );

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Draft vs. active version {activeVersion.versionNumber}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {profileConfigDiffIsEmpty(diff) ? (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              This draft is identical to the active version (version{" "}
              {activeVersion.versionNumber}).
            </p>
          </div>
        ) : (
          <>
            <DiffSection title="Fit rules" diff={diff.fit.rules} renderEntry={(e) => <WeightedRuleEntryRow entry={e} />} />
            <DiffSection title="Fit bands" diff={diff.fit.tiers} renderEntry={(e) => <TierEntryRow entry={e} />} />
            <DiffSection
              title="Intent rules"
              diff={diff.intent.rules}
              renderEntry={(e) => <WeightedRuleEntryRow entry={e} />}
            />
            <DiffSection title="Intent bands" diff={diff.intent.tiers} renderEntry={(e) => <TierEntryRow entry={e} />} />
            <DiffSection
              title="Actionability rules"
              diff={diff.actionability.rules}
              renderEntry={(e) => <WeightedRuleEntryRow entry={e} />}
            />
            <DiffSection
              title="Hard disqualifiers"
              diff={diff.eligibility.hardDisqualifiers}
              renderEntry={(e) => <ConditionRuleEntryRow entry={e} />}
            />
            <DiffSection
              title="Restrictions"
              diff={diff.eligibility.restrictions}
              renderEntry={(e) => <ConditionRuleEntryRow entry={e} />}
            />
            {diff.notes.changed && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">Draft notes</h4>
                <p className="text-xs text-muted-foreground">
                  Draft: {diff.notes.draft && diff.notes.draft.trim() !== "" ? diff.notes.draft : "(none)"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Active: {diff.notes.active && diff.notes.active.trim() !== "" ? diff.notes.active : "(none)"}
                </p>
              </div>
            )}
          </>
        )}

        <TechnicalDetails summary="Technical details">
          <div className="space-y-2 font-mono text-[11px] text-muted-foreground/80">
            <p>
              <span className="text-muted-foreground/50">Draft version:</span> {draftVersion.id} ·{" "}
              {formatDateTime(draftVersion.createdAt)}
            </p>
            <p>
              <span className="text-muted-foreground/50">Active version:</span> {activeVersion.id} ·{" "}
              {formatDateTime(activeVersion.publishedAt)}
            </p>
            <div>
              <p className="text-muted-foreground/50 mb-1">Draft config (exact):</p>
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(draftVersion.config, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-muted-foreground/50 mb-1">Active config (exact):</p>
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(activeVersion.config, null, 2)}
              </pre>
            </div>
          </div>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}
