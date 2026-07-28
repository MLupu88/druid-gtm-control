// IcpProfileConfigV1 — the profile-authored half of the canonical
// evaluator. This is exactly what lib/db/src/schema/icpProfileVersions.ts
// stores in its `config` jsonb column.
//
// Deliberately profile-configurable: fit, intent, actionability,
// eligibility (hard disqualifiers + restrictions). Deliberately NOT
// profile-configurable: identity resolution — see rules/identity.ts,
// which takes no profile config input at all, by construction.
//
// Contains no real DRUID scoring weights, thresholds, domains, competitor
// policy, LinkedIn legal policy, or voice-clearance policy — those are
// product/legal decisions Phase 0 discovery flagged as still open
// (docs/icp-rule-discovery.md §11). Every fixture/test in this package
// uses synthetic configuration only.

import { z } from "zod/v4";
import {
  type FieldAllowlist,
  ruleConditionSchema,
  validateConditionAgainstAllowlist,
} from "./conditions.js";

// Per-array structural cap. For eligibility specifically, the *combined*
// total of hardDisqualifiers + restrictions must also not exceed this —
// see EligibilityConfigSchema below, since two individually-capped
// arrays could otherwise combine past the intended dimension-wide bound.
export const MAX_RULES_PER_DIMENSION = 50;
export const MAX_TIERS_PER_DIMENSION = 20;

// ---------------------------------------------------------------------
// Dimension-specific field-path allowlists. A condition belonging to one
// dimension may only ever reference fields from that dimension's list —
// enforced in the superRefine blocks below via
// validateConditionAgainstAllowlist (conditions.ts).
// ---------------------------------------------------------------------

export const FIT_FIELD_ALLOWLIST: FieldAllowlist = {
  "company.domain": "string",
  "company.name": "string",
  "company.industry": "string",
  "company.employeeRange": "string",
  "company.revenueRange": "string",
  "company.region": "string",
  "company.country": "string",
};

export const INTENT_FIELD_ALLOWLIST: FieldAllowlist = {
  "engagement.sources": "stringArray",
  "engagement.pagesVisited": "stringArray",
  "engagement.distinctSourceCount": "number",
  "engagement.repeatVisit": "boolean",
  "engagement.lastSeenAt": "string",
};

// Operational contact/owner evidence only — no consent, legal basis, DPO
// clearance, or geographic legal policy. See rules/actionability.ts.
export const ACTIONABILITY_FIELD_ALLOWLIST: FieldAllowlist = {
  "contact.email": "string",
  "contact.phone": "string",
  "contact.linkedinUrl": "string",
  "crm.hubspotContactId": "string",
  "crm.hubspotOwner": "string",
};

// Account-level exclusion/restriction evidence.
export const ELIGIBILITY_FIELD_ALLOWLIST: FieldAllowlist = {
  doNotContact: "boolean",
  "crm.competitorFlag": "boolean",
  "crm.partnerFlag": "boolean",
  "crm.existingCustomer": "boolean",
  "crm.openOpportunity": "boolean",
  "company.domain": "string",
};

// ---------------------------------------------------------------------
// Rule/tier primitives
// ---------------------------------------------------------------------

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

export const RuleIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(IDENTIFIER_PATTERN, "rule id must be lowercase snake_case");
export const TierCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(IDENTIFIER_PATTERN, "tier code must be lowercase snake_case");

const nonNegativeFiniteInt = z.number().int().nonnegative().finite();

export const TierSchema = z
  .object({
    code: TierCodeSchema,
    minScore: nonNegativeFiniteInt,
  })
  .strict();
export type Tier = z.infer<typeof TierSchema>;

export const WeightedRuleSchema = z
  .object({
    id: RuleIdSchema,
    description: z.string().min(1).max(280),
    points: nonNegativeFiniteInt,
    condition: ruleConditionSchema,
  })
  .strict();
export type WeightedRule = z.infer<typeof WeightedRuleSchema>;

export const ConditionRuleSchema = z
  .object({
    id: RuleIdSchema,
    description: z.string().min(1).max(280),
    condition: ruleConditionSchema,
  })
  .strict();
export type ConditionRule = z.infer<typeof ConditionRuleSchema>;

function uniqueBy<T>(items: T[], key: (item: T) => string | number): boolean {
  const seen = new Set<string | number>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

function validateRuleConditions<
  T extends { condition: import("./conditions.js").RuleCondition },
>(
  rules: T[],
  allowlist: FieldAllowlist,
  dimensionLabel: string,
  ctx: z.RefinementCtx,
  pathPrefix: (index: number) => (string | number)[],
): void {
  rules.forEach((rule, index) => {
    try {
      validateConditionAgainstAllowlist(
        rule.condition,
        allowlist,
        dimensionLabel,
      );
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
        path: [...pathPrefix(index), "condition"],
      });
    }
  });
}

// ---------------------------------------------------------------------
// fit / intent — weighted rules + tiers, with a required floor tier at
// minScore 0 (guarantees rules/scoring.ts can always resolve a tier),
// unique tier codes, AND unique tier minScore thresholds (two tiers at
// the same threshold would make tier resolution ambiguous).
// ---------------------------------------------------------------------

function buildScoredRuleSetSchema(
  allowlist: FieldAllowlist,
  dimensionLabel: string,
) {
  return z
    .object({
      rules: z.array(WeightedRuleSchema).max(MAX_RULES_PER_DIMENSION),
      tiers: z.array(TierSchema).min(1).max(MAX_TIERS_PER_DIMENSION),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (!uniqueBy(value.rules, (r) => r.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate rule id within "${dimensionLabel}"`,
          path: ["rules"],
        });
      }
      if (!uniqueBy(value.tiers, (t) => t.code)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate tier code within "${dimensionLabel}"`,
          path: ["tiers"],
        });
      }
      if (!uniqueBy(value.tiers, (t) => t.minScore)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate tier minScore within "${dimensionLabel}" — tier thresholds must be unique`,
          path: ["tiers"],
        });
      }
      if (!value.tiers.some((t) => t.minScore === 0)) {
        ctx.addIssue({
          code: "custom",
          message: `"${dimensionLabel}" tiers must include a floor tier at minScore 0`,
          path: ["tiers"],
        });
      }
      validateRuleConditions(
        value.rules,
        allowlist,
        dimensionLabel,
        ctx,
        (i) => ["rules", i],
      );
    });
}

export const FitConfigSchema = buildScoredRuleSetSchema(
  FIT_FIELD_ALLOWLIST,
  "fit",
);
export type FitConfig = z.infer<typeof FitConfigSchema>;

export const IntentConfigSchema = buildScoredRuleSetSchema(
  INTENT_FIELD_ALLOWLIST,
  "intent",
);
export type IntentConfig = z.infer<typeof IntentConfigSchema>;

// ---------------------------------------------------------------------
// actionability — weighted rules, no tiers (see EvaluationResult:
// actionabilityScore has no accompanying tier field).
// ---------------------------------------------------------------------

export const ActionabilityConfigSchema = z
  .object({
    rules: z.array(WeightedRuleSchema).max(MAX_RULES_PER_DIMENSION),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!uniqueBy(value.rules, (r) => r.id)) {
      ctx.addIssue({
        code: "custom",
        message: 'duplicate rule id within "actionability"',
        path: ["rules"],
      });
    }
    validateRuleConditions(
      value.rules,
      ACTIONABILITY_FIELD_ALLOWLIST,
      "actionability",
      ctx,
      (i) => ["rules", i],
    );
  });
export type ActionabilityConfig = z.infer<typeof ActionabilityConfigSchema>;

// ---------------------------------------------------------------------
// eligibility — hard disqualifiers (evaluated first, outside weighted
// scoring) + restrictions. Rule ids share one namespace across both
// lists within this dimension. MAX_RULES_PER_DIMENSION applies to the
// COMBINED total of both arrays, not each array independently — two
// individually-capped-at-50 arrays could otherwise total 100 rules for
// one dimension, which defeats the point of a dimension-wide bound.
// ---------------------------------------------------------------------

export const EligibilityConfigSchema = z
  .object({
    hardDisqualifiers: z
      .array(ConditionRuleSchema)
      .max(MAX_RULES_PER_DIMENSION),
    restrictions: z.array(ConditionRuleSchema).max(MAX_RULES_PER_DIMENSION),
  })
  .strict()
  .superRefine((value, ctx) => {
    const combined = [...value.hardDisqualifiers, ...value.restrictions];
    if (combined.length > MAX_RULES_PER_DIMENSION) {
      ctx.addIssue({
        code: "custom",
        message: `"eligibility" hardDisqualifiers + restrictions combined must not exceed ${MAX_RULES_PER_DIMENSION} rules (got ${combined.length})`,
        path: ["hardDisqualifiers"],
      });
    }
    if (!uniqueBy(combined, (r) => r.id)) {
      ctx.addIssue({
        code: "custom",
        message:
          'duplicate rule id within "eligibility" (hardDisqualifiers and restrictions share one id namespace)',
        path: ["hardDisqualifiers"],
      });
    }
    validateRuleConditions(
      value.hardDisqualifiers,
      ELIGIBILITY_FIELD_ALLOWLIST,
      "eligibility",
      ctx,
      (i) => ["hardDisqualifiers", i],
    );
    validateRuleConditions(
      value.restrictions,
      ELIGIBILITY_FIELD_ALLOWLIST,
      "eligibility",
      ctx,
      (i) => ["restrictions", i],
    );
  });
export type EligibilityConfig = z.infer<typeof EligibilityConfigSchema>;

// ---------------------------------------------------------------------
// Top-level profile config
// ---------------------------------------------------------------------

export const IcpProfileConfigV1Schema = z
  .object({
    configSchemaVersion: z.literal("v1"),
    fit: FitConfigSchema,
    intent: IntentConfigSchema,
    actionability: ActionabilityConfigSchema,
    eligibility: EligibilityConfigSchema,
  })
  .strict();
export type IcpProfileConfigV1 = z.infer<typeof IcpProfileConfigV1Schema>;
