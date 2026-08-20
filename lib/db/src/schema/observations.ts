// Milestone 3D — provider-neutral candidate observation persistence.
//
// Persists lib/observation's ProviderObservationV1 contract (Milestone 3B,
// closed vocabularies added in 3C). Deliberately carries NO account_id/
// person_id: this table never claims a canonical account/person binding —
// the contract itself has no subject field, and this table follows the
// one existing precedent in this schema for genuinely pre-resolution
// evidence, signals.ts, rather than the account_id-NOT-NULL convention
// every other event/record table here uses. Canonical subject binding is
// Milestone 3F's job, via a separate resolution/link mechanism mirroring
// signals -> identity_resolution_events — never a mutation of this row.
//
// Append-only: a database trigger (observations_immutable, reusing the
// existing reject_update_delete() function — see
// drizzle/0001_integrity_triggers.sql) rejects UPDATE and DELETE, the same
// mechanism signals/identity_resolution_events/account_facts already use.
//
// semantic_key is the flattened, class-varying component
// computeObservationIdentityKey (lib/observation) folds into its opaque
// key — identityKey / canonicalField / canonicalField / eventType /
// findingType depending on observation_class. It is derived at the
// service layer via lib/observation's exported getObservationSemanticKey,
// never recomputed or re-parsed here. It must be a real column (not
// buried in JSONB) because it participates in the occurrence-uniqueness
// index below and in the branch-specific CHECK immediately after it.
//
// identity_subject_type / identity_value hold the `identity` branch's
// payload (subjectType/identityValue in the contract); raw_value /
// normalized_value hold the other four branches' payload. These are
// mutually exclusive by observation_class — see
// observations_identity_payload_shape below. raw_value is intentionally
// NULLABLE at the column level (identity rows have none at all — the
// contract has no rawValue field on that branch, so storing identityValue
// inside raw_value as a fake JSON string would misrepresent the shape);
// for every non-identity row it is required NOT NULL by that same CHECK.
// A JSON literal null ('null'::jsonb) is a valid raw_value CONTENT for a
// non-identity row (JsonValueV1 permits null as a member value) and is
// distinct from the column itself being SQL NULL — the CHECK only forbids
// the latter.
//
// imported_at is caller-supplied, NOT server-defaulted (no defaultNow()):
// it is assigned once by the ingesting service at the ingestion boundary
// and MUST be preserved unchanged across any retry of that same ingestion
// attempt — see recordObservation() in
// ../../../artifacts/api-server/src/services/observations.ts, which is
// the only enforcement point for this invariant (nothing here can enforce
// "the same value across two separate statements" at the schema level).
//
// Occurrence vs. semantic identity: computeObservationIdentityKey's
// (provider, observationClass, sourceRecordId, semanticKey) is
// deliberately NOT globally unique in this table — many rows may
// legitimately share it over time (the same HubSpot company's industry,
// re-read on a later sync, possibly with a changed value). The unique
// index below adds imported_at to that tuple: one ingestion OCCURRENCE is
// unique, not one semantic slot. Reasoning over many occurrences sharing
// one semantic identity (which value is current, how it changed over
// time) is explicitly Milestone 3F's job, not persisted or computed here.

import { sql } from "drizzle-orm";
import {
  check,
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
import { observationClass, observationConfidence } from "./enums";

export const observations = pgTable(
  "observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Open text, not a closed enum — mirrors signals.source exactly:
    // adding RB2B/Dealfront/Cognism must never require a schema change
    // here. Canonicalized (lower/trim) at the service layer before
    // insert, same as signals.source.
    provider: text("provider").notNull(),

    sourceRecordId: text("source_record_id").notNull(),

    observationClass: observationClass("observation_class").notNull(),

    // See module comment. Closed-list CHECK below is scoped per class —
    // never one combined list, so an identity key can never validate
    // under crm_state or vice versa.
    semanticKey: text("semantic_key").notNull(),

    // `identity` branch payload only.
    identitySubjectType: text("identity_subject_type"),
    identityValue: text("identity_value"),

    // Every other branch's payload. Nullable at the column level for the
    // reason in the module comment; required NOT NULL for non-identity
    // rows by the CHECK below.
    rawValue: jsonb("raw_value"),
    normalizedValue: jsonb("normalized_value"),

    observedAt: timestamp("observed_at", { withTimezone: true }),

    // No .defaultNow() — see module comment. Caller-supplied.
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),

    // NEW observation_confidence enum — never identity_confidence. See
    // enums.ts's comment on why the two must not be coupled.
    confidence: observationConfidence("confidence"),

    // $type annotations mirror clientRadarResearchRuns.ts's own
    // evidencePayload/accountPayload columns exactly — structural TS
    // typing only, no cross-package import (lib/db does not depend on
    // lib/observation, matching this file's other primitives).
    evidenceRefs: jsonb("evidence_refs").$type<unknown[]>().notNull().default([]),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    check("observations_provider_not_blank", sql`trim(${t.provider}) <> ''`),
    // The database itself refuses a non-canonical provider value, not
    // just trust that the service layer lowercased/trimmed it first —
    // mirrors signals_source_is_canonical_form exactly.
    check(
      "observations_provider_is_canonical_form",
      sql`${t.provider} = lower(trim(${t.provider}))`,
    ),
    check(
      "observations_source_record_id_not_blank",
      sql`trim(${t.sourceRecordId}) <> ''`,
    ),
    check(
      "observations_semantic_key_not_blank",
      sql`trim(${t.semanticKey}) <> ''`,
    ),
    // Branch-specific closed vocabularies (lib/observation's IdentityKeyV1
    // / FirmographicCanonicalFieldV1 / CrmCanonicalFieldV1, Milestone 3C).
    // Deliberately NOT one combined IN-list: each closed class gets its
    // own scoped clause, so e.g. semantic_key = 'domain' can only ever
    // validate when observation_class = 'identity', never under
    // crm_state or firmographic_fact. behavioral_signal/research_intelligence
    // stay open (3C's deliberate deferral — no verified provider data for
    // either yet) — not case-normalized either, since these are free-form
    // event/finding-type labels, not lowercase system identifiers like
    // signals.source/attention_items.reason_code.
    //
    // NOTE: semantic_key is intentionally NOT forced to lower(trim()) the
    // way signals.source/attention_items.reason_code are — the closed
    // firmographic_fact/crm_state vocabularies are legitimately mixed-case
    // (e.g. "company.employeeRange", "crm.lifecycleStage"); lowercasing
    // would break exact-match against lib/observation's own Zod enums.
    check(
      "observations_semantic_key_allowed_for_class",
      sql`
        (${t.observationClass} = 'identity' AND ${t.semanticKey} IN ('domain', 'external_id'))
        OR (${t.observationClass} = 'firmographic_fact' AND ${t.semanticKey} IN (
          'company.industry', 'company.country', 'company.region',
          'company.employeeRange', 'company.revenueRange'
        ))
        OR (${t.observationClass} = 'crm_state' AND ${t.semanticKey} IN (
          'crm.owner', 'crm.lifecycleStage', 'crm.openOpportunity',
          'crm.existingCustomer', 'crm.competitorFlag', 'crm.partnerFlag'
        ))
        OR (${t.observationClass} IN ('behavioral_signal', 'research_intelligence'))
      `,
    ),
    check(
      "observations_identity_subject_type_allowed",
      sql`${t.identitySubjectType} IS NULL OR ${t.identitySubjectType} IN ('account', 'person')`,
    ),
    // The one payload-shape invariant this table enforces: `identity`
    // rows carry identity_subject_type/identity_value and NEITHER
    // raw_value NOR normalized_value (the contract has no such fields on
    // that branch); every other class carries raw_value (required) and
    // never the identity columns. See module comment for the
    // JSON-null-vs-SQL-NULL distinction on raw_value.
    check(
      "observations_identity_payload_shape",
      sql`
        (${t.observationClass} = 'identity'
          AND ${t.identitySubjectType} IS NOT NULL
          AND ${t.identityValue} IS NOT NULL AND trim(${t.identityValue}) <> ''
          AND ${t.rawValue} IS NULL
          AND ${t.normalizedValue} IS NULL)
        OR
        (${t.observationClass} <> 'identity'
          AND ${t.identitySubjectType} IS NULL
          AND ${t.identityValue} IS NULL
          AND ${t.rawValue} IS NOT NULL)
      `,
    ),
    check(
      "observations_evidence_refs_is_array",
      sql`jsonb_typeof(${t.evidenceRefs}) = 'array'`,
    ),
    check(
      "observations_provider_metadata_is_object",
      sql`${t.providerMetadata} IS NULL OR jsonb_typeof(${t.providerMetadata}) = 'object'`,
    ),
    // The occurrence-uniqueness guarantee: computeObservationIdentityKey's
    // semantic identity (provider, observation_class, source_record_id,
    // semantic_key) is deliberately NOT unique alone — imported_at
    // completes the tuple into "one ingestion occurrence." All five
    // columns are NOT NULL, so there is no Postgres NULL-uniqueness
    // ambiguity here (contrast with account_aliases' partial unique
    // indexes, needed there specifically because of nullable columns).
    uniqueIndex("observations_occurrence_uq").on(
      t.provider,
      t.observationClass,
      t.sourceRecordId,
      t.semanticKey,
      t.importedAt,
    ),
    // The leading 4 columns of the index above already form a usable
    // btree prefix for "every occurrence of this semantic slot, ordered
    // by imported_at" queries (Milestone 3F's eventual read pattern) — no
    // separate index needed for that.
    index("observations_provider_source_record_id_idx").on(
      t.provider,
      t.sourceRecordId,
    ),
  ],
);

// Unlike most insert schemas in this package, importedAt is NOT omitted —
// it is caller-supplied per the ingestion-boundary invariant (module
// comment), never server-generated. id is the only server-generated
// column.
export const insertObservationSchema = createInsertSchema(observations, {
  provider: (schema) => schema.trim().min(1),
  sourceRecordId: (schema) => schema.trim().min(1),
  semanticKey: (schema) => schema.trim().min(1),
  identitySubjectType: (schema) => schema.nullable(),
  identityValue: (schema) => schema.trim().min(1).nullable(),
  rawValue: z.unknown().nullable(),
  normalizedValue: z.unknown().nullable(),
  evidenceRefs: z.array(z.unknown()).default([]),
  providerMetadata: z.record(z.string(), z.unknown()).nullable(),
}).omit({
  id: true,
});
export type InsertObservation = z.infer<typeof insertObservationSchema>;
export type Observation = typeof observations.$inferSelect;
