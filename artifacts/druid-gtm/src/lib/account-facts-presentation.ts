// Pure, DOM-free logic extracted from ../components/account-facts-panel.tsx
// — this package has no jsdom/testing-library, so component rendering
// itself is untestable here (see ./account-facts-presentation.test.ts's
// own module comment for what that leaves as browser-only). Every
// decision the panel makes that ISN'T "how does this look on screen" —
// which value/attribution text to show, what a confirm-vs-correct submit
// actually sends, how a 409 is distinguished from any other error — lives
// here instead, as plain functions the panel calls, so it can be
// unit-tested without a DOM. Mirrors the existing split between
// ../components/decision-controls.tsx and ./account-decisions-presentation.ts.

import { humanizeFieldLabel } from "@/lib/icp-profile-config-validation";
import {
  AccountFactsApiError,
  type AccountFact,
  type AccountFactField,
  type RecordAccountFactArgs,
} from "@/lib/account-facts-api";

const REGION_LABELS: Record<string, string> = {
  us: "US",
  emea: "EMEA",
  other: "Other",
};

export function formatFactDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function displayFactValue(field: AccountFactField, value: string): string {
  return field === "company.region" ? (REGION_LABELS[value] ?? value) : value;
}

export function currentForField(
  current: AccountFact[],
  field: AccountFactField,
): AccountFact | null {
  return current.find((f) => f.field === field) ?? null;
}

export function historyForField(
  history: AccountFact[],
  field: AccountFactField,
): AccountFact[] {
  return history.filter((f) => f.field === field);
}

// ---------------------------------------------------------------------
// Row view model — exactly the strings/flags the panel renders for one
// field, given its current fact (or none). Confirmed vs. unconfirmed is
// the one branch: an absent fact always renders "Not yet confirmed" and
// offers "Confirm"; a present fact always renders its value + attribution
// and offers "Correct" — no other combination exists.
// ---------------------------------------------------------------------

export interface FactRowViewModel {
  field: AccountFactField;
  label: string;
  confirmed: boolean;
  statusText: string | null; // "Not yet confirmed" when !confirmed, else null
  valueText: string | null; // displayFactValue(...) when confirmed, else null
  attributionText: string | null; // "Manually confirmed by X · date" when confirmed, else null
  actionLabel: "Confirm" | "Correct";
}

export function buildFactRowViewModel(
  field: AccountFactField,
  current: AccountFact | null,
): FactRowViewModel {
  const label = humanizeFieldLabel(field);
  if (!current) {
    return {
      field,
      label,
      confirmed: false,
      statusText: "Not yet confirmed",
      valueText: null,
      attributionText: null,
      actionLabel: "Confirm",
    };
  }
  return {
    field,
    label,
    confirmed: true,
    statusText: null,
    valueText: displayFactValue(field, current.value),
    attributionText: `Manually confirmed by ${current.recordedBy} · ${formatFactDateTime(current.observedAt)}`,
    actionLabel: "Correct",
  };
}

// ---------------------------------------------------------------------
// Submission — the exact compare-and-swap args a Confirm/Correct submit
// sends. A blank value is always rejected. A correction (currentFactId
// !== null) additionally requires a non-blank correction reason; a
// first-time confirmation (currentFactId === null) never accepts one —
// mirrored by, not merely trusting, the backend's own iff-and-only-if
// validation (see artifacts/api-server/src/services/accountFacts.ts).
// ---------------------------------------------------------------------

export type BuildRecordAccountFactArgsError =
  | "value_required"
  | "correction_reason_required";

export type BuildRecordAccountFactArgsResult =
  | { ok: true; args: RecordAccountFactArgs }
  | { ok: false; error: BuildRecordAccountFactArgsError };

export function buildRecordAccountFactArgs(params: {
  accountId: string;
  field: AccountFactField;
  currentFactId: string | null;
  draftValue: string;
  draftCorrectionReason: string;
}): BuildRecordAccountFactArgsResult {
  const trimmedValue = params.draftValue.trim();
  if (!trimmedValue) {
    return { ok: false, error: "value_required" };
  }

  const isCorrection = params.currentFactId !== null;
  const trimmedReason = params.draftCorrectionReason.trim();
  if (isCorrection && !trimmedReason) {
    return { ok: false, error: "correction_reason_required" };
  }

  return {
    ok: true,
    args: {
      accountId: params.accountId,
      field: params.field,
      value: trimmedValue,
      expectedCurrentFactId: params.currentFactId,
      correctionReason: isCorrection ? trimmedReason : null,
    },
  };
}

// ---------------------------------------------------------------------
// Error presentation — HTTP 409 (stale_fact_correction) renders as a
// distinct "value changed, refresh and retry" state; every other error
// (a different API error code, a network failure, a thrown non-Error
// value) renders through the SAME safe generic path, never a raw/leaked
// message for anything the backend didn't already craft as user-facing
// copy. Mirrors ./account-decisions-presentation.ts's
// describeAccountDecisionError.
// ---------------------------------------------------------------------

export type AccountFactsErrorPresentation =
  | { kind: "conflict" }
  | { kind: "generic"; message: string };

export function describeAccountFactsError(
  err: unknown,
  fallbackMessage = "Could not save this fact.",
): AccountFactsErrorPresentation {
  if (err instanceof AccountFactsApiError) {
    if (err.code === "stale_fact_correction") {
      return { kind: "conflict" };
    }
    return { kind: "generic", message: err.message || fallbackMessage };
  }
  return { kind: "generic", message: fallbackMessage };
}
