// Milestone 4A — Account Brain claim ledger.
//
// Immutable, append-only assertions about an account, keyed by an OPEN
// claimKey vocabulary (unlike account_facts.field, a closed five-value
// enum-in-a-CHECK) — 4E's eventual research-question library populates
// this vocabulary later; 4A itself hardcodes none of it. Every row is a
// frozen assertion for one (account_id, claim_key) pair at one point in
// time — never updated or deleted (reject_update_delete trigger, see
// drizzle/0017_account_claims_immutability.sql).
//
// NOT a fork of resolved_facts.ts or account_facts.ts, and neither is
// modified: resolved_facts remains Milestone 3F's single-winner,
// policy-reconciled ICP/scoring truth, scoped to its own closed 11-field
// vocabulary; account_facts remains its own closed five-field manual
// firmographic-correction ledger. account_claims instead models a THIRD,
// new concept — Account Brain claims — with two properties neither prior
// table has: (1) an open key vocabulary, and (2) deliberate support for
// several simultaneously-active, disagreeing claims on the same key (see
// "contradiction preservation" below). Where this file structurally
// mirrors something, it mirrors account_facts.ts's own append-only +
// mutable-current-pointer shape (see accountClaimCurrent.ts), not its
// closed vocabulary or its single-lineage uniqueness rule.
//
// CONTRADICTION PRESERVATION: unlike account_facts (which enforces "at
// most one ROOT assertion per account_id/field" — a single sequential
// correction chain), account_claims places NO such uniqueness rule on
// claim_key. Two independent, disagreeing claims (e.g. two research runs
// each reporting a different current CX vendor) may both be inserted as
// status = 'active' root rows (supersedes_claim_id IS NULL) for the same
// (account_id, claim_key) — Mission Control never invents a winner
// between them (see accountClaims.ts, the service layer). Only
// account_claim_current's single pointer decides which one, if any, is
// currently surfaced as "the" claim; the losing/disagreeing row remains
// permanently visible in this table.
//
// SUPERSESSION vs. CONTRADICTION: supersedes_claim_id is set ONLY when a
// write is an intentional correction/replacement chosen by the caller
// (typically a human confirming or correcting a specific prior claim) —
// never inferred automatically from "whatever the current pointer
// happens to point at" when two independent claims merely disagree. See
// accountClaims.ts's recordClaim() for the full precedence rules this
// enables.
//
// STATUS IS SET ONCE, NEVER MUTATED: because this table is immutable, a
// row's status can never flip from 'active' to a retroactive
// "superseded" after a newer row wins the current pointer — that would
// require an UPDATE. Instead status describes only the row's own nature
// at write time ('active' = a real assertion, 'rejected' = an explicit
// "this prior claim is wrong, no replacement value" human action); a row
// no longer pointed at by account_claim_current is still truthfully
// status = 'active' — it was, and remains, an active assertion, and this
// table itself makes no separate "still current" claim about it (see
// claim_status's own comment in enums.ts).
//
// EVIDENCE IS REFERENCED, NEVER COPIED: evidence_refs is a plain jsonb
// array of {kind, id} references — not a join table, not a payload copy
// — mirroring resolved_facts.ts's supporting/conflicting/considered
// evidence precedent (application-layer-validated only, not FK-enforced
// — resolved_facts makes the identical tradeoff for the same reason: no
// single distinguished "the" evidence column exists here to attach a
// real FK to). AccountClaimEvidenceReferenceKind is a fresh definition
// (not imported from resolvedFacts.ts) so this table stays fully
// decoupled from the 3F/ICP-scoring module — but it deliberately reuses
// the identical two-value vocabulary ("observation" | "manual_account_fact")
// since claim evidence can only ever be sourced from those same two
// existing evidence-bearing tables.

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
import { accounts } from "./accounts";
import { claimConfidence, claimOrigin, claimStatus, claimValueType } from "./enums";

// Mirrors accountFacts.ts's own reasoning for keeping a literal length
// constant local to lib/db rather than importing from lib/evaluator (the
// persistence layer stays evaluator-agnostic).
export const CLAIM_KEY_MAX_LENGTH = 200;
export const CLAIM_STRING_VALUE_MAX_LENGTH = 2000;

// A fresh definition, not an import from resolvedFacts.ts — see module
// comment. "manual_account_fact" (not "account_fact") deliberately
// matches resolved_facts' own literal exactly, since both reference the
// exact same account_facts.id rows.
export const AccountClaimEvidenceReferenceKind = z.enum([
  "observation",
  "manual_account_fact",
]);
export type AccountClaimEvidenceReferenceKind = z.infer<
  typeof AccountClaimEvidenceReferenceKind
>;

export const AccountClaimEvidenceReferenceSchema = z
  .object({
    kind: AccountClaimEvidenceReferenceKind,
    id: z.string().uuid(),
  })
  .strict();
export type AccountClaimEvidenceReference = z.infer<
  typeof AccountClaimEvidenceReferenceSchema
>;

export const accountClaims = pgTable(
  "account_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    // Open vocabulary — no CHECK-enumerated allowlist. Structural format
    // only (dot-namespaced, lowercase); 4E's research-question library
    // (not built in 4A) is what will eventually curate real key values.
    claimKey: text("claim_key").notNull(),
    valueType: claimValueType("value_type"),
    value: jsonb("value"),
    origin: claimOrigin("origin").notNull(),
    confidence: claimConfidence("confidence"),
    status: claimStatus("status").notNull().default("active"),
    // Nullable self-reference: NULL on an independent (root or
    // contradicting) assertion, set to the id of the claim this one
    // explicitly corrects/rejects otherwise. See the composite FK below.
    supersedesClaimId: uuid("supersedes_claim_id"),
    correctionReason: text("correction_reason"),
    // Required iff origin is human_confirmed/human_corrected — the
    // operator identity. Never set for machine origins.
    recordedBy: text("recorded_by"),
    // Required iff origin = 'derived' — which computation produced this
    // claim, so a later logic change is distinguishable from a data
    // change.
    generatedByVersion: text("generated_by_version"),
    evidenceRefs: jsonb("evidence_refs")
      .$type<AccountClaimEvidenceReference[]>()
      .notNull()
      .default([]),
    // When the underlying evidence was observed (distinct from
    // created_at, when this row was written) — nullable, caller-supplied.
    observedAt: timestamp("observed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("account_claims_claim_key_not_blank", sql`trim(${t.claimKey}) <> ''`),
    check(
      "account_claims_claim_key_max_length",
      sql`length(${t.claimKey}) <= ${sql.raw(String(CLAIM_KEY_MAX_LENGTH))}`,
    ),
    check(
      "account_claims_claim_key_format",
      sql`${t.claimKey} ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)+$'`,
    ),
    // active <=> a real typed value is present; rejected <=> no value.
    // See module comment — status is never mutated after insert, so this
    // is checked once, at write time, and stays true forever.
    check(
      "account_claims_active_has_value",
      sql`
        (${t.status} = 'active' AND ${t.value} IS NOT NULL AND ${t.valueType} IS NOT NULL)
        OR (${t.status} = 'rejected' AND ${t.value} IS NULL AND ${t.valueType} IS NULL)
      `,
    ),
    // A rejection is always an explicit human action referencing exactly
    // which prior claim it rejects — never a machine-origin state, never
    // a "root" rejection with nothing to reject.
    check(
      "account_claims_rejected_requires_human_correction",
      sql`${t.status} <> 'rejected' OR (${t.origin} = 'human_corrected' AND ${t.supersedesClaimId} IS NOT NULL)`,
    ),
    // Correction-reason iff-and-only-if supersedes_claim_id — mirrors
    // account_facts_correction_reason_iff_supersedes exactly.
    check(
      "account_claims_correction_reason_iff_supersedes",
      sql`(${t.supersedesClaimId} IS NULL AND ${t.correctionReason} IS NULL)
        OR (${t.supersedesClaimId} IS NOT NULL AND ${t.correctionReason} IS NOT NULL AND trim(${t.correctionReason}) <> '')`,
    ),
    check(
      "account_claims_recorded_by_iff_human_origin",
      sql`(${t.origin} IN ('human_confirmed', 'human_corrected') AND ${t.recordedBy} IS NOT NULL AND trim(${t.recordedBy}) <> '')
        OR (${t.origin} NOT IN ('human_confirmed', 'human_corrected') AND ${t.recordedBy} IS NULL)`,
    ),
    check(
      "account_claims_generated_by_version_iff_derived",
      sql`(${t.origin} = 'derived' AND ${t.generatedByVersion} IS NOT NULL AND trim(${t.generatedByVersion}) <> '')
        OR (${t.origin} <> 'derived' AND ${t.generatedByVersion} IS NULL)`,
    ),
    // Machine-origin claims must always cite at least one evidence
    // reference — traceability is not optional for observed/derived/
    // research claims. Human origins may cite evidence too, but are not
    // required to (an operator's own authority is sufficient, mirroring
    // account_facts' identical precedent of requiring no evidence link).
    check(
      "account_claims_machine_origin_requires_evidence",
      sql`${t.origin} IN ('human_confirmed', 'human_corrected') OR jsonb_array_length(${t.evidenceRefs}) >= 1`,
    ),
    check(
      "account_claims_evidence_refs_is_array",
      sql`jsonb_typeof(${t.evidenceRefs}) = 'array'`,
    ),
    // Composite unique target for the self-referencing FK below and for
    // account_claim_current's own FK (see accountClaimCurrent.ts).
    uniqueIndex("account_claims_id_account_key_uq").on(
      t.id,
      t.accountId,
      t.claimKey,
    ),
    // At most one claim may supersede any given predecessor — prevents
    // two competing corrections from both targeting the same row.
    // Deliberately NO "one root per account_id/claim_key" unique index
    // (contrast account_facts_one_root_per_account_field) — see module
    // comment on contradiction preservation.
    uniqueIndex("account_claims_supersedes_claim_id_uq").on(t.supersedesClaimId),
    // Self-referencing composite FK: when set, supersedes_claim_id must
    // reference a row with the SAME account_id and claim_key as this row.
    foreignKey({
      name: "account_claims_supersedes_same_account_key_fk",
      columns: [t.supersedesClaimId, t.accountId, t.claimKey],
      foreignColumns: [t.id, t.accountId, t.claimKey],
    }),
    index("account_claims_account_key_created_idx").on(
      t.accountId,
      t.claimKey,
      t.createdAt,
    ),
    index("account_claims_account_status_idx").on(t.accountId, t.status),
  ],
);

export const insertAccountClaimSchema = createInsertSchema(accountClaims, {
  claimKey: (schema) =>
    schema
      .trim()
      .min(1)
      .max(CLAIM_KEY_MAX_LENGTH)
      .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/),
  value: z.unknown().nullable().optional(),
  status: (schema) => schema.default("active"),
  correctionReason: (schema) => schema.trim().min(1).optional(),
  recordedBy: (schema) => schema.trim().min(1).optional(),
  generatedByVersion: (schema) => schema.trim().min(1).optional(),
  evidenceRefs: z.array(AccountClaimEvidenceReferenceSchema).default([]),
}).omit({
  id: true,
  createdAt: true,
});
export type InsertAccountClaim = z.infer<typeof insertAccountClaimSchema>;
export type AccountClaim = typeof accountClaims.$inferSelect;
