// Milestone 3B — provider-neutral observation contract.
//
// A ProviderObservation is one atomic claim a provider adapter makes about
// an account, person, or event, before any cross-provider agreement/
// conflict resolution or canonical-fact promotion happens (that is 3D/3F
// scope, not this package's). This package defines the SHAPE only — no
// persistence, no network calls, no dependency on lib/db, lib/evaluator, or
// lib/identity (same pure-package stance those already document for
// themselves; see lib/identity/src/types.ts's own header comment).
//
// Discriminated union, not one loose bag-of-fields object: shared
// provenance (provider, timestamps, evidence, confidence) lives on every
// branch; the semantic payload is branch-specific, so only the fields that
// actually make sense for a given observationClass are representable at
// all. A firmographic_fact literally cannot be constructed without a
// canonicalField, and a research_intelligence observation literally cannot
// carry one, because the branches don't share that key.
//
// No business taxonomy is defined here — no industry values, no region
// codes, no closed list of canonical field names, no confidence
// normalization rules. That is Milestone 3C's job. Wherever this package
// needs "the name of a canonical field" or "the name of an event type," it
// accepts any non-blank string; validating it against a closed vocabulary
// is 3C/3D's concern, not this contract's.

import { z } from "zod/v4";

// ---------------------------------------------------------------------
// Shared primitives — redeclared, not imported, matching this repo's
// existing convention of keeping cross-cutting pure packages independent
// of one another (lib/identity redeclares rather than imports
// lib/evaluator's equivalents; see lib/identity/src/types.ts's own comment
// on that tradeoff).
// ---------------------------------------------------------------------

const NonBlankString = z.string().trim().min(1).max(500);

// Evidence refs and identity values may legitimately be URLs or longer
// opaque provider ids — a plain 500-char NonBlankString is too tight
// (mirrors lib/identity's NonBlankUrlString rationale).
const NonBlankLongString = z.string().trim().min(1).max(4096);

// RFC 3339 / ISO 8601, timezone-aware — mirrors lib/identity's
// SignalOccurredAtV1 exactly, redeclared here for the same independence
// reason as NonBlankString above.
const TimestampV1 = z.string().datetime({ offset: true });

// Any valid JSON value. rawValue/normalizedValue hold whatever shape the
// provider actually returned (or a normalized derivative of it) — this is
// intentionally permissive, unlike providerMetadata's role (see the
// envelope below): rawValue *is* the observation's payload, not an escape
// hatch for one.
type JsonValueV1 =
  | string
  | number
  | boolean
  | null
  | JsonValueV1[]
  | { [key: string]: JsonValueV1 };
const JsonValueV1Schema: z.ZodType<JsonValueV1> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueV1Schema),
    z.record(z.string(), JsonValueV1Schema),
  ]),
);

// ---------------------------------------------------------------------
// Observation class
// ---------------------------------------------------------------------

export const ObservationClassV1 = z.enum([
  "identity",
  "firmographic_fact",
  "crm_state",
  "behavioral_signal",
  "research_intelligence",
]);
export type ObservationClassV1 = z.infer<typeof ObservationClassV1>;

// A semantic, provider-neutral confidence LEVEL — never a fabricated
// numeric score. Not every provider can honestly produce a calibrated
// 0..1 probability (the verified 3A.5 HubSpot capability audit found no
// such score on its company-property or contact-analytics APIs); forcing
// one here would manufacture false precision. A provider's own native
// numeric confidence, if it has one, belongs in providerMetadata until
// normalization is explicitly defined (3C+).
export const ConfidenceLevelV1 = z.enum(["low", "medium", "high"]);
export type ConfidenceLevelV1 = z.infer<typeof ConfidenceLevelV1>;

export const EvidenceRefV1Schema = z
  .object({
    type: NonBlankString, // e.g. "client_radar_evidence_item", "hubspot_record_url"
    ref: NonBlankLongString, // an id or URL — a pointer, never a copy of the evidence itself
  })
  .strict();
export type EvidenceRefV1 = z.infer<typeof EvidenceRefV1Schema>;

// ---------------------------------------------------------------------
// Shared envelope — every field here means the same thing regardless of
// observationClass. Nothing semantic (canonicalField, rawValue, eventType,
// ...) lives here; that only exists on the class-specific branches below.
// ---------------------------------------------------------------------

const ProviderObservationEnvelopeV1 = z.object({
  schemaVersion: z.literal("v1"),

  // Open string, not a closed enum: adding RB2B/Dealfront/Cognism must
  // never require a schema change here (see NEXT_SESSION.md's Milestone 3
  // "future-provider constraint"). Reconciliation/persistence code must
  // never branch on this value's literal content (e.g. `if (provider ===
  // "hubspot")`) — provider-specific behavior belongs entirely inside an
  // adapter, upstream of this contract.
  provider: NonBlankString,

  // The provider's own identifier for the record this observation was
  // read from. Deliberately NOT assumed unique per observation by itself —
  // see computeObservationIdentityKey in ./idempotency.ts for why and for
  // the full derivation.
  //
  // REQUIRED INVARIANT — for any class where the same subject can
  // legitimately produce more than one observation carrying the SAME
  // semantic key (concretely: behavioral_signal, where one contact/visitor
  // can generate many events of the same eventType, e.g. repeated
  // "page_view"s), sourceRecordId MUST identify that individual
  // event/observation record, never merely the account/person subject it
  // is about. A subject-level id (e.g. a HubSpot contact id) used as
  // sourceRecordId for a behavioral_signal is a misuse of this field: every
  // "page_view" from that contact would then derive the identical identity
  // key and silently collapse into one. If a provider exposes a stable
  // per-event id, use it; if it does not, the ADAPTER (3E) — never this
  // package — is responsible for deterministically deriving one from
  // stable event attributes, exactly as lib/identity's NormalizedSignalV1
  // already requires of sourceEventId ("Adapters whose provider doesn't
  // emit a stable event ID MUST synthesize one deterministically... never
  // random per delivery attempt," lib/identity/src/types.ts). This
  // contract cannot enforce that requirement structurally (a bare string
  // cannot be validated for real-world per-event uniqueness by itself) —
  // it is a caller/adapter obligation, documented here as the source of
  // truth. See BehavioralSignalObservationV1Schema's own comment below.
  sourceRecordId: NonBlankString,

  // When the provider claims this became true/happened. Nullable: the
  // verified 3A.5 HubSpot capability audit found provider APIs (HubSpot's
  // company-property endpoint) that expose no trustworthy field-level
  // observation timestamp — only a whole-record last-modified time that
  // does not necessarily correspond to when any one property changed. Do
  // not backfill this from a record-level modified-time as if it were a
  // field-level fact — leave it null instead.
  observedAt: TimestampV1.nullable(),

  // When GTM ingested this observation. Always known (server-generated at
  // ingestion time), so always required — unlike observedAt.
  importedAt: TimestampV1,

  confidence: ConfidenceLevelV1.nullable(),

  evidenceRefs: z.array(EvidenceRefV1Schema).max(20),

  // The ONLY place a provider's native payload shape may leak through.
  // This must never become a second canonical data model: nothing outside
  // an adapter may read a specific key out of providerMetadata and treat
  // it as ground truth — any value another layer needs to reason about
  // belongs in a named, class-specific field below instead, not buried
  // here.
  providerMetadata: z.record(z.string(), z.unknown()).nullable(),
});

// ---------------------------------------------------------------------
// Class-specific branches
// ---------------------------------------------------------------------

// An identity assertion — "this provider says this account/person is
// identified by this key/value pair." Never a canonical account fact:
// canonical identity (accounts.account_key/company_domain) and identity
// resolution (identity_resolution_events) remain lib/db's authority. This
// is only ever a candidate the resolution layer may later consult.
export const IdentityObservationV1Schema = ProviderObservationEnvelopeV1.extend(
  {
    observationClass: z.literal("identity"),
    subjectType: z.enum(["account", "person"]),
    // The KIND of identifier being asserted, e.g. "domain", "email",
    // "hubspot_company_id", "linkedin_url". An open string, not a closed
    // enum — the closed identifier vocabulary is 3C's job, same rationale
    // as canonicalField below.
    identityKey: NonBlankString,
    identityValue: NonBlankLongString,
  },
).strict();
export type IdentityObservationV1 = z.infer<typeof IdentityObservationV1Schema>;

// A firmographic company fact — "this provider read this company property
// as this value." canonicalField is required and non-blank: a
// firmographic_fact observation with no target field is meaningless. The
// field-NAME vocabulary itself (the closed list a value like
// "company.industry" is drawn from) is intentionally not defined here —
// see lib/db's ACCOUNT_FACT_FIELDS for today's canonical-fact vocabulary
// and NEXT_SESSION.md's 3C for where this contract's own vocabulary gets
// formalized.
export const FirmographicFactObservationV1Schema =
  ProviderObservationEnvelopeV1.extend({
    observationClass: z.literal("firmographic_fact"),
    canonicalField: NonBlankString,
    rawValue: JsonValueV1Schema,
    normalizedValue: JsonValueV1Schema.nullable(),
  }).strict();
export type FirmographicFactObservationV1 = z.infer<
  typeof FirmographicFactObservationV1Schema
>;

// CRM/pipeline state — ownership, lifecycle stage, deal/opportunity
// existence, and similar operational CRM facts. Kept as its own class,
// separate from firmographic_fact, because these values describe the
// provider's own operational state about the account (who owns it, what
// stage it's in), not a fact about the company itself — the two must
// never be reconciled by the same agreement/conflict logic (3F) as if
// they were interchangeable evidence for the same question.
export const CrmStateObservationV1Schema = ProviderObservationEnvelopeV1.extend(
  {
    observationClass: z.literal("crm_state"),
    canonicalField: NonBlankString,
    rawValue: JsonValueV1Schema,
    normalizedValue: JsonValueV1Schema.nullable(),
  },
).strict();
export type CrmStateObservationV1 = z.infer<
  typeof CrmStateObservationV1Schema
>;

// A behavioral/activity event — "this happened." Structurally has no
// canonicalField at all (not merely a null one): a page view is not a
// company fact and must never be representable as one. This class is a
// sibling to, not a replacement for, lib/identity's already-shipped
// NormalizedSignalV1 signal-ingestion contract — 3B does not touch that
// contract or its ingestion path; a future adapter may translate between
// the two, but that translation lives outside this package.
//
// eventType alone does not distinguish two occurrences of the same kind
// of event from the same subject (two "page_view"s from one visitor both
// have eventType "page_view"). What makes them distinct observations is
// sourceRecordId — see the envelope's sourceRecordId comment above for the
// required invariant: it must identify the individual event record, not
// the subject.
export const BehavioralSignalObservationV1Schema =
  ProviderObservationEnvelopeV1.extend({
    observationClass: z.literal("behavioral_signal"),
    // e.g. "page_view", "form_submit", "email_open", "known_contact_visit".
    // Open string for the same reason identityKey/canonicalField are.
    eventType: NonBlankString,
    rawValue: JsonValueV1Schema,
    normalizedValue: JsonValueV1Schema.nullable(),
  }).strict();
export type BehavioralSignalObservationV1 = z.infer<
  typeof BehavioralSignalObservationV1Schema
>;

// Unstructured/semi-structured research output (e.g. Client Radar).
// Explicitly non-canonical: no canonicalField exists on this branch at
// all, matching the current, verified rule that Client Radar research
// never writes account_facts directly (account_facts.source is DB-CHECK-
// locked to 'manual-operator-v1'). Evidence is required, not optional —
// see the module-level superRefine below.
export const ResearchIntelligenceObservationV1Schema =
  ProviderObservationEnvelopeV1.extend({
    observationClass: z.literal("research_intelligence"),
    // What kind of finding this is, e.g. "company_summary",
    // "competitor_mention", "hiring_signal" — open string, not a closed
    // enum, same rationale as eventType/identityKey/canonicalField.
    findingType: NonBlankString,
    rawValue: JsonValueV1Schema,
    normalizedValue: JsonValueV1Schema.nullable(),
  }).strict();
export type ResearchIntelligenceObservationV1 = z.infer<
  typeof ResearchIntelligenceObservationV1Schema
>;

// ---------------------------------------------------------------------
// ProviderObservationV1 — the combined discriminated union
// ---------------------------------------------------------------------

export const ProviderObservationV1Schema = z
  .discriminatedUnion("observationClass", [
    IdentityObservationV1Schema,
    FirmographicFactObservationV1Schema,
    CrmStateObservationV1Schema,
    BehavioralSignalObservationV1Schema,
    ResearchIntelligenceObservationV1Schema,
  ])
  .superRefine((val, ctx) => {
    // Research findings without any evidence pointer are not usable
    // research — mirrors this repo's existing "no ghost contact" rule
    // (lib/identity's NormalizedSignalV1 person check), applied to
    // evidence instead of identity.
    if (
      val.observationClass === "research_intelligence" &&
      val.evidenceRefs.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message:
          "research_intelligence observations require at least one evidenceRef",
      });
    }
  });
export type ProviderObservationV1 = z.infer<typeof ProviderObservationV1Schema>;
