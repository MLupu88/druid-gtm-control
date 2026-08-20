// Milestone 3E.4 — Client Radar evidence-item observation mapping.
//
// Pure: one ClientRadarEvidenceItem + caller-supplied context + importedAt
// -> one ResearchIntelligenceObservationV1 candidate. No DB, no network.
// Mirrors ./hubSpotObservationMapping.ts's / ./rb2bObservationMapping.ts's
// pure-mapping pattern.
//
// One observation per EVIDENCE ITEM, not per research-run/account result:
// evidence.items[].id is Client Radar's own stable, provider-issued
// identifier — the strongest sourceRecordId available (see
// ../lib/clientRadarClient.ts's ClientRadarEvidenceItem), genuinely
// unique per finding, unlike RB2B (no native event id at all) or HubSpot
// (only a whole-record, not per-field, timestamp). This is deliberately
// NOT the account-level company/domain/industry/country summary
// (ClientRadarResultAccount's own top-level fields) — those remain
// firmographic_fact-shaped, out of this milestone's scope (Client
// Radar's role here is external research intelligence, not a
// firmographic source), and are a documented, still-open gap — see
// NEXT_SESSION.md's 3E.4 checkpoint.
//
// findingType is evidence_type.source_type verbatim when present (open
// string per Milestone 3C — no closed taxonomy invented; this repo has
// never enumerated Client Radar's actual source_type value set), falling
// back to a neutral, non-blank placeholder only because
// ResearchIntelligenceObservationV1's findingType is a required field —
// that fallback is a structural placeholder, not an invented business
// category.
//
// observedAt is evidence_item.created_at, tolerantly re-serialized to a
// valid offset-aware ISO-8601 string; if that can't be done safely, null
// — mirrors the same tolerant-parse-then-null-fallback pattern already
// used for RB2B's "Seen At" (never fabricate current time as
// provider-observed time). importedAt is caller-supplied, assigned once
// per Client Radar result-persistence attempt by the caller
// (../services/clientRadarResearchRuns.ts) and reused unchanged across
// every observation this module returns for one result — this module
// never generates or reads timestamps for importedAt itself.
//
// evidenceRefs always includes a pointer to the evidence item's own id
// (satisfies ResearchIntelligenceObservationV1's non-empty-evidence
// requirement without inventing anything — the item's own id is real and
// always present), plus a second ref to its url when Client Radar
// actually supplied one. No URL is ever invented.

import type {
  EvidenceRefV1,
  ResearchIntelligenceObservationV1,
} from "@workspace/observation";
import type { ClientRadarEvidenceItem } from "../lib/clientRadarClient.js";

const DEFAULT_FINDING_TYPE = "evidence_item";

export interface ClientRadarEvidenceContext {
  clientRadarAccountId: string | null;
  company: string;
  domain: string | null;
}

export interface MapClientRadarEvidenceToObservationArgs {
  evidenceItem: ClientRadarEvidenceItem;
  context: ClientRadarEvidenceContext;
  importedAt: string;
}

function tolerantObservedAt(createdAt: string): string | null {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function mapClientRadarEvidenceToObservation(
  args: MapClientRadarEvidenceToObservationArgs,
): ResearchIntelligenceObservationV1 {
  const { evidenceItem, context, importedAt } = args;

  const findingType = evidenceItem.source_type?.trim() || DEFAULT_FINDING_TYPE;

  const evidenceRefs: EvidenceRefV1[] = [
    { type: "client_radar_evidence_item", ref: evidenceItem.id },
  ];
  if (evidenceItem.url !== null) {
    evidenceRefs.push({ type: "client_radar_evidence_url", ref: evidenceItem.url });
  }

  return {
    schemaVersion: "v1",
    provider: "client_radar",
    sourceRecordId: evidenceItem.id,
    observationClass: "research_intelligence",
    findingType,
    rawValue: evidenceItem as unknown as ResearchIntelligenceObservationV1["rawValue"],
    normalizedValue: null,
    observedAt: tolerantObservedAt(evidenceItem.created_at),
    importedAt,
    confidence: null,
    evidenceRefs,
    providerMetadata: {
      clientRadarAccountId: context.clientRadarAccountId,
      company: context.company,
      domain: context.domain,
    },
  };
}

export interface MapClientRadarEvidenceItemsToObservationsArgs {
  evidenceItems: ClientRadarEvidenceItem[];
  context: ClientRadarEvidenceContext;
  importedAt: string;
}

export function mapClientRadarEvidenceItemsToObservations(
  args: MapClientRadarEvidenceItemsToObservationsArgs,
): ResearchIntelligenceObservationV1[] {
  return args.evidenceItems.map((evidenceItem) =>
    mapClientRadarEvidenceToObservation({
      evidenceItem,
      context: args.context,
      importedAt: args.importedAt,
    }),
  );
}
