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

import { normalizeCompanyDomain } from "@workspace/identity";

const HUBSPOT_API_BASE_URL = "https://api.hubapi.com";
const HUBSPOT_COMPANIES_API_VERSION = "2026-03";
const REQUEST_TIMEOUT_MS = 12000;
// Only enough rows to tell "exactly one" from "more than one" — this
// endpoint must never guess among multiple companies, so the exact total
// beyond 2 is never needed (see searchHubSpotCompaniesByDomain below).
const HUBSPOT_COMPANY_SEARCH_LIMIT = 2;

const HUBSPOT_ACCESS_TOKEN_NOT_CONFIGURED_MESSAGE =
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

// ---------------------------------------------------------------------
// RB2B -> HubSpot context link — read-only company lookup by exact
// normalized domain, using HubSpot's CRM Search API (a distinct resource
// from the versioned companies-object GET above). Only ever used to find
// a company ID; the full company record (with firmographic/CRM
// properties) is still fetched exclusively through
// fetchHubSpotCompanyById -> ../services/hubSpotCompanySync.ts's existing
// path, never duplicated here. Never guesses among multiple matches:
// "ambiguous" is a first-class outcome, not an error to recover from by
// picking one.
// ---------------------------------------------------------------------

export type HubSpotCompanyDomainSearchResult =
  | { outcome: "matched"; companyId: string }
  | { outcome: "not_found" }
  | { outcome: "ambiguous"; companyIds: string[] };

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseCompanySearchResponse(data: unknown): HubSpotCompanyDomainSearchResult {
  if (!isRecord(data) || !Array.isArray(data.results)) {
    throw new HubSpotResponseError(
      "HubSpot returned an unexpected company search response shape.",
    );
  }

  const companyIds: string[] = [];
  for (const item of data.results) {
    if (!isRecord(item) || !isNonBlankString(item.id)) {
      throw new HubSpotResponseError(
        "HubSpot returned an unexpected company search response shape.",
      );
    }
    companyIds.push(item.id);
  }

  if (companyIds.length === 0) return { outcome: "not_found" };
  if (companyIds.length === 1) return { outcome: "matched", companyId: companyIds[0]! };
  return { outcome: "ambiguous", companyIds };
}

/**
 * Exact-match company lookup by normalized domain via HubSpot's Companies
 * Search API (POST .../companies/search, `domain` EQ filter) — never a
 * fuzzy or partial match. Requests only HUBSPOT_COMPANY_SEARCH_LIMIT rows:
 * enough to distinguish zero/one/more-than-one without ever needing the
 * true total, since anything past "more than one" is already `ambiguous`.
 *
 * Throws HubSpotNotConfiguredError (before any request, mirroring
 * fetchHubSpotCompanyById), HubSpotApiError for a non-2xx response
 * (including 429 — this client has no retry/backoff convention to extend,
 * so the status is surfaced exactly like every other non-2xx case), and
 * HubSpotResponseError for malformed/non-JSON bodies or an unnormalizable
 * input domain. Callers that must never throw for these (e.g. a
 * best-effort context-refresh path) are responsible for catching and
 * mapping them, the same convention ../services/hubSpotCompanySync.ts's
 * own callers already follow for fetchHubSpotCompanyById.
 */
export async function searchHubSpotCompaniesByDomain(
  domain: string,
): Promise<HubSpotCompanyDomainSearchResult> {
  const normalizedDomain = normalizeCompanyDomain(domain);
  if (normalizedDomain === null) {
    throw new HubSpotResponseError(
      "A normalizable, non-blank domain is required for company search.",
    );
  }

  const accessToken = getAccessToken();
  const url = new URL(`${HUBSPOT_API_BASE_URL}/crm/v3/objects/companies/search`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "domain", operator: "EQ", value: normalizedDomain },
            ],
          },
        ],
        properties: ["domain"],
        limit: HUBSPOT_COMPANY_SEARCH_LIMIT,
      }),
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
    throw new HubSpotResponseError(
      "HubSpot returned malformed or non-JSON company search data.",
    );
  }
  return parseCompanySearchResponse(data);
}

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — crm.owner's canonicalValue is the stable
// HubSpot owner ID (hubspot_owner_id), not a human name; that ID alone
// is not useful product copy. This resolves one owner id to a display
// name via HubSpot's own Owners API (a distinct resource from Companies
// — /crm/v3/owners, not /crm/objects/<version>/..., so it is
// deliberately NOT using HUBSPOT_COMPANIES_API_VERSION). Called during
// ingestion (../services/hubSpotCompanySync.ts), never from a per-page-
// load read path — see that module's own comment.
// ---------------------------------------------------------------------

export interface HubSpotOwner {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

function nullableTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseOwnerResponse(data: unknown, requestedOwnerId: string): HubSpotOwner {
  if (!isRecord(data) || typeof data.id !== "string") {
    throw new HubSpotResponseError();
  }
  if (data.id !== requestedOwnerId) {
    throw new HubSpotResponseError("HubSpot returned a different owner id than requested.");
  }
  return {
    id: data.id,
    email: nullableTrimmedString(data.email),
    firstName: nullableTrimmedString(data.firstName),
    lastName: nullableTrimmedString(data.lastName),
  };
}

/**
 * Returns null (never throws) for a not-found owner (404) or a blank
 * ownerId — a missing/unresolvable owner name is not a sync-blocking
 * failure, see ../services/hubSpotCompanySync.ts's own call site, which
 * degrades to no display name rather than failing the whole sync.
 */
export async function fetchHubSpotOwnerById(ownerId: string): Promise<HubSpotOwner | null> {
  const requestedOwnerId = ownerId.trim();
  if (requestedOwnerId === "") return null;

  const accessToken = getAccessToken();
  const url = new URL(`${HUBSPOT_API_BASE_URL}/crm/v3/owners/${encodeURIComponent(requestedOwnerId)}`);

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

  if (response.status === 404) return null;
  if (!response.ok) throw new HubSpotApiError(response.status);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new HubSpotResponseError("HubSpot returned malformed or non-JSON owner data.");
  }
  return parseOwnerResponse(data, requestedOwnerId);
}
