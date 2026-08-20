// Milestone 3E.3 — HubSpot company observation mapping.
//
// Pure: HubSpotCompany + a caller-supplied importedAt -> zero or more
// ProviderObservationV1 candidates. No DB, no network. Mirrors
// ./rb2bObservationMapping.ts's pure-mapping pattern, adapted for a 1:N
// shape (one HubSpot company fetch legitimately produces many
// observations, differentiated by semanticKey) rather than RB2B's 1:1
// event shape.
//
// HubSpot is identity + firmographic_fact + crm_state only in this slice
// — never behavioral_signal. The live tenant's detailed page-level event
// read API is confirmed unavailable (3A.5 — 403, missing scopes); this
// module does not invent behavioral events from data HubSpot doesn't
// expose. Client Radar remains the research_intelligence provider; RB2B
// (3E.2) remains the priority behavioral_signal provider — see
// NEXT_SESSION.md.
//
// sourceRecordId is always the HubSpot company id (company.id) — never a
// Mission Control account_id. observedAt is always null: 3A.5 confirmed
// HubSpot's company-property endpoint exposes no trustworthy field-level
// observation timestamp, only a whole-record last-modified time that
// does not correspond to any one property (see
// @workspace/observation's own sourceRecordId/observedAt invariant
// comments) — backfilling from a record-level timestamp here would
// misattribute it as field-level truth. importedAt is caller-supplied,
// assigned once per ingestion attempt by the caller
// (../services/hubSpotCompanySync.ts) and reused unchanged across every
// observation this function returns for one company fetch — this module
// never generates or reads timestamps itself.

import type {
  CrmStateObservationV1,
  FirmographicFactObservationV1,
  IdentityObservationV1,
  ProviderObservationV1,
} from "@workspace/observation";
import type { HubSpotCompany } from "../lib/hubSpotClient.js";

const HUBSPOT_CUSTOMER_LIFECYCLE_STAGE = "customer";

export interface MapHubSpotCompanyToObservationsArgs {
  company: HubSpotCompany;
  importedAt: string;
}

function identityObservation(
  args: MapHubSpotCompanyToObservationsArgs,
  identityKey: "domain" | "external_id",
  identityValue: string,
): IdentityObservationV1 {
  return {
    schemaVersion: "v1",
    provider: "hubspot",
    sourceRecordId: args.company.id,
    observationClass: "identity",
    subjectType: "account",
    identityKey,
    identityValue,
    observedAt: null,
    importedAt: args.importedAt,
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
}

function firmographicFactObservation(
  args: MapHubSpotCompanyToObservationsArgs,
  canonicalField: FirmographicFactObservationV1["canonicalField"],
  rawValue: string,
): FirmographicFactObservationV1 {
  return {
    schemaVersion: "v1",
    provider: "hubspot",
    sourceRecordId: args.company.id,
    observationClass: "firmographic_fact",
    canonicalField,
    rawValue,
    normalizedValue: null,
    observedAt: null,
    importedAt: args.importedAt,
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
}

function crmStateObservation(
  args: MapHubSpotCompanyToObservationsArgs,
  canonicalField: CrmStateObservationV1["canonicalField"],
  rawValue: string,
  normalizedValue: CrmStateObservationV1["normalizedValue"] = null,
): CrmStateObservationV1 {
  return {
    schemaVersion: "v1",
    provider: "hubspot",
    sourceRecordId: args.company.id,
    observationClass: "crm_state",
    canonicalField,
    rawValue,
    normalizedValue,
    observedAt: null,
    importedAt: args.importedAt,
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
}

/**
 * Maps one fetched HubSpot company into its observation candidates.
 *
 * Always emitted (company.domain/company.id are guaranteed present by
 * fetchHubSpotCompanyById's own contract — see hubSpotClient.ts):
 *   identity: domain, external_id
 *
 * Emitted only when the underlying HubSpot property is present
 * (never fabricated as an empty/default value):
 *   firmographic_fact: company.industry, company.country,
 *     company.employeeRange (raw numberofemployees, not yet banded),
 *     company.revenueRange (raw annualrevenue, not yet banded)
 *   crm_state: crm.owner (hubspot_owner_id), crm.lifecycleStage (raw
 *     lifecyclestage string), crm.existingCustomer (only when
 *     lifecyclestage === "customer" — see below; never a guessed false)
 *
 * Deliberately NOT emitted in this slice (documented gaps, not oversights
 * — see NEXT_SESSION.md's 3E.3 checkpoint):
 *   - company.region: no native HubSpot property: it is a derived
 *     EMEA/US/other banding from country, not something HubSpot exposes.
 *   - crm.openOpportunity: would require HubSpot's Deals API, a
 *     different object type this client does not fetch — adding that is
 *     a new integration surface, not this narrow adapter's scope.
 *   - crm.competitorFlag / crm.partnerFlag: HubSpot's `type` company
 *     property is a plausible candidate, but 3A.5 only confirmed it
 *     exists and was null on the audited record — this tenant's actual
 *     value set for it was never confirmed, so mapping it would be
 *     guessing from a weak/unverified field, which is explicitly what
 *     this slice must not do.
 *   - crm.existingCustomer IS emitted, but ONLY when lifecyclestage is
 *     exactly "customer" (normalizedValue always true when present) —
 *     never as an explicit false for any other stage. lifecyclestage
 *     !== "customer" only proves HubSpot's stage field doesn't currently
 *     read "customer"; it does not prove the broader claim
 *     existingCustomer implies (e.g. a churned customer or a
 *     tenant-specific post-customer stage would wrongly read false).
 *     crm.lifecycleStage above already carries the raw truth for every
 *     stage unconditionally — omitting existingCustomer for non-customer
 *     stages loses no information, it just avoids asserting a negative
 *     this single field can't actually support.
 */
export function mapHubSpotCompanyToObservations(
  args: MapHubSpotCompanyToObservationsArgs,
): ProviderObservationV1[] {
  const { company } = args;
  const observations: ProviderObservationV1[] = [];

  observations.push(identityObservation(args, "domain", company.domain));
  observations.push(identityObservation(args, "external_id", company.id));

  if (company.industry !== null) {
    observations.push(
      firmographicFactObservation(args, "company.industry", company.industry),
    );
  }
  if (company.country !== null) {
    observations.push(
      firmographicFactObservation(args, "company.country", company.country),
    );
  }
  if (company.numberOfEmployees !== null) {
    observations.push(
      firmographicFactObservation(
        args,
        "company.employeeRange",
        company.numberOfEmployees,
      ),
    );
  }
  if (company.annualRevenue !== null) {
    observations.push(
      firmographicFactObservation(
        args,
        "company.revenueRange",
        company.annualRevenue,
      ),
    );
  }

  if (company.hubspotOwnerId !== null) {
    observations.push(
      crmStateObservation(args, "crm.owner", company.hubspotOwnerId),
    );
  }
  if (company.lifecycleStage !== null) {
    observations.push(
      crmStateObservation(args, "crm.lifecycleStage", company.lifecycleStage),
    );
    // Only ever assert the positive: lifecyclestage !== "customer" proves
    // HubSpot's stage field doesn't currently read "customer", not the
    // broader claim existingCustomer implies (e.g. a churned customer or a
    // tenant-specific post-customer stage would wrongly read false). No
    // observation is emitted at all for any other stage — crm.lifecycleStage
    // above already carries the raw truth; this is not a fabricated
    // default, it is the same "absence over guessed negative" discipline
    // already applied to crm.competitorFlag/crm.partnerFlag.
    if (company.lifecycleStage === HUBSPOT_CUSTOMER_LIFECYCLE_STAGE) {
      observations.push(
        crmStateObservation(
          args,
          "crm.existingCustomer",
          company.lifecycleStage,
          true,
        ),
      );
    }
  }

  return observations;
}
