// Milestone 4B — pure, DOM-free logic for
// ../components/account-brain-panel.tsx. Mirrors
// ./account-truth-presentation.ts's own module comment discipline (no
// jsdom/testing-library in this package).
//
// This module deliberately does NOT invent a second "condensed truth"
// label map or duplicate account-truth-presentation.ts's own field
// labels/value formatting — it reuses fieldLabel/displayCanonicalValue
// directly (same functions the Overview/Intelligence "Account Truth"
// display already uses), so "What we know" never drifts out of sync
// with how Account Truth is labeled everywhere else in the app.

import { fieldLabel, sortFieldsForDisplay, displayCanonicalValue } from "@/lib/account-truth-presentation";
import type { AccountTruthField } from "@/lib/account-truth-api";
import type { AccountActivitySummary } from "@/lib/account-brain-api";

export interface KnownTruthLine {
  label: string;
  value: string;
}

/** Only fields Account Truth has actually resolved (a real canonicalValue) — an unresolved field is simply absent, never shown as "Unknown". */
export function resolvedTruthLines(fields: readonly AccountTruthField[]): KnownTruthLine[] {
  return sortFieldsForDisplay(fields.filter((f) => f.canonicalValue !== null)).map((f) => ({
    label: fieldLabel(f.canonicalField),
    value: f.canonicalDisplayValue ?? displayCanonicalValue(f.canonicalField, f.canonicalValue),
  }));
}

function formatCalendarDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * One factual sentence describing activity coverage — never a fabricated
 * claim, never displayed as an account_claims row (see
 * ../../artifacts/api-server/src/services/accountActivitySummary.ts's
 * own module comment: this is analysis metadata, computed fresh, never
 * persisted).
 */
export function activitySummaryLine(summary: AccountActivitySummary): string {
  if (summary.totalEvents === 0) {
    return "No activity has been observed for this account yet.";
  }
  const providerList = summary.providers.join(", ");
  const first = formatCalendarDate(summary.firstObservedAt);
  const last = formatCalendarDate(summary.lastObservedAt);
  const dayWord = summary.distinctDaysObserved === 1 ? "day" : "days";
  const eventWord = summary.totalEvents === 1 ? "event" : "events";
  const range = first && last && first !== last ? ` between ${first} and ${last}` : first ? ` on ${first}` : "";
  return `${summary.totalEvents} ${eventWord} observed across ${summary.distinctDaysObserved} distinct ${dayWord}${range}, via ${providerList}.`;
}

export type NarrativeUnavailableCopy = string;

const UNAVAILABLE_COPY: Record<string, NarrativeUnavailableCopy> = {
  not_configured: "Grounded synthesis is not configured for this environment.",
  api_error: "Grounded synthesis is temporarily unavailable.",
  invalid_json: "Grounded synthesis returned an unusable response.",
  invalid_shape: "Grounded synthesis returned an unusable response.",
  forbidden_language: "Grounded synthesis was withheld — it did not meet this account's evidence-grounding rules.",
  ungrounded: "Grounded synthesis was withheld — it did not meet this account's evidence-grounding rules.",
};

/** Human copy for a narrativeUnavailableReason — never the raw enum value shown to a user. */
export function narrativeUnavailableCopy(reason: string): NarrativeUnavailableCopy {
  return UNAVAILABLE_COPY[reason] ?? "Grounded synthesis is currently unavailable.";
}
