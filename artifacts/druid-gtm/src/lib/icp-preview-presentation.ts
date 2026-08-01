// Pure presentation helpers for the account ICP preview panel
// (../components/account-icp-preview-panel.tsx). Kept separate from that
// component so the humanization/categorization logic is unit-testable
// without a DOM (this package has no jsdom/testing-library — see
// ./accounts-api.limit.test.ts) and so the component itself stays a thin
// rendering layer over these.
//
// Every function here is defensive over genuinely `unknown` jsonb input
// (see AccountEvaluation.matchedRules/hardDisqualifiers/
// eligibilityRestrictions/missingInputs in ./accounts-api.ts) — nothing
// below fabricates a category, score, or reason that isn't backed by the
// evaluator's own output, and nothing below ever surfaces a raw internal
// identifier (ruleId, field path, tier code) as if it were explanatory
// prose. Where meaning can't be established safely, callers get an
// explicit, neutral "this is a technical/configured value" signal rather
// than a guess — the raw value itself is always still returned alongside,
// for a collapsed technical-details view, never discarded.

import { humanizeToken } from "@workspace/gtm-shared";

// ---------------------------------------------------------------------
// Dimension labels — mirrors lib/evaluator/src/types.ts's `Dimension`
// union ("fit" | "intent" | "identity" | "actionability" | "eligibility")
// field-for-field, translated to the plain-language names used
// throughout this panel (FIT -> "ICP fit", etc.)
// ---------------------------------------------------------------------
const DIMENSION_LABELS: Record<string, string> = {
  fit: "ICP fit",
  intent: "Buying intent",
  identity: "Identity resolution",
  actionability: "Ability to act",
  eligibility: "Outreach eligibility",
};

export function humanizeDimension(dimension: unknown): string | null {
  if (typeof dimension !== "string") return null;
  return DIMENSION_LABELS[dimension] ?? humanizeToken(dimension);
}

// ---------------------------------------------------------------------
// Tier formatting. fitTier/intentTier are free-text codes an ICP
// profile's own config defines (see ./accounts-api.ts's comment on
// AccountEvaluation) — resolved from that profile's own tier list, keyed
// by whatever `code` string its author chose (see
// lib/evaluator/src/profileConfig.ts). Every dimension is REQUIRED to
// have some tier at minScore 0 (profileConfig.ts calls this the "floor
// tier" in its own validation messages), but nothing requires that tier
// to be *named* "floor" — a profile author could call it "floor", "base",
// "entry", or anything else, and the evaluation result only ever exposes
// the resolved code, never its minScore or position in the tier list. So
// a code like "base" or "floor" cannot be safely assumed to mean "the
// lowest tier" (or anything else) without also knowing that profile's
// tier thresholds, which this panel does not have. Every tier is
// therefore labeled the same honest way: a neutral "Configured tier: X"
// plus an explanation that the threshold comes from the profile, never a
// guessed interpretation — and the raw code is always preserved
// separately for the technical-details view.
// ---------------------------------------------------------------------
export const TIER_EXPLANATION =
  "This tier's threshold is defined by the selected ICP profile, not by this preview.";

export interface TierLabel {
  label: string;
  raw: string;
}

export function humanizeTierLabel(tier: string | null): TierLabel | null {
  if (tier === null || tier.trim() === "") return null;
  return { label: `Configured tier: ${humanizeToken(tier)}`, raw: tier };
}

// Scores are arbitrary-scale rule-point totals (see
// lib/evaluator/src/profileConfig.ts: tiers are defined by minScore
// thresholds per profile, with no fixed maximum anywhere in the
// evaluator) — never labeled "out of 100" or any other invented ceiling.
export function formatScorePoints(score: string | null): string {
  if (score === null || score.trim() === "") return "—";
  return `${score} points`;
}

// ---------------------------------------------------------------------
// Reason-entry humanization for matchedRules / hardDisqualifiers /
// eligibilityRestrictions. These are jsonb arrays of either
// MatchedRule/HardDisqualifierEntry/RestrictionEntry (see
// lib/evaluator/src/types.ts) — always `{ ruleId, description[, dimension] }`
// in practice — or, defensively, something else entirely.
//
// A small, fixed number of ruleIds are canonical evaluator-version
// mechanics (never profile-authored — see
// lib/evaluator/src/rules/identity.ts and rules/eligibility.ts's
// CANONICAL_IDENTITY_RESTRICTION), so a curated, shorter phrasing for
// exactly those is safe to hardcode: it is a paraphrase of that rule's
// own fixed `description` in the evaluator source, not a guess. Every
// other ruleId is profile-authored free text (see profileConfig.ts's
// RuleIdSchema, e.g. "has_domain") with no fixed meaning outside its own
// author-supplied `description` — for those, `description` is used
// as-is. If NEITHER a curated label nor an author-supplied description is
// available, the primary text falls back to a neutral, honest statement
// rather than ever showing the raw ruleId/field as if it were prose; the
// raw identifier is still returned via `technical`, so traceability is
// never lost, only visually demoted to a collapsed technical view.
// ---------------------------------------------------------------------
const CANONICAL_RULE_LABELS: Record<string, string> = {
  "identity.known_crm_contact":
    "A verified CRM contact is linked to this account.",
  "identity.direct_person_evidence":
    "A real person was directly identified for this account.",
  "identity.reconstructed_contact":
    "A likely contact was inferred from enrichment data, not directly identified.",
  "identity.weak_provenance_contact":
    "A contact identifier exists, but how it was collected isn't verified.",
  "identity.company_only":
    "The company is identified, but no verified individual contact is available.",
  "identity.anonymous": "No company or contact information is available yet.",
  "canonical.identity_not_person_addressable":
    "This account cannot be used for person-addressed outreach until a verified contact is available.",
};

const FALLBACK_REASON_TEXT = "A technical evaluation rule was applied.";

export interface ReasonEntry {
  /** Plain-language text — always safe to show as the primary label. */
  primary: string;
  /** Raw ruleId/field/JSON, if any — meant for a collapsed technical view only. */
  technical: string | null;
}

export function describeReasonEntry(item: unknown): ReasonEntry {
  if (typeof item === "string") {
    // A bare string has no separate raw identifier to demote — it's
    // already the only content available, human-authored or not.
    return { primary: item, technical: null };
  }

  if (item && typeof item === "object" && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    const ruleId = typeof record.ruleId === "string" ? record.ruleId : null;
    const field = typeof record.field === "string" ? record.field : null;
    const rawId =
      ruleId ?? field ?? (typeof record.id === "string" ? record.id : null);
    const description =
      typeof record.description === "string"
        ? record.description
        : typeof record.reason === "string"
          ? record.reason
          : null;
    const dimensionLabel = humanizeDimension(record.dimension);

    const canonical = ruleId ? CANONICAL_RULE_LABELS[ruleId] : undefined;
    const humanText = canonical ?? description;

    if (humanText) {
      return {
        primary: dimensionLabel ? `${dimensionLabel}: ${humanText}` : humanText,
        technical: rawId,
      };
    }

    // No curated label and no author-supplied description — never show
    // the raw ruleId/field as if it were explanatory prose.
    return { primary: FALLBACK_REASON_TEXT, technical: rawId };
  }

  let technical: string | null;
  try {
    technical = JSON.stringify(item);
  } catch {
    technical = null;
  }
  return { primary: FALLBACK_REASON_TEXT, technical };
}

// ---------------------------------------------------------------------
// Missing-input categorization. MissingInputEntry is always
// `{ field: string, affects: Dimension[] }` (see
// lib/evaluator/src/types.ts) where `field` is a dotted path drawn from a
// small, fixed set of allowlisted names (see
// lib/evaluator/src/profileConfig.ts's FIT_FIELD_ALLOWLIST/
// INTENT_FIELD_ALLOWLIST/ACTIONABILITY_FIELD_ALLOWLIST/
// ELIGIBILITY_FIELD_ALLOWLIST) — "crm.*", "engagement.*", "contact.*",
// "company.*", plus the standalone "doNotContact". Unlike ruleIds, these
// field paths ARE self-describing plain-English attribute names by
// construction (e.g. "company.industry", "contact.email") once
// de-dotted and title-cased, so a humanized fallback label is safe here
// in a way it isn't for ruleId. There is currently no consent/
// lawful-basis field anywhere in that allowlist; that category exists for
// forward-compatibility only and — like every other category — only ever
// appears if a real field name actually matches it, never unconditionally.
// ---------------------------------------------------------------------
const FIELD_CATEGORY_PREFIXES: { prefix: string; category: string }[] = [
  { prefix: "crm.", category: "CRM context" },
  { prefix: "engagement.", category: "Engagement history" },
  { prefix: "contact.", category: "Verified contact" },
];

function categoryForField(field: string): string {
  if (/consent|lawful.?basis/i.test(field)) {
    return "Consent or lawful-basis information";
  }
  const match = FIELD_CATEGORY_PREFIXES.find((entry) =>
    field.startsWith(entry.prefix),
  );
  if (match) return match.category;
  return humanizeToken(field.replace(/\./g, " "));
}

export interface MissingInputCategory {
  category: string;
  fields: string[];
  dimensions: string[];
}

// Returns:
//   - `null`   — items isn't a real array (unrecognized/unavailable shape):
//                callers should show a truthful "can't derive this" message,
//                never an empty-looking "nothing missing" state.
//   - `[]`     — a real, verifiably empty array: this evaluation genuinely
//                had every input it needed.
//   - entries  — grouped, deduplicated, human-labeled categories.
export function categorizeMissingInputs(
  items: unknown,
): MissingInputCategory[] | null {
  if (!Array.isArray(items)) return null;

  const byCategory = new Map<
    string,
    { fields: Set<string>; dimensions: Set<string> }
  >();

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field : null;
    if (!field) continue;

    const category = categoryForField(field);
    const entry = byCategory.get(category) ?? {
      fields: new Set<string>(),
      dimensions: new Set<string>(),
    };
    entry.fields.add(field);
    if (Array.isArray(record.affects)) {
      for (const dimension of record.affects) {
        const label = humanizeDimension(dimension);
        if (label) entry.dimensions.add(label);
      }
    }
    byCategory.set(category, entry);
  }

  return Array.from(byCategory.entries()).map(([category, entry]) => ({
    category,
    fields: Array.from(entry.fields).sort(),
    dimensions: Array.from(entry.dimensions).sort(),
  }));
}
