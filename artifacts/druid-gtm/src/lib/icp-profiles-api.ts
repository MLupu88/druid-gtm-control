// Hand-written types + fetch functions for the ICP profiles list API
// (GET /api/internal/icp-profiles). Shapes here are verified directly
// against artifacts/api-server/src/services/icpProfiles.ts's
// ProfileVersionSummary/ProfileListItem and
// artifacts/api-server/src/routes/icpProfiles.ts's GET / handler (which
// returns the service's list result as a raw JSON array, no wrapper) —
// not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./accounts-api.ts / ./account-decisions-api.ts /
// ./client-radar-research-api.ts. React Query itself stays in the
// components; this module only exports plain fetch functions and a
// stable query-key helper.

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
