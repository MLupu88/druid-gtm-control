// Milestone 3B — observation identity derivation.
//
// This package does not persist anything (3D does), so there is no DB
// uniqueness constraint here. But sourceRecordId alone is not a safe
// identity for every observation: one HubSpot company record (one
// sourceRecordId) legitimately produces many observations — industry,
// country, employee count, lifecycle stage, and more, all read from the
// same live company `57634473634` during the 3A.5 capability audit. A
// naive (provider, sourceRecordId) key would silently collapse all of
// those into one. computeObservationIdentityKey below fixes this for that
// case by adding a class-specific semantic key (canonicalField).
//
// This does NOT fix the mirror-image failure for behavioral_signal (and
// equally for research_intelligence): if an adapter mistakenly sets
// sourceRecordId to a SUBJECT id (e.g. a HubSpot contact id) rather than
// the individual event/record id, then every event of the same eventType
// from that subject shares both sourceRecordId AND semanticKey, and this
// function will — correctly, given its inputs — compute the identical key
// for genuinely distinct events. This function cannot detect or prevent
// that misuse; it can only combine what it is given. The obligation is on
// the caller/adapter: sourceRecordId must already identify the specific
// event/observation record for these classes. See types.ts's sourceRecordId
// and BehavioralSignalObservationV1Schema comments for the full invariant,
// and idempotency.test.ts for a demonstration of both the correct pattern
// and this exact misuse.
//
// computeObservationIdentityKey documents and implements the actual
// intended identity: provider + observationClass + sourceRecordId + a
// class-specific semantic key that distinguishes multiple observations
// sharing the same sourceRecordId. 3D is expected to enforce this (or an
// equivalent) as a real persistence constraint; this function is meant to
// stay the single source of truth for what "the same observation, ingested
// again" means, so adapters, tests, and the eventual DB constraint cannot
// silently drift apart.

import type { ProviderObservationV1 } from "./types.js";

// The part of the identity that varies by observationClass. Exported
// (Milestone 3D) as getObservationSemanticKey below — persistence needs
// this exact component as its own physical column (see lib/db's
// observations.semantic_key), not just as one ingredient folded into the
// opaque joined string computeObservationIdentityKey returns. Callers
// that only need to compare two observations for identity should still
// prefer computeObservationIdentityKey; this exists specifically so 3D
// never has to re-derive or parse/split that opaque string to recover
// this value.
export function getObservationSemanticKey(
  observation: ProviderObservationV1,
): string {
  switch (observation.observationClass) {
    case "identity":
      return observation.identityKey;
    case "firmographic_fact":
    case "crm_state":
      return observation.canonicalField;
    case "behavioral_signal":
      return observation.eventType;
    case "research_intelligence":
      return observation.findingType;
  }
}

// Deliberately an opaque joined string, not a structured object — callers
// must treat this as an equality-comparable key only, never parse it back
// apart. The separator and field order are not part of any public
// contract and may change; only equality/inequality of the whole key is
// meaningful.
export function computeObservationIdentityKey(
  observation: ProviderObservationV1,
): string {
  return [
    observation.provider,
    observation.observationClass,
    observation.sourceRecordId,
    getObservationSemanticKey(observation),
  ].join("␟"); // U+241F SYMBOL FOR UNIT SEPARATOR — unlikely to collide with real field content
}
