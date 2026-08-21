// Shared PostgreSQL enum types for the Package 2 ICP profile/evaluation
// schema. Centralized because Postgres enum type names are global to the
// database — declaring them once here avoids accidental name collisions
// or divergent definitions across table files.

import { pgEnum } from "drizzle-orm/pg-core";

// icp_profile_versions.status
// A version is a mutable "draft" exactly once, then transitions to
// "published" exactly once (one-way). There is no "active"/"archived"
// value here — whether a published version is currently active is a
// property of icp_profiles.active_version_id (a pointer), not of the
// version row itself. See icpProfileVersions.ts for the immutability
// trigger this enum participates in.
export const icpProfileVersionStatus = pgEnum("icp_profile_version_status", [
  "draft",
  "published",
]);

// icp_profile_activation_events.event_type
export const activationEventType = pgEnum("activation_event_type", [
  "activated",
  "deactivated",
]);

// account_evaluations.evaluation_mode
// "production" evaluations must reference a published ICP profile version
// and are the only evaluations account_decisions may reference. "preview"
// evaluations may reference a draft or published version and exist purely
// for impact-preview workflows (ROADMAP Package 2, Phase 5) — they must
// never feed a real routing decision.
export const evaluationMode = pgEnum("evaluation_mode", [
  "preview",
  "production",
]);

// account_evaluations.status
// Only two terminal values: evaluations are insert-only, so a row is only
// ever durably written once its outcome — success or failure — is already
// known. There is no "pending" state to persist; that only exists
// transiently in application memory before a row is written at all.
export const evaluationStatus = pgEnum("evaluation_status", [
  "completed",
  "failed",
]);

// account_evaluations.identity_resolution_level
// What kind of subject was resolved — an anonymous visitor, a company-only
// match, an individual contact, or a contact already known in the CRM.
// Deliberately does not distinguish *how* a contact was resolved (e.g.
// reconstructed via enrichment vs. directly self-identified) — that
// provenance detail belongs in matched_rules/score_components/structured
// identity evidence, not in this enum. Kept separate from
// identity_confidence below: resolution level is "what was found",
// confidence is "how sure we are of it".
export const identityResolutionLevel = pgEnum("identity_resolution_level", [
  "anonymous",
  "company",
  "contact",
  "known_crm_contact",
]);

// account_evaluations.identity_confidence
// How confident the evaluator is in the resolved identity, independent of
// what level it resolved to. Kept coarse (low/medium/high) on purpose —
// this is a canonical evaluator output, not a place to encode legacy
// per-source reconstruction logic.
export const identityConfidence = pgEnum("identity_confidence", [
  "low",
  "medium",
  "high",
]);

// account_evaluations.eligibility_outcome
export const eligibilityOutcome = pgEnum("eligibility_outcome", [
  "eligible",
  "restricted",
  "ineligible",
]);

// account_decisions.routing_output
// The first seven values mirror the OUTPUT_TYPES enum already established
// in the frontend contract (lib/gtm-shared/src/gtmContract.js) so the
// eventual Phase 3 decision/routing policy has a stable, already-familiar
// target shape to write into — this table does not yet compute those
// values. "dismissed" is the one value with no OUTPUT_TYPES counterpart:
// it represents an operator's local "Dismiss" action in the queue UI
// (gtmContract.js's BUTTONS.dismiss), added so that action can persist a
// real, queryable canonical decision instead of only a local UI toggle.
export const routingOutput = pgEnum("routing_output", [
  "mql",
  "sales_review",
  "pipeline_assist",
  "owner_alert",
  "retarget",
  "nurture",
  "suppressed",
  "dismissed",
]);

// account_decisions.overall_decision_gate
// A deliberately new name and a deliberately new three-value vocabulary —
// NOT the legacy "passed/warning/failed" gate_status carried by either
// legacy n8n engine. Phase 0 discovery (docs/icp-rule-discovery.md,
// CONFLICT-01) found that "gate_status" meant two different things on the
// two legacy queue paths. This column is owned exclusively by the
// decision/routing policy layer (Phase 3, not yet built) and must be
// computed fresh from evaluation-layer restrictions/disqualifiers plus
// decision-time context — never inherited from legacy gate_status values.
export const decisionGate = pgEnum("decision_gate", [
  "actionable",
  "restricted",
  "blocked",
]);

// client_radar_research_runs.status
// The absence of a research-run row means the account has never been
// researched — there is no "not_created" value here because that state is
// represented by no row existing at all. "submitting" is the local state
// before Client Radar has returned a run ID; "queued", "running",
// "completed", "failed", and "cancelled" mirror Client Radar's own
// canonical run statuses exactly. Deliberately excludes "created",
// "scanning", and "stale" — those are not states Client Radar's API
// reports.
export const clientRadarResearchStatusEnum = pgEnum(
  "client_radar_research_status",
  ["submitting", "queued", "running", "completed", "failed", "cancelled"],
);

// GTM V2 Unit 1 — Operational Identity and Signal Contracts.
//
// account_aliases.normalization_strategy
// Domains and free-text labels (e.g. a company name) are case-
// insensitive; source/provider identifiers (e.g. a HubSpot company ID)
// may be case-sensitive, and lowercasing them could silently merge two
// distinct identifiers. This is an explicit per-row choice rather than
// something derived from alias_type (which stays an open, uncontrolled
// vocabulary — see accountAliases.ts) precisely so that choice is always
// visible and enforceable by a CHECK, not inferred.
export const identityAliasNormalizationStrategy = pgEnum(
  "identity_alias_normalization_strategy",
  ["domain", "case_insensitive", "exact"],
);

// identity_resolution_events.outcome
// Every row is a complete binding snapshot, not a partial delta — see
// identityResolutionEvents.ts. "account_resolved" and "person_resolved"
// both require account_id; only "person_resolved" additionally requires
// person_id, so the latest row for a signal is always self-sufficient
// (never "person matched but which account?").
export const identityResolutionOutcome = pgEnum("identity_resolution_outcome", [
  "unresolved",
  "account_resolved",
  "person_resolved",
]);

// identity_resolution_events.account_match_action /
// identity_resolution_events.person_match_action
// Records whether the account/person side of a binding was matched to
// an existing row or newly created, without splitting that distinction
// into separate partial event rows.
export const identityMatchAction = pgEnum("identity_match_action", [
  "matched",
  "created",
]);

// GTM V2 Stage 3, Unit 1 — Attention Model foundation.
//
// attention_items.source
// A closed, already-known set of producers — unlike signals.source (an
// open, uncontrolled integration vocabulary), the workflows that can ever
// raise an attention item are enumerated by this unit's own requirements:
// a human operator (manual) or one of five future automated integrations,
// none of which this unit implements. Extending this list later (should a
// genuinely new producer appear) is the same one-value ALTER TYPE this
// schema already did once for routing_output (see
// 0005_add_dismissed_routing_output.sql).
export const attentionSource = pgEnum("attention_source", [
  "manual",
  "identity_resolution",
  "evaluation",
  "enrichment",
  "client_radar",
  "action",
]);

// attention_items.status
// Exactly two states, one-way: an item is opened once and resolved once.
// There is no "dismissed" vs "resolved" distinction — how/why a resolution
// happened belongs in resolution_reason, not in a wider status vocabulary.
// Reopening is never modeled as a status transition; it means creating a
// new attention_items row (see attentionItems.ts).
export const attentionItemStatus = pgEnum("attention_item_status", [
  "open",
  "resolved",
]);

// Milestone 3D — provider-neutral observation persistence.
//
// observations.observation_class
// Closed by Milestone 3B/3C design (lib/observation's ObservationClassV1)
// — unlike observations.provider, which stays open text (see
// observations.ts), adding a new observation class is a deliberate
// contract change, not a per-provider extension, so a real Postgres enum
// is appropriate here the same way it is for every other closed,
// small, product-owned vocabulary in this file.
export const observationClass = pgEnum("observation_class", [
  "identity",
  "firmographic_fact",
  "crm_state",
  "behavioral_signal",
  "research_intelligence",
]);

// observations.confidence
// Deliberately a NEW, separate enum — not identity_confidence above.
// identity_confidence's own comment scopes it explicitly to "how
// confident the evaluator is in the resolved identity," consumed only by
// account_evaluations/identity_resolution_events; observations.confidence
// means something different for 4 of 5 observation classes (confidence in
// a firmographic fact, a CRM state read, a behavioral event, a research
// finding — none of which is identity-resolution confidence). The value
// set happens to coincide (low/medium/high, mirroring
// lib/observation's ConfidenceLevelV1) but that alone is not a reason to
// couple two semantically distinct vocabularies to one Postgres type.
export const observationConfidence = pgEnum("observation_confidence", [
  "low",
  "medium",
  "high",
]);

// Milestone 3F — provider-neutral fact reconciliation.
//
// resolved_facts.resolution_state
// The outcome of comparing every USABLE observation bound to one
// (account, canonicalField) pair. "single_source" and "agreement" always
// carry a canonical_value; "unresolved" never does (zero observations, or
// values genuinely not safely comparable yet — e.g. raw vs. banded
// employee/revenue strings). "conflict" means multiple observations
// disagree on the value — canonical_value is EITHER populated (the
// resolution policy found a deterministic, source-authority- or
// recency-justified winner) OR null (policy could not justify a winner;
// the conflict legitimately remains open) — see resolvedFacts.ts's own
// comment and factReconciliation.ts for the full policy. A conflict is
// never silently dropped to "unresolved" just because no winner was
// found — the state itself still records that multiple sources
// disagreed, which "unresolved" alone would lose.
export const factResolutionState = pgEnum("fact_resolution_state", [
  "single_source",
  "agreement",
  "conflict",
  "unresolved",
]);
