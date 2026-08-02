// Hand-written types + fetch functions for the ICP profiles API:
//   - GET  /api/internal/icp-profiles
//   - GET  /api/internal/icp-profiles/:profileId
//   - POST /api/internal/icp-profiles              (create profile + initial draft)
//   - PUT  /api/internal/icp-profiles/:profileId/draft (full-replacement draft update)
// Shapes here are verified directly against
// artifacts/api-server/src/services/icpProfiles.ts's
// ProfileVersionSummary/ProfileListItem/ProfileDetail and
// artifacts/api-server/src/routes/icpProfiles.ts's GET /, GET
// /:profileId, POST /, and PUT /:profileId/draft handlers (all return the
// service's result as raw JSON, no wrapper) — not guessed. In particular:
//   - CreateIcpProfileRequestSchema is `{ name, description?, config }`
//     .strict() — createIcpProfile below sends exactly that, nothing more.
//   - UpdateDraftRequestSchema is `{ config, notes? }` .strict() — there is
//     NO name/description field on this endpoint. Profile name/description
//     can only ever be set once, at creation; the draft editor
//     (../components/icp-profile-draft-editor.tsx) treats them as
//     read-only for exactly this reason, not as an oversight.
//   - updateDraft is a FULL REPLACEMENT of config — updateIcpProfileDraft
//     below has no partial/patch variant; callers must always submit the
//     complete IcpProfileConfigV1 object.
//
// This module depends on @workspace/evaluator only for the
// IcpProfileConfigV1 type on the two write functions below (stronger
// typing at the call site) — it does not re-validate against
// IcpProfileConfigV1Schema itself; that lives in
// ../lib/icp-profile-config-validation.ts, run by the editor before ever
// calling these functions, with the server's own validateProfileConfig
// remaining the authoritative last word (see IcpProfilesApiError below,
// carrying the 422 invalid_profile_config code on a rejected save).
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./accounts-api.ts / ./account-decisions-api.ts /
// ./client-radar-research-api.ts. React Query itself stays in the
// components; this module only exports plain fetch functions and stable
// query-key helpers.

import type {
  IcpProfileConfigV1,
  ProfileClassification,
  TargetCriterion,
} from "@workspace/evaluator";

export type { ProfileClassification, TargetCriterion };

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
  /** Derived server-side from the active version's config — see @workspace/evaluator's classifyProfileConfig. "no_active_definition" whenever activeVersion is null. */
  classification: ProfileClassification;
  /** Structured target-company criteria from the active version's simple fit rules — see @workspace/evaluator's targetCriteria. Never points, rule ids, or thresholds. */
  targetCriteria: TargetCriterion[];
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

// ---------------------------------------------------------------------
// Create profile + initial draft (POST /api/internal/icp-profiles).
// createdBy is stamped server-side (see routes/icpProfiles.ts's
// deriveCreatedBy) — never sent from here.
// ---------------------------------------------------------------------

export interface CreateIcpProfileArgs {
  name: string;
  /** undefined/omitted and null are both valid — both mean "no description". */
  description?: string | null;
  config: IcpProfileConfigV1;
}

// Mirrors the exact shape createProfile (icpProfiles.ts service) returns:
// `{ profile, draftVersion }`, not a bare profile or a bare version.
export interface CreateIcpProfileResult {
  profile: IcpProfile;
  draftVersion: IcpProfileVersion;
}

export async function createIcpProfile(
  args: CreateIcpProfileArgs,
): Promise<CreateIcpProfileResult> {
  const res = await fetch("/api/internal/icp-profiles", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: args.name,
      description: args.description ?? null,
      config: args.config,
    }),
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not create this ICP profile.");
  }
  return res.json() as Promise<CreateIcpProfileResult>;
}

// ---------------------------------------------------------------------
// Update the current draft (PUT /api/internal/icp-profiles/:profileId/draft)
// — full replacement of config; notes replaces the stored value when
// supplied (including explicit null), and is left untouched when omitted
// entirely. There is no name/description field here — see module comment.
// ---------------------------------------------------------------------

export interface UpdateIcpProfileDraftArgs {
  config: IcpProfileConfigV1;
  /** Omit entirely to leave stored notes untouched; null/string to replace. */
  notes?: string | null;
}

export async function updateIcpProfileDraft(
  profileId: string,
  args: UpdateIcpProfileDraftArgs,
): Promise<IcpProfileVersion> {
  const body: Record<string, unknown> = { config: args.config };
  if ("notes" in args) {
    body.notes = args.notes;
  }
  const res = await fetch(
    `/api/internal/icp-profiles/${encodeURIComponent(profileId)}/draft`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not save this draft.");
  }
  return res.json() as Promise<IcpProfileVersion>;
}

// ---------------------------------------------------------------------
// Publish (POST /api/internal/icp-profiles/:profileId/publish) — acts on
// "the profile's current draft" implicitly (see the route's own
// comment); no body fields are accepted or sent. Does NOT activate the
// published version — routes/icpProfiles.ts's publishDraft never touches
// activeVersionId. Returns the now-published IcpProfileVersion row
// (status: "published", publishedAt set).
// ---------------------------------------------------------------------

export async function publishIcpProfileDraft(
  profileId: string,
): Promise<IcpProfileVersion> {
  const res = await fetch(
    `/api/internal/icp-profiles/${encodeURIComponent(profileId)}/publish`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not publish this draft.");
  }
  return res.json() as Promise<IcpProfileVersion>;
}

// ---------------------------------------------------------------------
// Activate (POST /api/internal/icp-profiles/:profileId/activate) — body
// is `{ versionId }` only (VersionIdRequestSchema). Mirrors the exact
// shape activateVersion (icpProfiles.ts service) returns:
// `{ profile, event, alreadyActive }` — not a bare profile.
// Re-activating the already-active version is NOT an error server-side
// (a deterministic no-op returning alreadyActive: true, event: null) —
// the frontend disables the action for an already-active version as a
// UX courtesy, not because the backend would reject it.
// ---------------------------------------------------------------------

// Mirrors lib/db/src/schema/icpProfileActivationEvents.ts's
// IcpProfileActivationEvent exactly (this slice never lists activation
// history — see the module comment — but the /activate response embeds
// one event row, so its shape must still be typed accurately here).
export interface IcpProfileActivationEvent {
  id: string;
  profileId: string;
  eventType: "activated" | "deactivated";
  versionId: string | null;
  previousActiveVersionId: string | null;
  performedBy: string | null;
  performedAt: string;
  reason: string | null;
}

export interface ActivateIcpProfileVersionResult {
  profile: IcpProfile;
  event: IcpProfileActivationEvent | null;
  alreadyActive: boolean;
}

export async function activateIcpProfileVersion(
  profileId: string,
  versionId: string,
): Promise<ActivateIcpProfileVersionResult> {
  const res = await fetch(
    `/api/internal/icp-profiles/${encodeURIComponent(profileId)}/activate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not activate this version.");
  }
  return res.json() as Promise<ActivateIcpProfileVersionResult>;
}

// ---------------------------------------------------------------------
// Clone (POST /api/internal/icp-profiles/:profileId/clone) — body is
// `{ versionId }` (the SOURCE version to clone, named `versionId` on the
// wire per VersionIdRequestSchema — renamed to `sourceVersionId` in this
// function's own signature purely for local clarity, since the request
// already has an unrelated `:profileId` path param). Fails with
// "draft_already_exists" (409) if the profile already has a draft — the
// service enforces at most one draft per profile; callers must not
// invoke this when a draft already exists (see
// ../components/icp-profile-lifecycle-actions.tsx, which only ever
// renders this action when there is none).
// ---------------------------------------------------------------------

export async function cloneIcpProfileVersionIntoDraft(
  profileId: string,
  sourceVersionId: string,
): Promise<IcpProfileVersion> {
  const res = await fetch(
    `/api/internal/icp-profiles/${encodeURIComponent(profileId)}/clone`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: sourceVersionId }),
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not clone this version into a new draft.");
  }
  return res.json() as Promise<IcpProfileVersion>;
}
