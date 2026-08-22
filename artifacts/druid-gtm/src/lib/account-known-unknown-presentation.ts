// Milestone 4C — pure classification + copy for "What we know" /
// "What we don't know yet". No DOM, no React.
//
// Mirrors ../../artifacts/api-server/src/services/accountKnownUnknown.ts's
// three-bucket classification exactly (Known / Conflicting / Unknown),
// re-derived client-side from the same raw accountTruth already fetched
// — never a duplicate wire field, matching this app's established
// pattern of deriving display classification from raw DTOs (see
// ./account-brain-presentation.ts's resolvedTruthLines).
//
// UNKNOWN IS SCOPED TO ACCOUNT TRUTH ONLY: per the M4/4C product
// correction, People/Activity absence is a factual state of Mission
// Control's own evidence — shown under What We Know (see
// ./account-brain-presentation.ts's activitySummaryLine) — never listed
// here as an "Unknown." This module only ever classifies the 11
// canonical Account Truth fields.

import { fieldLabel, sortFieldsForDisplay, displayCanonicalValue } from "@/lib/account-truth-presentation";
import type { AccountTruthField, CanonicalTruthField } from "@/lib/account-truth-api";

export interface KnownTruthLine {
  canonicalField: CanonicalTruthField;
  label: string;
  value: string;
  /** True when resolutionState === 'conflict' despite a safe canonical value existing — never silently dropped. */
  hasConflictingEvidence: boolean;
}

export interface ConflictingTruthLine {
  canonicalField: CanonicalTruthField;
  label: string;
}

export interface AccountTruthClassification {
  known: KnownTruthLine[];
  conflicting: ConflictingTruthLine[];
  unknown: CanonicalTruthField[];
}

export function classifyAccountTruthFields(
  fields: readonly AccountTruthField[],
): AccountTruthClassification {
  const known: KnownTruthLine[] = [];
  const conflicting: ConflictingTruthLine[] = [];
  const unknown: CanonicalTruthField[] = [];

  for (const field of sortFieldsForDisplay(fields)) {
    if (field.canonicalValue !== null) {
      known.push({
        canonicalField: field.canonicalField,
        label: fieldLabel(field.canonicalField),
        value: field.canonicalDisplayValue ?? displayCanonicalValue(field.canonicalField, field.canonicalValue),
        hasConflictingEvidence: field.resolutionState === "conflict",
      });
    } else if (field.resolutionState === "conflict") {
      conflicting.push({ canonicalField: field.canonicalField, label: fieldLabel(field.canonicalField) });
    } else {
      unknown.push(field.canonicalField);
    }
  }

  return { known, conflicting, unknown };
}

/** "We don't yet know the account's industry." — never "industry: unresolved" or any implementation term. */
export function unknownFieldLine(canonicalField: CanonicalTruthField): string {
  return `We don't yet know the account's ${fieldLabel(canonicalField).toLowerCase()}.`;
}
