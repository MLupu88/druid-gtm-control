// Detects the exact legacy "Starter ICP" bootstrap configuration —
// see artifacts/api-server/src/scripts/bootstrapProductionData.ts's git
// history: the ORIGINAL starterProfileConfig() (before the ICP Authoring
// UX pass) seeded exactly one fit rule ("has a domain", 10 points),
// labeled the fit/intent fallback bands "base"/"floor", and left intent,
// actionability, and eligibility completely unconfigured. That exact
// profile version is still live in production (this detector never
// mutates it — see the module comment on
// artifacts/druid-gtm/src/components/legacy-starter-warning.tsx for why).
//
// Deliberately a STRUCTURAL signature, not a name match: matching on
// profile.name (e.g. "Starter ICP") would both false-negative (someone
// renames it) and false-positive (an unrelated profile that happens to
// share the name). Every dimension is checked — a profile that merely
// LOOKS similar (different points, an extra rule, a different band
// label) must not be flagged; only the exact known-empty shape is.
//
// Lives here (not just in the frontend) so both the API server (profile-
// library classification — see profileClassification.ts) and the
// frontend (the existing per-evaluation/per-version warning banners) use
// the exact same detector; artifacts/druid-gtm/src/lib/
// icp-legacy-starter-detection.ts re-exports this unchanged. `config` is
// typed `unknown` on both sides — this reads it defensively, by
// structural duck-typing only, no dependency on any other module in this
// package.

// ---------------------------------------------------------------------
// The exact literal values the legacy bootstrap script produced — named
// here so the "exactness" of every check below is self-evident, not
// buried in inline literals. Every one of these must match precisely;
// none is treated as "close enough".
// ---------------------------------------------------------------------
const LEGACY_FIT_CONDITION_OP = "exists";
const LEGACY_FIT_CONDITION_FIELD = "company.domain";
const LEGACY_FIT_RULE_POINTS = 10;
const LEGACY_FIT_FALLBACK_BAND_CODE = "base";
const LEGACY_INTENT_FALLBACK_BAND_CODE = "floor";
const LEGACY_FALLBACK_MIN_SCORE = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Exact condition match: op AND field must both equal the legacy
// literals, AND the object must have exactly these two keys (no third
// key such as a "value" that would mean a different operator entirely).
// Checked field-by-field (never via JSON.stringify) so this is immune to
// key-ordering differences in persisted JSONB — a semantically identical
// condition stored with keys in a different order must still match.
function isExactLegacyFitCondition(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.op === LEGACY_FIT_CONDITION_OP &&
    value.field === LEGACY_FIT_CONDITION_FIELD
  );
}

// Exact rule match: the condition above AND points must equal exactly
// 10 — not "some positive number", not "at least 10".
function isExactLegacyFitRule(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.points === LEGACY_FIT_RULE_POINTS &&
    isExactLegacyFitCondition(value.condition)
  );
}

// Exact fallback-band match: the array must contain EXACTLY one band
// (an additional second band — even one that never changes the
// fallback's own code/threshold — means the profile's fallback
// BEHAVIOR differs from the legacy signature, since a real account could
// now resolve to that second band instead of always falling back), and
// that one band's code and minScore (0 — the schema-required fallback
// threshold) must both match exactly.
function isExactFallbackBand(value: unknown, expectedCode: string): boolean {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    isRecord(value[0]) &&
    value[0].code === expectedCode &&
    value[0].minScore === LEGACY_FALLBACK_MIN_SCORE
  );
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/**
 * True only for the exact legacy functional signature — every
 * business-significant part of the legacy configuration, not merely its
 * general shape ("one fit rule and one band"):
 *   - fit: exactly one rule, whose condition is EXACTLY
 *     {op: "exists", field: "company.domain"} (no other operator, field,
 *     or extra key) worth EXACTLY 10 points; exactly one fallback band,
 *     coded exactly "base", at exactly minScore 0;
 *   - intent: no rules at all; exactly one fallback band, coded exactly
 *     "floor", at exactly minScore 0;
 *   - actionability: no rules at all;
 *   - eligibility: no hard disqualifiers AND no restrictions.
 * Every one of these must hold simultaneously — a config differing in
 * even one respect (a different field/operator/value, a different
 * points value, a different band threshold, an extra band changing
 * fallback behavior, or any configured disqualifier/restriction) is NOT
 * flagged. Rule `id` and `description` are deliberately never checked:
 * they are cosmetic/generated text that is NOT stable across persisted
 * snapshots (e.g. cloning this exact version into a new draft mints a
 * fresh rule id via generateRuleId() while the functional signature
 * stays identical) — checking them would make real legacy clones
 * silently escape detection.
 */
export function isLegacyStarterIcpConfig(config: unknown): boolean {
  if (!isRecord(config)) return false;

  const { fit, intent, actionability, eligibility } = config;

  if (!isRecord(fit) || !isRecord(intent) || !isRecord(actionability) || !isRecord(eligibility)) {
    return false;
  }

  const fitRulesExact =
    Array.isArray(fit.rules) && fit.rules.length === 1 && isExactLegacyFitRule(fit.rules[0]);
  const fitFallbackExact = isExactFallbackBand(fit.tiers, LEGACY_FIT_FALLBACK_BAND_CODE);

  const intentRulesExact = isEmptyArray(intent.rules);
  const intentFallbackExact = isExactFallbackBand(intent.tiers, LEGACY_INTENT_FALLBACK_BAND_CODE);

  const actionabilityExact = isEmptyArray(actionability.rules);

  const eligibilityExact =
    isEmptyArray(eligibility.hardDisqualifiers) && isEmptyArray(eligibility.restrictions);

  return (
    fitRulesExact &&
    fitFallbackExact &&
    intentRulesExact &&
    intentFallbackExact &&
    actionabilityExact &&
    eligibilityExact
  );
}
