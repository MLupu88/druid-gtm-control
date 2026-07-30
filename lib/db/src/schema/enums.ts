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
// Mirrors the seven-value OUTPUT_TYPES enum already established in the
// frontend contract (lib/gtm-shared/src/gtmContract.js) so the eventual
// Phase 3 decision/routing policy has a stable, already-familiar target
// shape to write into — this table does not yet compute these values.
export const routingOutput = pgEnum("routing_output", [
  "mql",
  "sales_review",
  "pipeline_assist",
  "owner_alert",
  "retarget",
  "nurture",
  "suppressed",
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
