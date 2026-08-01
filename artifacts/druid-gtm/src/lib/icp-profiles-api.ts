// Hand-written types + fetch functions for the ICP profiles API
// (GET /api/internal/icp-profiles, GET /api/internal/icp-profiles/:profileId).
// Shapes here are verified directly against
// artifacts/api-server/src/services/icpProfiles.ts's
// ProfileVersionSummary/ProfileListItem/ProfileDetail and
// artifacts/api-server/src/routes/icpProfiles.ts's GET / and GET
// /:profileId handlers (both return the service's result as raw JSON, no
// wrapper) — not guessed.
//
// This slice (Settings → ICP Profiles, read-only foundation) only adds
// READ operations. create/updateDraft/clone/publish/activate already
// exist on the backend (see icpProfiles.ts route) but have no client
// function here yet — that lands with the draft-editor slice, which will
// mutate the exact same IcpProfileVersion/IcpProfileDetail shapes this
// slice's detail page already reads.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./accounts-api.ts / ./account-decisions-api.ts /
// ./client-radar-research-api.ts. React Query itself stays in the
// components; this module only exports plain fetch functions and stable
// query-key helpers.

export type IcpProfileVersionStatus = "draft" | "published";

export interface IcpProfileVersionSummary {
  id: string;
  versionNumber: number;
  status: IcpProfileVersionStatus;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  notes: string | null;
}

export interface IcpProfileListItem {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  activeVersion: IcpProfileVersionSummary | null;
  draftVersion: IcpProfileVersionSummary | null;
  latestVersion: IcpProfileVersionSummary | null;
}

// Carries the backend's own `code` (see sendError() in
// routes/icpProfiles.ts: every error body is `{ error, code }`) plus the
// HTTP status, so callers can distinguish e.g. a 404 from a 500 without
// re-deriving it from the message text.
export class IcpProfilesApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly status: number,
  ) {
    super(message);
    this.name = "IcpProfilesApiError";
  }
}

async function throwForResponse(
  res: Response,
  fallback: string,
): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new IcpProfilesApiError(body.error ?? fallback, body.code, res.status);
}

export async function fetchIcpProfiles(): Promise<IcpProfileListItem[]> {
  const res = await fetch("/api/internal/icp-profiles", {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load ICP profiles.");
  }
  return res.json() as Promise<IcpProfileListItem[]>;
}

// Stable query-key helper — same intent as ./accounts-api.ts's
// accountsListQueryKey / ./client-radar-research-api.ts's
// clientRadarResearchRunQueryKey. No pagination or arguments for this
// resource, so a call with no args is both the fetch key and the correct
// invalidation-target prefix.
export function icpProfilesListQueryKey() {
  return ["icp-profiles", "list"] as const;
}

// ---------------------------------------------------------------------
// Profile detail (GET /api/internal/icp-profiles/:profileId) — the
// canonical row plus every version, config included. Distinct from
// IcpProfileListItem above: the list endpoint deliberately omits `config`
// (see ProfileVersionSummary in the backend service) since it's not
// needed to render a list; the detail endpoint is the only one that ever
// returns the actual stored rule/tier/disqualifier config.
// ---------------------------------------------------------------------

// The canonical profile row itself (never includes version content).
export interface IcpProfile {
  id: string;
  name: string;
  description: string | null;
  /** Points at the currently active PUBLISHED version, or null if none is active. */
  activeVersionId: string | null;
  archivedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

// The full, exact persisted version row — unlike IcpProfileVersionSummary
// above, this carries `config` and `profileId`. `config` is typed
// `unknown` deliberately: this module has no dependency on
// @workspace/evaluator (see module comment), so the exact
// IcpProfileConfigV1 shape is not assumed here — see
// ./icp-profile-presentation.ts's summarizeVersionConfig for the
// defensive, truthful-or-null reading of it this slice actually needs.
export interface IcpProfileVersion {
  id: string;
  profileId: string;
  versionNumber: number;
  status: IcpProfileVersionStatus;
  config: unknown;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  notes: string | null;
}

export interface IcpProfileDetail {
  profile: IcpProfile;
  /** Ordered by versionNumber ascending, per the backend's getProfile/ProfileDetail. */
  versions: IcpProfileVersion[];
}

// Returns null (not a thrown error) for a well-formed "no such profile"
// 404 — mirrors ./accounts-api.ts's fetchAccountDetail convention exactly.
// Every other non-2xx status is still thrown as an IcpProfilesApiError.
export async function fetchIcpProfileDetail(
  profileId: string,
): Promise<IcpProfileDetail | null> {
  const res = await fetch(
    `/api/internal/icp-profiles/${encodeURIComponent(profileId)}`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwForResponse(res, "Could not load this ICP profile.");
  }
  return res.json() as Promise<IcpProfileDetail>;
}

export function icpProfileDetailQueryKey(profileId: string) {
  return ["icp-profiles", "detail", profileId] as const;
}
