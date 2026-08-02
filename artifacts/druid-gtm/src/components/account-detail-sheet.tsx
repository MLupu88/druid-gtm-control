import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ActionModal } from "@/components/action-modal";
import { OutputTypeBadge } from "@/components/output-type-badge";
import {
  OUTPUT_TYPE_LABELS,
  IDENTITY_LABELS,
  SALES_REVIEW_REASON_LABELS,
  SCORE_COMPONENT_FIELDS,
  scoreComponentDisplay,
  riskScoreDisplay,
  mqlDisplay,
  matchedByDisplay,
  scoreTierLabel,
  firstValidNumber,
  isRowProcessed,
  DECISION_LABELS,
  humanizeToken,
} from "@workspace/gtm-shared";
import {
  type Row,
  type ButtonKey,
  rowOutputType,
  rowIdentityLabel,
  rowButtons,
  rowNeedsReview,
  isButtonDisabled,
  isButtonDisabledAccount,
  safeWhyNow,
  rowCostLabel,
  blockReasonText,
  statusLabelText,
} from "@/lib/queue-helpers";
import { cn } from "@/lib/utils";
import {
  BUTTONS,
  VOICE_UNAVAILABLE_REASON,
  UNAVAILABILITY_CATEGORY,
  PROSPECTING_NOT_APPLICABLE_REASON,
  IDENTIFIED_CONTACT_REQUIRED_REASON,
  NO_PROSPECT,
  unavailabilityCategory,
  identityBlocksProspecting,
} from "@workspace/gtm-shared";
import { fetchAccountDetail, accountDetailQueryKey } from "@/lib/accounts-api";
import { Building2, User, Phone, Mail, Globe, AlertTriangle, Info, ArrowRight } from "lucide-react";

// promote_mql/promote_mql_owner/dismiss — the three buttons that persist a
// real canonical account_decisions row (see ../components/action-modal.tsx)
// — require a resolved canonical account AND that account's latest
// completed, production evaluation. Every other button's availability is
// unaffected by this.
const CANONICAL_DECISION_BUTTON_KEYS: ReadonlySet<ButtonKey> = new Set([
  "promote_mql",
  "promote_mql_owner",
  "dismiss",
]);

// The subset of CANONICAL_DECISION_BUTTON_KEYS additionally gated on
// server-derived MQL decision-readiness (see getDisabled below). dismiss
// is deliberately excluded — non-MQL decisions remain unaffected by
// mqlDecisionReadiness.
const MQL_DECISION_BUTTON_KEYS: ReadonlySet<ButtonKey> = new Set([
  "promote_mql",
  "promote_mql_owner",
]);

// Activation-style buttons — split into an active section vs. an unavailable section
// below based on getDisabled(). approve_email/approve_linkedin are active once the
// engine is live and the row's gate passes (self-serve LinkedIn export / persisted email
// draft — no live email/LinkedIn tool required for that), OR whenever previewOnly is true
// (sample/demo rows can never reach a real POST — see ActionModal's previewOnly guard —
// so exploring the composer must not depend on a live ICP_Config fetch). approve_call
// (voice) is the only one still unconditionally unavailable in every mode — see
// VOICE_UNAVAILABLE_REASON in gtmContract.js.
const ACTIVATION_BUTTON_KEYS: ReadonlySet<ButtonKey> = new Set([
  "approve_call",
  "approve_email",
  "approve_linkedin",
]);

// Fallback copy only — getDisabled(btnKey).reason (rendered below) is preferred whenever
// it's available, since it reflects the real, current, per-row reason.
const ACTIVATION_UNAVAILABLE_COPY: Partial<Record<ButtonKey, string>> = {
  approve_email: "Not enabled right now for this account.",
  approve_linkedin: "Not enabled right now for this account.",
};

interface AccountDetailSheetProps {
  row: Row;
  source: string;
  config: Record<string, string>;
  open: boolean;
  onClose: () => void;
  onAction?: () => void;
  previewOnly?: boolean;
  // The canonical PostgreSQL account this queue row resolved to (by exact
  // account_key, then by normalized domain — never by company name), or
  // null when no canonical account could be matched. See
  // resolveCanonicalAccount in ../components/needs-attention-view.tsx.
  canonicalAccountId: string | null;
  // Fired the instant promote_mql/promote_mql_owner/dismiss actually
  // persists a canonical account_decisions row — see
  // ../components/action-modal.tsx's onDecisionPersisted. Distinct from
  // onAction (which already covers every button, including local no-ops
  // and pending n8n requests): this fires even when the action flow does
  // NOT close (e.g. promote_mql_owner's owner-notification step fails
  // after the decision itself already saved).
  onDecisionPersisted?: () => void;
}

export function AccountDetailSheet({
  row,
  source,
  config,
  open,
  onClose,
  onAction,
  previewOnly = false,
  canonicalAccountId,
  onDecisionPersisted,
}: AccountDetailSheetProps) {
  const [activeButton, setActiveButton] = useState<ButtonKey | null>(null);

  // Only fetched while this sheet is open AND the row resolved to a
  // canonical account — needed to find the account's latest completed,
  // production evaluation, which promote_mql/promote_mql_owner/dismiss
  // must reference (see CANONICAL_DECISION_BUTTON_KEYS/getDisabled below
  // and ../components/action-modal.tsx). Reuses the exact same fetch +
  // query key the account-detail page uses, so React Query dedupes rather
  // than issuing a parallel request when both have been visited.
  const canonicalDetailQ = useQuery({
    queryKey: accountDetailQueryKey(canonicalAccountId ?? ""),
    queryFn: () => fetchAccountDetail(canonicalAccountId as string),
    enabled: open && !!canonicalAccountId,
    staleTime: 30_000,
  });
  // account_evaluations rows arrive ordered createdAt desc, id desc (see
  // services/accounts.ts's getAccountById), so the first completed +
  // production match is genuinely the latest one. Kept as the full
  // evaluation (not just its id) so getDisabled can also read its
  // server-derived mqlDecisionReadiness below.
  const eligibleAccountEvaluation = useMemo(() => {
    const evaluations = canonicalDetailQ.data?.evaluations ?? [];
    return (
      evaluations.find(
        (e) => e.status === "completed" && e.evaluationMode === "production",
      ) ?? null
    );
  }, [canonicalDetailQ.data]);
  const eligibleAccountEvaluationId = eligibleAccountEvaluation?.id ?? null;

  const outputType = rowOutputType(row, source);
  const outputMeta = OUTPUT_TYPE_LABELS[outputType];
  const identityInfo = rowIdentityLabel(row, source);
  const whyNow = safeWhyNow(row);
  const cost = rowCostLabel(row);
  const buttons = rowButtons(row, source);
  const isAccountQueue = String(source).toLowerCase() === "account_queue";
  const isTestRow = String(row.test_mode).toLowerCase() === "true";
  // Once a decision/final status has actually been persisted, this row must not offer
  // decision buttons again — it must show what was recorded instead. Deliberately based
  // only on persisted evidence (operator_decision/final_status), never on engine/gate
  // state — a row the engine simply isn't asking about right now is not the same thing
  // as a row a human has actually decided on.
  const isProcessed = isRowProcessed(row);
  const processedDecisionLabel = row.final_status
    ? statusLabelText(row.final_status)
    : row.operator_decision
    ? DECISION_LABELS[row.operator_decision as keyof typeof DECISION_LABELS] ??
      humanizeToken(row.operator_decision)
    : "Decision recorded.";

  function getDisabled(btnKey: ButtonKey): { disabled: boolean; reason: string } {
    // Voice is currently locked on both queue paths until compliance approval and
    // provider setup are complete — same reason either way, regardless of config/preview
    // state (signal-queue's isButtonDisabled already returns this same reason via
    // buttonDisabled(), so this only changes the account-queue path).
    if (btnKey === "approve_call") {
      return { disabled: true, reason: VOICE_UNAVAILABLE_REASON };
    }

    // The existing per-queue guardrail — evaluated for every button,
    // including promote_mql/promote_mql_owner/dismiss, exactly as before
    // this slice. Nothing below ever bypasses it: a button the existing
    // rule already disables stays disabled, with its existing reason.
    let existing: { disabled: boolean; reason: string };
    if (isAccountQueue) {
      const d = isButtonDisabledAccount(btnKey, row, config, previewOnly);
      existing = d
        ? {
            disabled: true,
            reason: row.block_reason
              ? blockReasonText(row.block_reason)
              : "This action isn't available right now.",
          }
        : { disabled: false, reason: "" };
    } else {
      existing = isButtonDisabled(btnKey, row);
    }
    if (existing.disabled) return existing;

    // Only once the existing guardrail passes do promote_mql/
    // promote_mql_owner/dismiss additionally require a resolved canonical
    // account with a completed, production evaluation to reference — see
    // ../components/action-modal.tsx's createAccountDecision call.
    if (CANONICAL_DECISION_BUTTON_KEYS.has(btnKey)) {
      if (previewOnly) {
        return {
          disabled: true,
          reason: "Sample data — no decision will be recorded.",
        };
      }
      if (!canonicalAccountId) {
        return {
          disabled: true,
          reason:
            "This signal is not linked to a canonical account yet, so a decision cannot be recorded.",
        };
      }
      if (canonicalDetailQ.isLoading) {
        return {
          disabled: true,
          reason: "Checking this account's evaluation history…",
        };
      }
      if (canonicalDetailQ.isError) {
        return {
          disabled: true,
          reason:
            "Could not load this account's evaluation history, so a decision cannot be recorded right now.",
        };
      }
      if (!eligibleAccountEvaluationId) {
        return {
          disabled: true,
          reason:
            "This account has no completed production evaluation yet, so a decision cannot be recorded.",
        };
      }

      // promote_mql/promote_mql_owner ONLY: also require server-derived
      // MQL decision-readiness (see @/lib/accounts-api.ts's
      // MqlDecisionReadiness and
      // artifacts/api-server/src/services/mqlDecisionReadiness.ts, the
      // single source of truth this reads verbatim — never recomputed
      // here). dismiss is unaffected: it is in
      // CANONICAL_DECISION_BUTTON_KEYS but not MQL_DECISION_BUTTON_KEYS.
      if (
        MQL_DECISION_BUTTON_KEYS.has(btnKey) &&
        eligibleAccountEvaluation &&
        !eligibleAccountEvaluation.mqlDecisionReadiness.ready
      ) {
        const [firstReason] = eligibleAccountEvaluation.mqlDecisionReadiness.reasons;
        return {
          disabled: true,
          reason:
            firstReason?.message ??
            "This evaluation is not decision-ready for MQL, but no specific reason was provided.",
        };
      }
    }

    return existing;
  }

  // Never zero-fill a missing score: firstValidNumber picks the first VALID numeric
  // candidate (account_score, then total_score) — a real "0" counts as valid, and an
  // empty/invalid account_score correctly falls through to total_score.
  const totalScore = firstValidNumber(row.account_score, row.total_score);
  const risk = riskScoreDisplay(row);
  const mql = mqlDisplay(row);
  const matchInfo = matchedByDisplay(row);

  // Split out live-outreach actions that aren't available yet so they render
  // in a separate "Coming later" section instead of as disabled green buttons.
  const activeActionButtons = buttons.filter(
    (btnKey) => !ACTIVATION_BUTTON_KEYS.has(btnKey) || !getDisabled(btnKey).disabled,
  );
  const unavailableActivationButtons = buttons.filter(
    (btnKey) => ACTIVATION_BUTTON_KEYS.has(btnKey) && getDisabled(btnKey).disabled,
  );

  // Whether Email/LinkedIn are unavailable specifically because this row lacks an
  // identified contact (as opposed to the output type itself never offering them, e.g.
  // Suppressed/Pipeline Assist) — surfaced as its own explanation, never silently omitted.
  const identityBlocked = identityBlocksProspecting(row, outputType);

  // NO_PROSPECT outputs (Pipeline Assist/Owner Alert/Retarget/Suppressed) never include
  // approve_email/approve_linkedin in buttonsForOutput at all, so those buttons never
  // exist to be disabled in the first place — there is nothing to label "unavailable."
  // Shown as its own informational notice instead of a synthetic disabled button.
  const prospectingNotApplicable = NO_PROSPECT.has(outputType);

  // Group whatever activation buttons ARE disabled (today, in practice, only ever voice —
  // see prospectingNotApplicable above for why email/linkedin never reach this list) by
  // WHY they're unavailable, so no category is mislabeled as "coming later."
  const unavailableByCategory: Partial<Record<string, ButtonKey[]>> = {};
  for (const btnKey of unavailableActivationButtons) {
    const cat = unavailabilityCategory(btnKey, outputType);
    (unavailableByCategory[cat] ??= []).push(btnKey);
  }
  const unavailableSections = [
    {
      category: UNAVAILABILITY_CATEGORY.VOICE_NOT_ENABLED,
      heading: "Not available",
      keys: unavailableByCategory[UNAVAILABILITY_CATEGORY.VOICE_NOT_ENABLED] ?? [],
    },
    {
      category: UNAVAILABILITY_CATEGORY.TEMPORARY,
      heading: "Not enabled right now",
      keys: unavailableByCategory[UNAVAILABILITY_CATEGORY.TEMPORARY] ?? [],
    },
  ].filter((section) => section.keys.length > 0);

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg overflow-y-auto bg-background border-l border-border p-0"
        >
          <SheetHeader className="px-6 py-5 border-b border-border">
            <div className="flex items-start gap-3">
              <OutputTypeBadge outputType={outputType} showSub className="shrink-0 pt-0.5" />
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base font-semibold font-display text-left leading-tight">
                  {row.company_name || row.company_domain || "Unknown company"}
                </SheetTitle>
                {row.company_domain && row.company_name && (
                  <p className="text-xs text-muted-foreground mt-0.5">{row.company_domain}</p>
                )}
              </div>
              {(isTestRow || previewOnly) && (
                <Badge
                  variant="outline"
                  className="text-[10px] shrink-0 text-amber-400 border-amber-500/30 bg-amber-500/10"
                >
                  Sample data
                </Badge>
              )}
            </div>
          </SheetHeader>

          {/* Orientation */}
          <div className="px-6 py-2.5 border-b border-border bg-muted/10">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {previewOnly
                ? "This is sample data. You can preview the workflow, but no action will be sent."
                : "This page explains why the account received this recommendation and what would happen if you act."}
            </p>
          </div>

          {/* Canonical account link — honest either way: a real link when
              resolved, or a plain statement that no match was found. Never
              fabricates an ID. */}
          <div className="px-6 py-2.5 border-b border-border">
            {canonicalAccountId ? (
              <Link
                href={`/accounts/${canonicalAccountId}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                Open full account
                <ArrowRight className="w-3 h-3" />
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">
                This signal is not linked to a canonical account yet.
              </p>
            )}
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* About this account */}
            <Section title="About this account">
              <MetaRow icon={<Building2 className="w-3.5 h-3.5" />} label="Company">
                {row.company_name || row.company_domain || "—"}
              </MetaRow>
              {row.company_domain && (
                <MetaRow icon={<Globe className="w-3.5 h-3.5" />} label="Domain">
                  {row.company_domain}
                </MetaRow>
              )}
              {(row.country || row.region) && (
                <MetaRow icon={null} label="Region">
                  {row.country || row.region}
                </MetaRow>
              )}
              {identityInfo && (
                <div className="mt-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
                  <p className="text-xs font-semibold text-foreground mb-0.5">
                    {identityInfo.label}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {identityInfo.detail}
                  </p>
                  {matchInfo.available && (
                    <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
                      {matchInfo.label}
                    </p>
                  )}
                </div>
              )}
            </Section>

            {/* Why we're recommending this */}
            <Section title="Why we're recommending this">
              <p className="text-sm text-foreground leading-relaxed">{whyNow || "—"}</p>
              {outputType === "Sales Review" && row.sales_review_reason && (
                <div className="mt-2 px-3 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-300 leading-relaxed">
                    {SALES_REVIEW_REASON_LABELS[
                      row.sales_review_reason as keyof typeof SALES_REVIEW_REASON_LABELS
                    ] ?? row.sales_review_reason}
                  </p>
                </div>
              )}
              {outputMeta?.detail && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {outputMeta.detail}
                </p>
              )}
            </Section>

            {/* Score (account queue only) — each dimension shows its own truthful state;
                nothing here is ever calculated or invented on the frontend. */}
            {isAccountQueue && (
              <Section title="How this account scores">
                <div className="space-y-3">
                  {SCORE_COMPONENT_FIELDS.map(({ key }) => {
                    const comp = scoreComponentDisplay(row, key);
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-muted-foreground">{comp.label}</span>
                          <span className="text-xs font-semibold tabular-nums text-foreground">
                            {comp.available ? (
                              comp.value
                            ) : (
                              <span className="font-normal text-muted-foreground/60">
                                Not available
                              </span>
                            )}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/70 leading-snug">
                          {comp.question}
                        </p>
                      </div>
                    );
                  })}

                  {/* Risk uses the same scoring pipeline, but the engine writes sentinel
                      values (e.g. 999/1998) when risk was never actually calculated — those
                      must never render as a real score. */}
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-muted-foreground">Risk</span>
                      <span className="text-xs font-semibold tabular-nums text-foreground">
                        {risk.available ? risk.value : <span className="font-normal text-muted-foreground/60">—</span>}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 leading-snug">
                      {risk.label}
                    </p>
                  </div>

                  <Separator className="my-1" />

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Total score</span>
                    <span className="text-xs font-semibold text-foreground">
                      {totalScore !== null ? totalScore : "Not available"}
                      {row.score_tier && (
                        <span className="text-muted-foreground font-normal ml-1.5">
                          — {scoreTierLabel(row.score_tier)}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* MQL qualification is a separate fact from the total score — a high
                      total score never implies MQL by itself. */}
                  <div className="flex items-start justify-between pt-1">
                    <span className="text-xs text-muted-foreground shrink-0">MQL qualification</span>
                    <span
                      className={cn(
                        "text-xs font-semibold text-right max-w-[65%]",
                        mql.known && mql.isMql
                          ? "text-primary"
                          : mql.known
                          ? "text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {mql.label}
                    </span>
                  </div>
                  {mql.reason && (
                    <p className="text-[11px] text-muted-foreground/70 leading-snug">
                      {mql.reason}
                    </p>
                  )}
                </div>
              </Section>
            )}

            {/* Score (signal queue only) */}
            {!isAccountQueue && totalScore !== null && (
              <Section title="Score">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {totalScore}
                  </span>
                  {row.score_tier && (
                    <span className="text-xs text-muted-foreground">
                      {scoreTierLabel(row.score_tier)}
                    </span>
                  )}
                </div>
              </Section>
            )}

            {/* People / contact */}
            {(row.contact_name || row.contact_email || row.contact_phone ||
              row.best_contact_name || row.best_contact_email) && (
              <Section title="People">
                <div className="space-y-2">
                  <ContactCard
                    name={row.contact_name || row.best_contact_name}
                    email={row.contact_email || row.best_contact_email}
                    phone={row.contact_phone}
                    isPrimary
                    identityKey={
                      isAccountQueue
                        ? row.identity_resolution
                        : row.resolution_level === "person"
                        ? "identified_contact"
                        : undefined
                    }
                  />
                </div>
              </Section>
            )}

            {/* What this would cost */}
            <Section title="What this would cost">
              <div className="px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
                <p className="text-sm font-medium text-foreground">{cost.label}</p>
                {cost.detail && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {cost.detail}
                  </p>
                )}
              </div>
            </Section>

            {/* Block reason (if blocked) */}
            {row.block_reason && (
              <div className="flex items-start gap-2 px-3 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-300 mb-0.5">Why this is blocked</p>
                  <p className="text-xs text-red-300/80 leading-relaxed">
                    {blockReasonText(row.block_reason)}
                  </p>
                </div>
              </div>
            )}

            {/* Call result (if call happened) */}
            {row.final_status === "called" && row.reason && (
              <Section title="What happened on the call">
                <p className="text-sm text-foreground leading-relaxed">{row.reason}</p>
              </Section>
            )}

            {/* Decision already recorded — shown instead of action buttons so a
                processed row can never be decided twice. */}
            {isProcessed && (
              <Section title="Decision recorded">
                <div className="px-3 py-2.5 rounded-lg bg-muted/30 border border-border space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {processedDecisionLabel}
                  </p>
                  {row.reason && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {row.reason}
                    </p>
                  )}
                  {(row.approved_by || row.approved_at) && (
                    <p className="text-[11px] text-muted-foreground/70">
                      {[
                        row.approved_by && `By ${row.approved_by}`,
                        row.approved_at,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </Section>
            )}

            {/* Take action — only when the row still genuinely needs a human decision
                AND no decision has already been persisted for it. */}
            {rowNeedsReview(row, source) && !isProcessed && buttons.length > 0 && (
              <Section title="Take action">
                {identityBlocked && (
                  <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300 leading-relaxed">
                      <span className="font-medium">Email and LinkedIn outreach:</span>{" "}
                      {IDENTIFIED_CONTACT_REQUIRED_REASON}
                    </p>
                  </div>
                )}

                {prospectingNotApplicable && (
                  <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
                    <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground/80">Email and LinkedIn outreach:</span>{" "}
                      {PROSPECTING_NOT_APPLICABLE_REASON}
                    </p>
                  </div>
                )}

                {activeActionButtons.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {activeActionButtons.map((btnKey) => {
                      const btn = BUTTONS[btnKey];
                      if (!btn) return null;
                      const { disabled, reason } = getDisabled(btnKey);

                      if (btn.kind === "ui" && btnKey === "view_reason") {
                        return null; // already shown via block_reason section above
                      }

                      return (
                        <div key={btnKey}>
                          <Button
                            variant={
                              btnKey.startsWith("approve") ? "default" : "outline"
                            }
                            disabled={disabled}
                            onClick={() => !disabled && setActiveButton(btnKey)}
                            className={cn(
                              "w-full h-10 text-sm font-medium justify-start",
                              !disabled &&
                                btnKey.startsWith("approve") &&
                                "bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20",
                            )}
                          >
                            {btn.label}
                          </Button>
                          {disabled && reason && (
                            <p className="text-[11px] text-muted-foreground mt-1 px-1 leading-snug">
                              {reason}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {unavailableSections.map((section, i) => (
                  <div
                    key={section.category}
                    className={cn(
                      (activeActionButtons.length > 0 || i > 0) && "mt-4 pt-4 border-t border-border/60",
                    )}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      {section.heading}
                    </p>
                    <div className="flex flex-col gap-2">
                      {section.keys.map((btnKey) => {
                        const btn = BUTTONS[btnKey];
                        if (!btn) return null;
                        // Voice's reason comes from its category directly, not the
                        // per-row getDisabled() text. Every other reason uses the real
                        // per-row explanation (e.g. "Engine is paused"), since that
                        // reflects current, changeable state.
                        const reason =
                          section.category === UNAVAILABILITY_CATEGORY.VOICE_NOT_ENABLED
                            ? VOICE_UNAVAILABLE_REASON
                            : getDisabled(btnKey).reason || ACTIVATION_UNAVAILABLE_COPY[btnKey];
                        return (
                          <div key={btnKey}>
                            <Button
                              variant="ghost"
                              disabled
                              className="w-full h-10 text-sm font-medium justify-start text-muted-foreground"
                            >
                              {btn.label}
                            </Button>
                            <p className="text-[11px] text-muted-foreground mt-1 px-1 leading-snug">
                              {reason}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </Section>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Action confirmation modal */}
      {activeButton && (
        <ActionModal
          open={!!activeButton}
          onClose={() => setActiveButton(null)}
          buttonKey={activeButton}
          row={row}
          previewOnly={previewOnly}
          accountEvaluationId={eligibleAccountEvaluationId}
          onDecisionPersisted={onDecisionPersisted}
          onSuccess={() => {
            setActiveButton(null);
            onAction?.();
          }}
        />
      )}
    </>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

// ─── Meta row ─────────────────────────────────────────────────────────────────
function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="text-xs font-medium text-foreground text-right max-w-[60%]">
        {children}
      </span>
    </div>
  );
}

// ─── Contact card ─────────────────────────────────────────────────────────────
function ContactCard({
  name,
  email,
  phone,
  isPrimary,
  identityKey,
}: {
  name?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  identityKey?: string;
}) {
  const identityMeta =
    identityKey
      ? IDENTITY_LABELS[identityKey as keyof typeof IDENTITY_LABELS]
      : null;

  if (!name && !email) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1">
      {isPrimary && (
        <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">
          Recommended contact
        </p>
      )}
      {name && (
        <div className="flex items-center gap-1.5">
          <User className="w-3 h-3 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{name}</span>
        </div>
      )}
      {email && (
        <div className="flex items-center gap-1.5">
          <Mail className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{email}</span>
        </div>
      )}
      {phone && (
        <div className="flex items-center gap-1.5">
          <Phone className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{phone}</span>
        </div>
      )}
      {identityMeta && (
        <p className="text-[11px] text-muted-foreground/80 pt-0.5 leading-relaxed">
          {identityMeta.label} — {identityMeta.detail}
        </p>
      )}
    </div>
  );
}
