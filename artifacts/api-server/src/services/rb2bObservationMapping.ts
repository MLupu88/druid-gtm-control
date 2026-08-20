// Milestone 3E.2a — Mission Control RB2B observation ingestion contract.
//
// This module owns ONLY the repository-side bridge contract: validating
// the inbound request shape and mapping it into a behavioral_signal
// ProviderObservationV1 candidate. It does NOT derive sourceRecordId or
// importedAt — both are caller-supplied (source_record_id,
// ingestion_attempt_at) and passed through exactly as received.
//
// This is deliberate, not an oversight: no real RB2B execution payload
// has ever been inspected (see NEXT_SESSION.md's 3E.2 checkpoint), the
// current n8n RB2B mapper's own raw field names are still unverified, and
// its timestamp is generated locally rather than being a confirmed
// provider event time. Deriving either value here — e.g. via a raw-body
// fingerprint hash — was explicitly proposed and explicitly rejected
// during the 3E.2 design pass for exactly this reason. Milestone 3E.2b
// (the n8n fan-out that must supply defensible values for both) is
// deferred until that verification happens; this module has no opinion
// on how the caller produces them, only that it must.
//
// Reuses ProviderObservationV1Schema (imported from @workspace/observation,
// never redefined) as the single source of truth for observation-shape
// and timestamp-format validation — see ../routes/rb2bSignalBridge.ts,
// which re-validates this function's output against that schema before
// ever calling recordObservation(). This module's own Zod schema below
// validates only the inbound REQUEST shape, not the outbound observation
// shape — the two are deliberately not conflated into one validation
// pass, mirroring ../services/signals.ts's own request-vs-contract split.

import { z } from "zod/v4";
import type { BehavioralSignalObservationV1 } from "@workspace/observation";

// Every optional field below mirrors ICP 01's already-identified
// normalized RB2B signal fields (see NEXT_SESSION.md's 3E.2 design
// checkpoint). None is individually format-constrained beyond "non-blank
// string when present" — no real RB2B payload has been received, so this
// module does not assume any field's real-world shape beyond what has
// already been captured as the working design.
//
// .passthrough() (not .strict()) is deliberate: an additional normalized
// context field this schema hasn't explicitly enumerated must not cause
// the whole ingestion attempt to be rejected — the four required control
// fields are what this contract actually depends on; everything else is
// carried through into rawValue for fidelity, not gatekept.
export const Rb2bSignalBridgeRequestSchema = z
  .object({
    source: z.literal("rb2b"),
    signal_type: z.string().trim().min(1).max(500),
    source_record_id: z.string().trim().min(1).max(500),
    ingestion_attempt_at: z.string().trim().min(1),
    provider_observed_at: z.string().trim().min(1).nullable().optional(),
    company_domain: z.string().nullable().optional(),
    company_name: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    industry: z.string().nullable().optional(),
    contact_email: z.string().nullable().optional(),
    contact_name: z.string().nullable().optional(),
    contact_title: z.string().nullable().optional(),
    contact_phone: z.string().nullable().optional(),
    linkedin: z.string().nullable().optional(),
    page_visited: z.string().nullable().optional(),
    signal_detail: z.string().nullable().optional(),
    campaign: z.string().nullable().optional(),
    keyword: z.string().nullable().optional(),
    resolution_level: z.string().nullable().optional(),
    stream: z.string().nullable().optional(),
  })
  .passthrough();
export type Rb2bSignalBridgeRequest = z.infer<
  typeof Rb2bSignalBridgeRequestSchema
>;

/**
 * Maps a validated Rb2bSignalBridgeRequest into a behavioral_signal
 * ProviderObservationV1 candidate. Pure — no DB, no network, no
 * timestamp-format enforcement (that is ProviderObservationV1Schema's
 * job, applied by the caller — see module comment). rawValue is the
 * COMPLETE validated inbound DTO, including the control fields
 * (source/signal_type/source_record_id/ingestion_attempt_at) — nothing is
 * stripped before storage.
 */
export function mapRb2bSignalToObservation(
  dto: Rb2bSignalBridgeRequest,
): BehavioralSignalObservationV1 {
  return {
    schemaVersion: "v1",
    provider: "rb2b",
    sourceRecordId: dto.source_record_id,
    observationClass: "behavioral_signal",
    eventType: dto.signal_type,
    rawValue: dto as unknown as BehavioralSignalObservationV1["rawValue"],
    normalizedValue: null,
    observedAt: dto.provider_observed_at ?? null,
    importedAt: dto.ingestion_attempt_at,
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
}
