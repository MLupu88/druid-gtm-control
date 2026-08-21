// Milestone 3F — immutable, append-only fact-reconciliation history.
//
// One row per RESOLUTION COMPUTATION for one (account_id, canonical_field)
// pair — never a mutation of a prior computation, mirroring
// identity_resolution_events.ts's own "every row is a complete snapshot,
// never a partial delta" shape (see that file's header comment) applied
// to fact reconciliation instead of identity binding. A later
// recomputation (new evidence, a policy version bump) writes a NEW row;
// it never edits this one.
//
// Deliberately no "current" pointer table (contrast with
// account_fact_current.ts): nothing reads this table on a hot path yet
// (no route, no evaluator/UI wiring — that remains 3G), so there is
// nothing to optimize for. "Latest row per (account_id, canonical_field),
// ordered by (resolved_at, id)" is a single indexed query, the same
// no-pointer precedent identity_resolution_events.ts already established
// for itself ("A future current-pointer/read model... may be added
// later... deliberately not built in this unit"). Add one later only
// once a real reader needs it.
//
// This table is NOT a fork of account_facts, and account_facts is left
// completely unmodified: account_facts is closed by design to exactly
// five fields and the single 'manual-operator-v1' source (see that
// file's own CHECK constraints), with an at-most-one-live-lineage
// uniqueness rule that models sequential human correction, not several
// providers holding simultaneously-live competing claims before a winner
// is picked. Loosening those CHECKs to fit would break Slice 1's own
// closed contract and would also force touching the evaluator's snapshot
// schema (accountFactsSnapshotEvidence.ts's hardcoded
// z.literal(MANUAL_OPERATOR_FACT_SOURCE)), an explicit 3F boundary
// violation. This table instead reconciles TWO existing, untouched
// evidence sources — Milestone 3D's observations AND the operator's own
// account_facts/account_fact_current — into one provider-neutral
// canonical answer per field, something neither source was ever built to
// represent alone. Manual account_facts rows are read at resolver INPUT
// time and adapted into reconciliation candidates; they are never copied
// into observations, and account_facts/account_fact_current keep their
// exact current meaning and remain the only thing any existing consumer
// (evaluator, Accounts API/UI) reads until 3G decides how the two
// combine.
//
// canonical_field spans BOTH observations' firmographic_fact and
// crm_state closed vocabularies (Milestone 3C) in one flat list — this
// table has no branch discriminator the way observations does, because
// every row here already answers "what is the canonical value for this
// one field," regardless of which observation_class (or account_facts)
// originally carried it. behavioral_signal/research_intelligence
// deliberately have NO rows here at all: 3F does not reconcile
// event/evidence streams into scalar facts (see factReconciliation.ts's
// own header comment), and manual account_facts only ever covers its own
// five firmographic fields — never the six crm.* fields, which no manual
// entry path supports.
//
// EVIDENCE IS PROVIDER-NEUTRAL, NOT OBSERVATION-ONLY: a canonical value
// (or a conflict) may be supported/contradicted by observations.id rows,
// account_facts.id rows, or both — a human operator's confirmed fact is
// itself a first-class piece of evidence here, not something layered on
// top afterward. selected_observation_id / selected_manual_account_fact_id
// are two mutually-exclusive nullable FKs (never both set) representing
// WHICH kind of row supplied the canonical value; supporting/
// conflicting/considered_evidence are plain JSON arrays of small
// {kind: "observation" | "manual_account_fact", id} references — not
// FK-enforced join-table rows — mirroring
// identity_resolution_events.candidate_matches' own jsonb-array
// precedent rather than inventing a new relational evidence table.
// considered_evidence always lists every candidate this computation
// looked at, regardless of outcome, so no competing evidence — provider
// or manual — is ever silently discarded even when the state ends up
// 'unresolved'.
//
// canonical_value and EXACTLY ONE selected-evidence column are non-null
// together exactly when resolution_state is 'single_source' or
// 'agreement' (a value was always found), and both stay null exactly
// when 'unresolved' (no usable candidate, or values not yet safely
// comparable — see factReconciliation.ts). A 'conflict' row may go
// either way: canonical_value is populated only when the resolution
// policy found a deterministic winner — including a valid current manual
// account_fact, which this policy treats as the highest-authority
// evidence for the fields it covers — otherwise it stays null; a
// conflict may legitimately persist with no canonical value, never a
// silently guessed one, and the LOSING evidence (provider or manual) is
// still recorded in conflicting_evidence even when a manual fact wins.
//
// Append-only: a database trigger (resolved_facts_immutable, reusing the
// existing reject_update_delete() function — see
// drizzle/0001_integrity_triggers.sql) rejects UPDATE and DELETE, the
// same mechanism observations/account_facts/identity_resolution_events
// already use.

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountFacts } from "./accountFacts";
import { accounts } from "./accounts";
import { factResolutionState } from "./enums";
import { observations } from "./observations";

// Exactly observations.ts's own firmographic_fact + crm_state closed
// vocabularies (Milestone 3C), flattened into one list — see module
// comment for why this table has no branch discriminator. This is a
// SUPERSET of account_facts.ts's own ACCOUNT_FACT_FIELDS (the five
// firmographic fields) — the six crm.* fields have no manual-entry path
// at all and can therefore never carry a manual_account_fact evidence
// reference.
export const RESOLVED_FACT_CANONICAL_FIELDS = [
  "company.industry",
  "company.country",
  "company.region",
  "company.employeeRange",
  "company.revenueRange",
  "crm.owner",
  "crm.lifecycleStage",
  "crm.openOpportunity",
  "crm.existingCustomer",
  "crm.competitorFlag",
  "crm.partnerFlag",
] as const;
export type ResolvedFactCanonicalField =
  (typeof RESOLVED_FACT_CANONICAL_FIELDS)[number];

// Provider-neutral evidence reference — application-layer shape only
// (validated by insertResolvedFactSchema below, not deep-checked in SQL,
// the same tradeoff identity_resolution_events.candidate_matches already
// makes for its own jsonb array). "id" is observations.id when
// kind = "observation", account_facts.id when
// kind = "manual_account_fact" — never a copy of the evidence itself.
export const EvidenceReferenceKind = z.enum(["observation", "manual_account_fact"]);
export type EvidenceReferenceKind = z.infer<typeof EvidenceReferenceKind>;

export const EvidenceReferenceSchema = z
  .object({
    kind: EvidenceReferenceKind,
    id: z.string().uuid(),
  })
  .strict();
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const resolvedFacts = pgTable(
  "resolved_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    canonicalField: text("canonical_field").notNull(),
    resolutionState: factResolutionState("resolution_state").notNull(),
    canonicalValue: jsonb("canonical_value"),
    // Mutually exclusive — see module comment. Real FK integrity (not a
    // generic untyped uuid) for whichever kind actually won, rather than
    // a polymorphic reference no constraint can check.
    selectedObservationId: uuid("selected_observation_id").references(
      () => observations.id,
    ),
    // Composite FK (below) additionally requires the referenced
    // account_facts row to belong to this SAME account_id/canonical_field
    // — mirrors account_fact_current.ts's identical guarantee.
    selectedManualAccountFactId: uuid("selected_manual_account_fact_id"),
    supportingEvidence: jsonb("supporting_evidence")
      .$type<EvidenceReference[]>()
      .notNull()
      .default([]),
    conflictingEvidence: jsonb("conflicting_evidence")
      .$type<EvidenceReference[]>()
      .notNull()
      .default([]),
    consideredEvidence: jsonb("considered_evidence")
      .$type<EvidenceReference[]>()
      .notNull()
      .default([]),
    policyVersion: text("policy_version").notNull(),
    rationale: text("rationale").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "resolved_facts_canonical_field_allowed",
      sql`${t.canonicalField} IN ('company.industry', 'company.country', 'company.region', 'company.employeeRange', 'company.revenueRange', 'crm.owner', 'crm.lifecycleStage', 'crm.openOpportunity', 'crm.existingCustomer', 'crm.competitorFlag', 'crm.partnerFlag')`,
    ),
    check(
      "resolved_facts_policy_version_not_blank",
      sql`trim(${t.policyVersion}) <> ''`,
    ),
    check("resolved_facts_rationale_not_blank", sql`trim(${t.rationale}) <> ''`),
    // Never both selected-evidence columns at once, regardless of state.
    check(
      "resolved_facts_selected_evidence_mutually_exclusive",
      sql`NOT (${t.selectedObservationId} IS NOT NULL AND ${t.selectedManualAccountFactId} IS NOT NULL)`,
    ),
    // single_source/agreement always resolved a value via exactly one
    // evidence kind; unresolved never did; conflict may go either way —
    // see module comment.
    check(
      "resolved_facts_canonical_value_matches_state",
      sql`
        (${t.resolutionState} IN ('single_source', 'agreement')
          AND ${t.canonicalValue} IS NOT NULL
          AND (${t.selectedObservationId} IS NOT NULL OR ${t.selectedManualAccountFactId} IS NOT NULL))
        OR (${t.resolutionState} = 'unresolved'
          AND ${t.canonicalValue} IS NULL
          AND ${t.selectedObservationId} IS NULL
          AND ${t.selectedManualAccountFactId} IS NULL)
        OR (${t.resolutionState} = 'conflict'
          AND ((${t.canonicalValue} IS NULL
              AND ${t.selectedObservationId} IS NULL
              AND ${t.selectedManualAccountFactId} IS NULL)
            OR (${t.canonicalValue} IS NOT NULL
              AND (${t.selectedObservationId} IS NOT NULL OR ${t.selectedManualAccountFactId} IS NOT NULL))))
      `,
    ),
    check(
      "resolved_facts_supporting_evidence_is_array",
      sql`jsonb_typeof(${t.supportingEvidence}) = 'array'`,
    ),
    check(
      "resolved_facts_conflicting_evidence_is_array",
      sql`jsonb_typeof(${t.conflictingEvidence}) = 'array'`,
    ),
    check(
      "resolved_facts_considered_evidence_is_array",
      sql`jsonb_typeof(${t.consideredEvidence}) = 'array'`,
    ),
    // Reserved for a future resolved_fact_current-style pointer (not
    // built in this unit — see module comment); kept as a unique index
    // now so that addition is additive later, mirroring
    // account_facts_id_account_field_uq exactly.
    uniqueIndex("resolved_facts_id_account_field_uq").on(
      t.id,
      t.accountId,
      t.canonicalField,
    ),
    index("resolved_facts_account_field_resolved_at_idx").on(
      t.accountId,
      t.canonicalField,
      t.resolvedAt,
    ),
    // When set, the referenced account_facts row must belong to this
    // SAME account_id/canonical_field — a manual fact for a different
    // account or field can never be recorded as this row's selected
    // evidence. Targets account_facts_id_account_field_uq.
    foreignKey({
      name: "resolved_facts_manual_fact_same_account_field_fk",
      columns: [t.selectedManualAccountFactId, t.accountId, t.canonicalField],
      foreignColumns: [accountFacts.id, accountFacts.accountId, accountFacts.field],
    }),
  ],
);

export const insertResolvedFactSchema = createInsertSchema(resolvedFacts, {
  canonicalField: (schema) => schema,
  canonicalValue: z.unknown().nullable(),
  supportingEvidence: z.array(EvidenceReferenceSchema).default([]),
  conflictingEvidence: z.array(EvidenceReferenceSchema).default([]),
  consideredEvidence: z.array(EvidenceReferenceSchema).default([]),
  policyVersion: (schema) => schema.trim().min(1),
  rationale: (schema) => schema.trim().min(1),
}).omit({
  id: true,
  resolvedAt: true,
});
export type InsertResolvedFact = z.infer<typeof insertResolvedFactSchema>;
export type ResolvedFact = typeof resolvedFacts.$inferSelect;
