// Minimal read-only HubSpot Companies API client for controlled identity
// bootstrap and (Milestone 3E.3) firmographic_fact/crm_state observation
// mapping. Configuration is read lazily per call, the bearer credential is
// used only in the outbound Authorization header, and provider response bodies
// are never included in returned values or errors.
//
// Properties requested are exactly the set verified available against the
// live tenant during the 3A.5 capability audit and mapped by
// ../services/hubSpotObservationMapping.ts: domain/name (identity, existing),
// industry/country/numberofemployees/annualrevenue (firmographic_fact),
// lifecyclestage/hubspot_owner_id (crm_state). company.region has no native
// HubSpot property (it is a derived EMEA/US/other banding) and is
// deliberately not requested. `type` (a candidate for
// partner/competitor-flag inference) is deliberately not requested either —
// 3A.5 only confirmed it exists and was null on the audited record, never
// confirmed this tenant's actual value set for it, so no trustworthy
// competitorFlag/partnerFlag mapping exists yet (see
// hubSpotObservationMapping.ts's own comment).

const HUBSPOT_API_BASE_URL = "https://api.hubapi.com";
const HUBSPOT_COMPANIES_API_VERSION = "2026-03";
const REQUEST_TIMEOUT_MS = 12000;

export const HUBSPOT_ACCESS_TOKEN_NOT_CONFIGURED_MESSAGE =
  "HUBSPOT_ACCESS_TOKEN is not configured.";

export class HubSpotNotConfiguredError extends Error {
  constructor() {
    super(HUBSPOT_ACCESS_TOKEN_NOT_CONFIGURED_MESSAGE);
    this.name = "HubSpotNotConfiguredError";
  }
}

/** A non-success response from HubSpot. Never contains the bearer token or response body. */
export class HubSpotApiError extends Error {
  constructor(readonly status: number) {
    super(`HubSpot returned HTTP ${status}.`);
    this.name = "HubSpotApiError";
  }
}

/** A successful HubSpot response whose JSON does not satisfy the expected company contract. */
export class HubSpotResponseError extends Error {
  constructor(message = "HubSpot returned an unexpected company response shape.") {
    super(message);
    this.name = "HubSpotResponseError";
  }
}

export class HubSpotCompanyArchivedError extends Error {
  constructor() {
    super("The requested HubSpot company is archived.");
    this.name = "HubSpotCompanyArchivedError";
  }
}

export class HubSpotCompanyDomainUnavailableError extends Error {
  constructor() {
    super("The requested HubSpot company has no usable domain.");
    this.name = "HubSpotCompanyDomainUnavailableError";
  }
}

export interface HubSpotCompany {
  id: string;
  domain: string;
  name: string | null;
  industry: string | null;
  country: string | null;
  numberOfEmployees: string | null;
  annualRevenue: string | null;
  lifecycleStage: string | null;
  hubspotOwnerId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAccessToken(): string {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) throw new HubSpotNotConfiguredError();
  return accessToken;
}

function parseCompanyResponse(data: unknown, requestedCompanyId: string): HubSpotCompany {
  if (!isRecord(data) || typeof data.id !== "string") {
    throw new HubSpotResponseError();
  }
  if (data.id !== requestedCompanyId) {
    throw new HubSpotResponseError("HubSpot returned a different company id than requested.");
  }
  if (typeof data.archived !== "boolean") {
    throw new HubSpotResponseError();
  }
  if (data.archived) throw new HubSpotCompanyArchivedError();
  if (!isRecord(data.properties)) throw new HubSpotResponseError();

  const domain = data.properties.domain;
  if (typeof domain !== "string" || domain.trim() === "") {
    throw new HubSpotCompanyDomainUnavailableError();
  }

  const rawName = data.properties.name;
  if (rawName !== undefined && rawName !== null && typeof rawName !== "string") {
    throw new HubSpotResponseError();
  }
  const name = typeof rawName === "string" && rawName.trim() !== "" ? rawName : null;

  return {
    id: data.id,
    domain,
    name,
    industry: parseOptionalStringProperty(data.properties, "industry"),
    country: parseOptionalStringProperty(data.properties, "country"),
    numberOfEmployees: parseOptionalStringProperty(data.properties, "numberofemployees"),
    annualRevenue: parseOptionalStringProperty(data.properties, "annualrevenue"),
    lifecycleStage: parseOptionalStringProperty(data.properties, "lifecyclestage"),
    hubspotOwnerId: parseOptionalStringProperty(data.properties, "hubspot_owner_id"),
  };
}

// Shared parsing for every optional company property below domain/name:
// present-and-non-blank -> the trimmed string; absent, null, or blank ->
// null. Mirrors the existing rawName handling above rather than
// introducing a second convention. A present-but-non-string value is
// treated as a malformed response, same as name.
function parseOptionalStringProperty(
  properties: Record<string, unknown>,
  propertyName: string,
): string | null {
  const raw = properties[propertyName];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new HubSpotResponseError();
  }
  return raw.trim() === "" ? null : raw;
}

export async function fetchHubSpotCompanyById(companyId: string): Promise<HubSpotCompany> {
  const requestedCompanyId = companyId.trim();
  if (requestedCompanyId === "") {
    throw new HubSpotResponseError("A non-blank HubSpot company id is required.");
  }

  const accessToken = getAccessToken();
  const path = `/crm/objects/${HUBSPOT_COMPANIES_API_VERSION}/companies/${encodeURIComponent(requestedCompanyId)}`;
  const url = new URL(`${HUBSPOT_API_BASE_URL}${path}`);
  url.searchParams.set(
    "properties",
    "domain,name,industry,country,numberofemployees,annualrevenue,lifecyclestage,hubspot_owner_id",
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new HubSpotApiError(502);
  }

  if (!response.ok) throw new HubSpotApiError(response.status);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new HubSpotResponseError("HubSpot returned malformed or non-JSON company data.");
  }
  return parseCompanyResponse(data, requestedCompanyId);
}
