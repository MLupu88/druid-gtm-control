// Package 2, Phase 2 — canonical evaluator core types.
//
// NormalizedAccountInputV1 is the evaluator's input contract. It is
// deliberately a CLOSED shape (every object here is `.strict()`) — no
// unrestricted arbitrary evaluator fields are accepted. Business evidence
// that may genuinely be unknown is nullable/optional; the shape itself
// (which keys exist) is fixed and versioned via `schemaVersion`.
//
// Field vocabulary is drawn from what Phase 0 discovery
// (docs/icp-rule-discovery.md) confirmed recurs across the legacy n8n
// pipeline — the SHAPE is reused, none of the scoring formulas attached
// to it there are.

import { z } from "zod/v4";

// ---------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------

const NonBlankString = z.string().trim().min(1).max(500);

export const RegionV1 = z.enum(["us", "emea", "other", "unknown"]);
export type RegionV1 = z.infer<typeof RegionV1>;

// How a piece of contact evidence was surfaced. Never trusted blindly —
// rules/identity.ts uses this to resolve confidence, and it is always
// preserved (see MatchedRule) as provenance.
export const ContactOriginV1 = z.enum([
  "rb2b",
  "hubspot_known",
  "cognism_reconstructed",
  "form_submit",
  "self_identified",
  "unknown",
]);
export type ContactOriginV1 = z.infer<typeof ContactOriginV1>;

// Legal/consent facts are preserved as evidence on the input, but the
// canonical-v1 actionability rules must not read them — see
// rules/actionability.ts and profileConfig.ts's ACTIONABILITY_FIELD_ALLOWLIST.
export const TriStateFlagV1 = z.enum(["true", "false", "unknown"]);
export type TriStateFlagV1 = z.infer<typeof TriStateFlagV1>;

// ---------------------------------------------------------------------
// NormalizedAccountInputV1
// ---------------------------------------------------------------------

export const NormalizedCompanyV1Schema = z
  .object({
    domain: NonBlankString.nullable(),
    name: NonBlankString.nullable(),
    industry: NonBlankString.nullable(),
    employeeRange: NonBlankString.nullable(),
    revenueRange: NonBlankString.nullable(),
    region: RegionV1,
    country: NonBlankString.nullable(),
  })
  .strict();
export type NormalizedCompanyV1 = z.infer<typeof NormalizedCompanyV1Schema>;

export const NormalizedEngagementV1Schema = z
  .object({
    sources: z.array(NonBlankString).max(20),
    pagesVisited: z.array(NonBlankString).max(50),
    // A factual count (how many distinct signal sources have engaged),
    // not a derived score — the only numeric field in this input shape,
    // included so the closed condition DSL's "gte" operator has a
    // legitimate field to compare against.
    distinctSourceCount: z.number().int().nonnegative().max(1000),
    repeatVisit: z.boolean(),
    lastSeenAt: NonBlankString.nullable(),
  })
  .strict();
export type NormalizedEngagementV1 = z.infer<
  typeof NormalizedEngagementV1Schema
>;

// Contact evidence is nullable as a whole (no contact evidence at all is
// a normal, expected state — not an error) rather than every field being
// independently nullable with no way to express "there is no contact".
export const NormalizedContactV1Schema = z
  .object({
    name: NonBlankString.nullable(),
    email: NonBlankString.nullable(),
    phone: NonBlankString.nullable(),
    title: NonBlankString.nullable(),
    linkedinUrl: NonBlankString.nullable(),
    origin: ContactOriginV1,
  })
  .strict();
export type NormalizedContactV1 = z.infer<typeof NormalizedContactV1Schema>;

export const NormalizedCrmV1Schema = z
  .object({
    hubspotCompanyId: NonBlankString.nullable(),
    hubspotContactId: NonBlankString.nullable(),
    hubspotOwner: NonBlankString.nullable(),
    openOpportunity: z.boolean(),
    existingCustomer: z.boolean(),
    competitorFlag: z.boolean(),
    partnerFlag: z.boolean(),
  })
  .strict();
export type NormalizedCrmV1 = z.infer<typeof NormalizedCrmV1Schema>;

export const NormalizedConsentV1Schema = z
  .object({
    email: TriStateFlagV1,
    call: TriStateFlagV1,
    liBasisCleared: TriStateFlagV1,
    dpoVoiceCleared: TriStateFlagV1,
  })
  .strict();
export type NormalizedConsentV1 = z.infer<typeof NormalizedConsentV1Schema>;

export const NormalizedAccountInputV1Schema = z
  .object({
    schemaVersion: z.literal("v1"),
    company: NormalizedCompanyV1Schema,
    engagement: NormalizedEngagementV1Schema,
    // Company identity/firmographics + engagement/intent are always
    // present in shape (even if individual fields are null); contact
    // evidence and CRM facts may be entirely absent for an anonymous
    // visitor, so `contact` itself is nullable.
    contact: NormalizedContactV1Schema.nullable(),
    crm: NormalizedCrmV1Schema,
    doNotContact: z.boolean(),
    consent: NormalizedConsentV1Schema,
    source: NonBlankString,
  })
  .strict();
export type NormalizedAccountInputV1 = z.infer<
  typeof NormalizedAccountInputV1Schema
>;

// ---------------------------------------------------------------------
// Evaluator output types — field names mirror lib/db's account_evaluations
// columns 1:1 so a future persist.ts adapter can map this object directly
// onto an insert without renaming anything. Enum literal unions below
// intentionally match lib/db/src/schema/enums.ts's pgEnum values; they are
// redeclared here (not imported from @workspace/db) so this package stays
// free of any database dependency — see the design note in the evaluator
// package README/report for the tradeoff.
// ---------------------------------------------------------------------

export type Dimension =
  | "fit"
  | "intent"
  | "identity"
  | "actionability"
  | "eligibility";

export type IdentityResolutionLevel =
  | "anonymous"
  | "company"
  | "contact"
  | "known_crm_contact";
export type IdentityConfidence = "low" | "medium" | "high";
export type EligibilityOutcome = "eligible" | "restricted" | "ineligible";

export interface ScoreComponent {
  ruleId: string;
  dimension: "fit" | "intent" | "actionability";
  label: string;
  points: number;
}

export interface MatchedRule {
  ruleId: string;
  dimension: Dimension;
  description: string;
}

export interface MissingInputEntry {
  /** Dotted path into NormalizedAccountInputV1, e.g. "company.industry". */
  field: string;
  affects: Dimension[];
}

export interface HardDisqualifierEntry {
  ruleId: string;
  description: string;
}

export interface RestrictionEntry {
  ruleId: string;
  description: string;
}

/**
 * The pure canonical evaluator's output. Always represents a completed
 * evaluation — evaluateAccount() (registry.ts) assumes already-validated
 * typed input, and given valid input the deterministic rule set cannot
 * itself fail. Never contains routing output, action-availability, or
 * anything else account_decisions owns.
 */
export interface EvaluationResult {
  fitScore: number;
  fitTier: string;
  intentScore: number;
  intentTier: string;
  identityResolutionLevel: IdentityResolutionLevel;
  identityConfidence: IdentityConfidence;
  actionabilityScore: number;
  eligibilityOutcome: EligibilityOutcome;
  scoreComponents: ScoreComponent[];
  matchedRules: MatchedRule[];
  missingInputs: MissingInputEntry[];
  hardDisqualifiers: HardDisqualifierEntry[];
  eligibilityRestrictions: RestrictionEntry[];
}
