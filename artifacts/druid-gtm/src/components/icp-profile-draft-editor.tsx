import { useState, useMemo, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  updateIcpProfileDraft,
  icpProfileDetailQueryKey,
  IcpProfilesApiError,
  type IcpProfile,
  type IcpProfileVersion,
} from "@/lib/icp-profiles-api";
import {
  fieldAllowlistFor,
  validateProfileConfigDraft,
  issuesForPath,
} from "@/lib/icp-profile-config-validation";
import {
  buildStarterProfileConfig,
  newWeightedRule,
  duplicateWeightedRule,
  newConditionRule,
  duplicateConditionRule,
} from "@/lib/icp-profile-config-editing";
import { RuleListSection, WeightedRuleRow, ConditionRuleRow } from "@/components/icp-rule-list-section";
import { TierEditor } from "@/components/icp-tier-editor";
import { IcpProfileSummaryCard } from "@/components/icp-profile-summary-card";
import { PublishDraftAction } from "@/components/icp-profile-lifecycle-actions";
import type { IcpProfileConfigV1, WeightedRule, ConditionRule } from "@workspace/evaluator";
import { MAX_RULES_PER_DIMENSION, isSimpleFitRule, isSimpleIntentRule } from "@workspace/evaluator";
import {
  sumRulePoints,
  describeWeightedRuleSentence,
  describeEligibilityRuleSentence,
} from "@/lib/icp-profile-business-summary";
import {
  BusinessRuleListSection,
  AdvancedCriteriaList,
} from "@/components/icp-business-rule-list-section";
import { FitBusinessRuleRow, IntentBusinessRuleRow } from "@/components/icp-business-rule-rows";
import {
  newSimpleFitRule,
  newSimpleIntentRule,
  duplicateSimpleRule,
} from "@/lib/icp-business-rule-editing";

// The complete Draft editor for an ICP profile. Always holds and submits
// the FULL IcpProfileConfigV1 object (updateDraft is a full-replacement
// operation — see ../lib/icp-profiles-api.ts's module comment) plus
// notes. Name/description are read-only here: the backend's
// UpdateDraftRequestSchema has no field for either (see the same module
// comment) — this is a real, current backend limitation, not an
// oversight this component works around.

export type SaveStatus = "unchanged" | "unsaved" | "saving" | "saved" | "error";

function configsEqual(a: IcpProfileConfigV1, b: IcpProfileConfigV1): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface IcpProfileDraftEditorProps {
  profile: IcpProfile;
  draftVersion: IcpProfileVersion;
  /** Lets the parent page (icp-profile-detail.tsx) guard its own "Back" link against losing unsaved edits. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function IcpProfileDraftEditor({
  profile,
  draftVersion,
  onDirtyChange,
}: IcpProfileDraftEditorProps) {
  const queryClient = useQueryClient();

  // The draft's stored config was already validated server-side when it
  // was created/last saved, so it should always parse — the starter-
  // config fallback only guards the theoretically-impossible case of a
  // malformed stored value, so the editor always has something to render.
  const initialConfig = useMemo<IcpProfileConfigV1>(() => {
    const result = validateProfileConfigDraft(draftVersion.config);
    return result.valid ? result.config : buildStarterProfileConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftVersion.id]);

  const [config, setConfig] = useState<IcpProfileConfigV1>(initialConfig);
  const [notes, setNotes] = useState<string>(draftVersion.notes ?? "");
  const [lastSaved, setLastSaved] = useState<{ config: IcpProfileConfigV1; notes: string }>({
    config: initialConfig,
    notes: draftVersion.notes ?? "",
  });
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = !configsEqual(config, lastSaved.config) || notes !== lastSaved.notes;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Covers tab close / refresh / typed-URL navigation. In-app navigation
  // via wouter's Link (the sidebar, SettingsNav, "Back to ICP profiles")
  // does NOT trigger beforeunload — wouter has no navigation-blocking
  // hook to intercept that today, so only the detail page's own "Back to
  // ICP profiles" link (which reads onDirtyChange above) is guarded
  // in-app. See the draft-editor's Slice 3 report note.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  // The single source of truth for "is this draft valid" — every section
  // below reads a FILTERED VIEW of this same result via issuesForPath,
  // never a section-local reimplementation.
  const validation = useMemo(() => validateProfileConfigDraft(config), [config]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateIcpProfileDraft(profile.id, {
        config,
        notes: notes.trim() === "" ? null : notes,
      }),
    onSuccess: () => {
      setLastSaved({ config, notes });
      setSavedAt(new Date());
      void queryClient.invalidateQueries({ queryKey: icpProfileDetailQueryKey(profile.id) });
    },
  });

  const saveStatus: SaveStatus = saveMutation.isPending
    ? "saving"
    : saveMutation.isError
      ? "error"
      : dirty
        ? "unsaved"
        : savedAt !== null
          ? "saved"
          : "unchanged";

  const canSave = dirty && !saveMutation.isPending && validation.valid;

  // Publish never auto-saves first — it is disabled outright (never
  // silently saves-then-publishes) whenever there's something that would
  // make publishing act on stale or invalid data.
  const publishDisabledReason = !validation.valid
    ? "Fix the issues listed below before publishing."
    : dirty
      ? "Save your changes before publishing."
      : saveMutation.isPending
        ? "Save in progress — please wait."
        : null;

  const fitAllowlist = fieldAllowlistFor("fit");
  const intentAllowlist = fieldAllowlistFor("intent");
  const actionabilityAllowlist = fieldAllowlistFor("actionability");
  const eligibilityAllowlist = fieldAllowlistFor("eligibility");

  const issues = validation.valid ? [] : validation.issues;

  const fitTotalPoints = sumRulePoints(config.fit.rules);
  const intentTotalPoints = sumRulePoints(config.intent.rules);
  const actionabilityTotalPoints = sumRulePoints(config.actionability.rules);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-sm font-semibold text-foreground">
            Draft — Version {draftVersion.versionNumber}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Changes here are saved as this draft. Publish when it&apos;s ready to
            create an immutable version, then activate that version to put it
            into use for new evaluations.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3 shrink-0">
          <SaveControls status={saveStatus} savedAt={savedAt} onSave={() => saveMutation.mutate()} canSave={canSave} />
          <PublishDraftAction
            profileId={profile.id}
            disabled={publishDisabledReason !== null}
            disabledReason={publishDisabledReason}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {saveStatus === "error" && (
          <SaveErrorAlert error={saveMutation.error} />
        )}

        {!validation.valid && (
          <ErrorSummary issues={issues} />
        )}

        <IcpProfileSummaryCard config={config} />

        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/20 rounded-md px-2.5 py-2">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          <p>
            Some account data — industry, company size, revenue, region, CRM
            details, engagement history, and contact information — may not be
            available for every account yet. Rules that use these fields can
            still be authored; evaluations will show them as missing inputs
            until that data is available. You can still author these rules now.
          </p>
        </div>

        {/* Profile information */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
            Profile information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <p className="text-sm text-foreground rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                {profile.name}
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                Name can only be set when a profile is created — editing it isn&apos;t
                supported yet.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <p className="text-sm text-foreground rounded-md border border-border/60 bg-muted/20 px-3 py-2 min-h-[2.5rem]">
                {profile.description ?? (
                  <span className="text-muted-foreground">No description</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                Description can only be set when a profile is created — editing
                it isn&apos;t supported yet.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-notes" className="text-xs text-muted-foreground">
              Draft notes
            </Label>
            <Textarea
              id="draft-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about what changed in this draft"
              className="resize-none h-16 text-sm bg-input border-border focus-visible:ring-primary"
            />
          </div>
        </section>

        <Accordion type="multiple" defaultValue={["target-company", "buying-signals"]}>
          {/* Target company — business editing for simple fit rules; anything advanced (compound conditions, custom points) shows as a read-only Advanced criterion here, editable only in Technical configuration below. */}
          <AccordionItem value="target-company">
            <AccordionTrigger className="text-sm font-semibold py-2">Target company</AccordionTrigger>
            <AccordionContent className="pt-1">
              <BusinessRuleListSection<WeightedRule>
                title="Target company criteria"
                description="Plain-language criteria that describe a good-fit company."
                allRules={config.fit.rules}
                isSimple={isSimpleFitRule}
                onChange={(rules) => setConfig({ ...config, fit: { ...config.fit, rules } })}
                onCreateSimple={newSimpleFitRule}
                duplicateRule={duplicateSimpleRule}
                maxRules={MAX_RULES_PER_DIMENSION}
                emptyMessage="No target company criteria configured yet."
                describeAdvanced={(rule) => describeWeightedRuleSentence("fit", rule)}
                renderSimpleRow={(rule, actions) => (
                  <FitBusinessRuleRow key={rule.id} rule={rule} actions={actions} />
                )}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Buying signals — business editing for the specific supported intent shapes; engagement.lastSeenAt and any compound/custom-point rule stay Technical-only. */}
          <AccordionItem value="buying-signals">
            <AccordionTrigger className="text-sm font-semibold py-2">Buying signals</AccordionTrigger>
            <AccordionContent className="pt-1">
              <BusinessRuleListSection<WeightedRule>
                title="Buying-intent signals"
                description="Plain-language engagement signals that suggest active buying interest."
                allRules={config.intent.rules}
                isSimple={isSimpleIntentRule}
                onChange={(rules) => setConfig({ ...config, intent: { ...config.intent, rules } })}
                onCreateSimple={newSimpleIntentRule}
                duplicateRule={duplicateSimpleRule}
                maxRules={MAX_RULES_PER_DIMENSION}
                emptyMessage='No buying-intent signals configured yet — every account will show "Intent not configured" rather than a real evaluated signal.'
                describeAdvanced={(rule) => describeWeightedRuleSentence("intent", rule)}
                renderSimpleRow={(rule, actions) => (
                  <IntentBusinessRuleRow key={rule.id} rule={rule} actions={actions} />
                )}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Qualification and outreach policy — collapsed by default. Actionability and eligibility have no supported business-simple shape yet (see @workspace/evaluator's isSimpleActionabilityRule/isSimpleEligibilityRule), so every configured rule here is shown as a read-only Advanced criterion; editing happens only in Technical configuration below. */}
          <AccordionItem value="qualification-outreach">
            <AccordionTrigger className="text-sm font-semibold py-2">
              Qualification and outreach policy
            </AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Ability to act</h4>
                <p className="text-xs text-muted-foreground">
                  Whether there&apos;s enough contact or CRM information to actually follow up.
                </p>
                {config.actionability.rules.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No actionability criteria configured yet.
                  </p>
                ) : (
                  <AdvancedCriteriaList
                    rules={config.actionability.rules}
                    describeRule={(rule) => describeWeightedRuleSentence("actionability", rule)}
                    note="edit these in Technical configuration below"
                  />
                )}
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Outreach eligibility</h4>
                <p className="text-xs text-muted-foreground">
                  What disqualifies an account outright, or restricts outreach to it.
                </p>
                {config.eligibility.hardDisqualifiers.length === 0 &&
                config.eligibility.restrictions.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No hard disqualifiers or restrictions configured yet.
                  </p>
                ) : (
                  <>
                    {config.eligibility.hardDisqualifiers.length > 0 && (
                      <AdvancedCriteriaList
                        rules={config.eligibility.hardDisqualifiers}
                        describeRule={(rule) => describeEligibilityRuleSentence("hardDisqualifier", rule)}
                        note="edit these in Technical configuration below"
                      />
                    )}
                    {config.eligibility.restrictions.length > 0 && (
                      <AdvancedCriteriaList
                        rules={config.eligibility.restrictions}
                        describeRule={(rule) => describeEligibilityRuleSentence("restriction", rule)}
                        note="edit these in Technical configuration below"
                      />
                    )}
                  </>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Technical configuration — collapsed by default. Full rule/tier authoring, unchanged from the pre-business-first editor: every dimension, every rule (simple and advanced alike), points, tiers, and the raw condition-tree editor. Both this and the business sections above operate on the exact same `config` state, so an edit made here is immediately reflected in the business sections' classification above. */}
          <AccordionItem value="technical-configuration">
            <AccordionTrigger className="text-sm font-semibold py-2">
              Technical configuration
            </AccordionTrigger>
            <AccordionContent className="pt-1">
              <Accordion type="multiple" defaultValue={["fit", "intent", "actionability", "eligibility"]}>
          {/* Company fit */}
          <AccordionItem value="fit">
            <AccordionTrigger className="text-sm font-semibold py-2">Company fit</AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <RuleListSection<WeightedRule>
                title="Fit rules"
                description="Weighted points awarded when an account matches these criteria."
                rules={config.fit.rules}
                onChange={(rules) => setConfig({ ...config, fit: { ...config.fit, rules } })}
                onCreate={() => newWeightedRule(fitAllowlist)}
                onDuplicateItem={duplicateWeightedRule}
                maxRules={MAX_RULES_PER_DIMENSION}
                issuesByIndex={(index) => issuesForPath(issues, ["fit", "rules", index])}
                renderRow={(rule, _index, actions) => (
                  <WeightedRuleRow
                    key={rule.id}
                    rule={rule}
                    allowlist={fitAllowlist}
                    dimension="fit"
                    totalPoints={fitTotalPoints}
                    actions={actions}
                  />
                )}
              />
              <TierEditor
                title="Fit bands"
                description="Score thresholds that turn a fit score into a plain-language band."
                tiers={config.fit.tiers}
                onChange={(tiers) => setConfig({ ...config, fit: { ...config.fit, tiers } })}
                issues={issuesForPath(issues, ["fit", "tiers"])}
                configuredMaximumPoints={fitTotalPoints}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Buying intent */}
          <AccordionItem value="intent">
            <AccordionTrigger className="text-sm font-semibold py-2">Buying intent</AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <RuleListSection<WeightedRule>
                title="Intent rules"
                description="Weighted points awarded for recent engagement suggesting active buying interest."
                rules={config.intent.rules}
                onChange={(rules) => setConfig({ ...config, intent: { ...config.intent, rules } })}
                onCreate={() => newWeightedRule(intentAllowlist)}
                onDuplicateItem={duplicateWeightedRule}
                maxRules={MAX_RULES_PER_DIMENSION}
                issuesByIndex={(index) => issuesForPath(issues, ["intent", "rules", index])}
                renderRow={(rule, _index, actions) => (
                  <WeightedRuleRow
                    key={rule.id}
                    rule={rule}
                    allowlist={intentAllowlist}
                    dimension="intent"
                    totalPoints={intentTotalPoints}
                    actions={actions}
                  />
                )}
              />
              <TierEditor
                title="Intent bands"
                description="Score thresholds that turn an intent score into a plain-language band."
                tiers={config.intent.tiers}
                onChange={(tiers) => setConfig({ ...config, intent: { ...config.intent, tiers } })}
                issues={issuesForPath(issues, ["intent", "tiers"])}
                configuredMaximumPoints={intentTotalPoints}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Ability to act */}
          <AccordionItem value="actionability">
            <AccordionTrigger className="text-sm font-semibold py-2">Ability to act</AccordionTrigger>
            <AccordionContent className="pt-1">
              <RuleListSection<WeightedRule>
                title="Actionability rules"
                description="Weighted points awarded for having enough contact or CRM information to actually follow up. There are no bands for this dimension."
                rules={config.actionability.rules}
                onChange={(rules) =>
                  setConfig({ ...config, actionability: { ...config.actionability, rules } })
                }
                onCreate={() => newWeightedRule(actionabilityAllowlist)}
                onDuplicateItem={duplicateWeightedRule}
                maxRules={MAX_RULES_PER_DIMENSION}
                issuesByIndex={(index) =>
                  issuesForPath(issues, ["actionability", "rules", index])
                }
                renderRow={(rule, _index, actions) => (
                  <WeightedRuleRow
                    key={rule.id}
                    rule={rule}
                    allowlist={actionabilityAllowlist}
                    dimension="actionability"
                    totalPoints={actionabilityTotalPoints}
                    actions={actions}
                  />
                )}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Outreach eligibility */}
          <AccordionItem value="eligibility">
            <AccordionTrigger className="text-sm font-semibold py-2">
              Outreach eligibility
            </AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <RuleListSection<ConditionRule>
                title="Hard disqualifiers"
                description="An account matching any of these is disqualified outright, regardless of score. There are no points here — these bypass scoring entirely."
                rules={config.eligibility.hardDisqualifiers}
                onChange={(hardDisqualifiers) =>
                  setConfig({
                    ...config,
                    eligibility: { ...config.eligibility, hardDisqualifiers },
                  })
                }
                onCreate={() => newConditionRule(eligibilityAllowlist, "hard_disqualifier")}
                onDuplicateItem={(rule) => duplicateConditionRule(rule, "hard_disqualifier")}
                maxRules={MAX_RULES_PER_DIMENSION}
                issuesByIndex={(index) =>
                  issuesForPath(issues, ["eligibility", "hardDisqualifiers", index])
                }
                renderRow={(rule, _index, actions) => (
                  <ConditionRuleRow
                    key={rule.id}
                    rule={rule}
                    allowlist={eligibilityAllowlist}
                    kind="hardDisqualifier"
                    actions={actions}
                  />
                )}
              />
              <RuleListSection<ConditionRule>
                title="Restrictions"
                description="An account matching any of these is limited (e.g. specific channels blocked) rather than fully disqualified. No points here either."
                rules={config.eligibility.restrictions}
                onChange={(restrictions) =>
                  setConfig({
                    ...config,
                    eligibility: { ...config.eligibility, restrictions },
                  })
                }
                onCreate={() => newConditionRule(eligibilityAllowlist, "restriction")}
                onDuplicateItem={(rule) => duplicateConditionRule(rule, "restriction")}
                maxRules={MAX_RULES_PER_DIMENSION}
                issuesByIndex={(index) =>
                  issuesForPath(issues, ["eligibility", "restrictions", index])
                }
                renderRow={(rule, _index, actions) => (
                  <ConditionRuleRow
                    key={rule.id}
                    rule={rule}
                    allowlist={eligibilityAllowlist}
                    kind="restriction"
                    actions={actions}
                  />
                )}
              />
              {issuesForPath(issues, ["eligibility", "hardDisqualifiers"]).some(
                (i) => i.path.length === 2,
              ) && (
                <p className="text-[11px] text-red-400">
                  {
                    issuesForPath(issues, ["eligibility", "hardDisqualifiers"]).find(
                      (i) => i.path.length === 2,
                    )?.message
                  }
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

// ─── Save controls ────────────────────────────────────────────────────────────
function SaveControls({
  status,
  savedAt,
  onSave,
  canSave,
}: {
  status: SaveStatus;
  savedAt: Date | null;
  onSave: () => void;
  canSave: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={!canSave}
        className="bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20 disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : "Save draft"}
      </Button>
      <SaveStatusLabel status={status} savedAt={savedAt} />
    </div>
  );
}

function SaveStatusLabel({ status, savedAt }: { status: SaveStatus; savedAt: Date | null }) {
  switch (status) {
    case "saving":
      return (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Saving…
        </div>
      );
    case "saved":
      return (
        <div className="flex items-center gap-1 text-[11px] text-primary">
          <CheckCircle2 className="w-3 h-3" />
          Saved{savedAt ? ` at ${savedAt.toLocaleTimeString()}` : ""}
        </div>
      );
    case "unsaved":
      return <p className="text-[11px] text-amber-400">Unsaved changes</p>;
    case "error":
      return (
        <div className="flex items-center gap-1 text-[11px] text-red-400">
          <AlertCircle className="w-3 h-3" />
          Save failed
        </div>
      );
    case "unchanged":
    default:
      // No separate text label — the Save button is already disabled for
      // this exact state, so a redundant unchanged-state caption next
      // to it would just repeat the same fact twice. The disabled button
      // IS the clean/unchanged indicator.
      return null;
  }
}

function SaveErrorAlert({ error }: { error: unknown }) {
  const message =
    error instanceof IcpProfilesApiError
      ? error.code === "invalid_profile_config"
        ? "The server rejected this draft as invalid. Review the error summary below and try again."
        : error.code === "no_draft_version"
          ? "This profile no longer has an editable draft — it may have just been published. Refresh the page."
          : error.code === "profile_not_found"
            ? "This profile could no longer be found. Refresh the page."
            : error.message
      : error instanceof Error
        ? "Could not reach the server to save this draft. Try again."
        : "Could not save this draft.";
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Save failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ErrorSummary({
  issues,
}: {
  issues: { location: string; message: string }[];
}) {
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>
        This draft has {issues.length} issue{issues.length === 1 ? "" : "s"} to fix before it
        can be saved
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1.5 space-y-1">
          {issues.map((issue, i) => (
            <li key={i} className="text-xs">
              <span className="font-medium">{issue.location}:</span> {issue.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
