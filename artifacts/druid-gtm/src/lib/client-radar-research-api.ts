// Hand-written types + fetch functions for the Client Radar research run
// API (GET/POST /api/internal/accounts/:accountId/client-radar-research,
// POST /api/internal/client-radar-research/:researchRunId/refresh). Shapes
// here are verified directly against
// artifacts/api-server/src/routes/clientRadarResearchRuns.ts and
// lib/db/src/schema/clientRadarResearchRuns.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./accounts-api.ts / ./account-decisions-api.ts. React Query itself
// stays in the components; this module only exports plain fetch functions
// and stable query-key helpers, so it has no framework dependency of its
// own.

export type ClientRadarResearchStatus =
  | "submitting"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ClientRadarEvidenceItem {
  id: string;
  source_type: string | null;
  title: string | null;
  url: string | null;
  content: string | null;
  created_at: string;
}

export interface ClientRadarAccountPayload {
  id: string;
  account_key: string;
  company: string;
  domain: string | null;
  country: string | null;
  industry: string | null;
  vertical: string | null;
  opportunity_type: string | null;
  ai_maturity: string | null;
  signal_confidence: string | null;
  value_hook: string | null;
  matched_use_case: string | null;
  target_persona: string | null;
  detected_stack: string | null;
  druid_fit_hypothesis: string | null;
  caveat: string | null;
  entity_confidence: string | null;
  derived_fit: string | null;
  sources: unknown;
  last_checked: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

// "not_configured" | "runtime_failure" | null — computed server-side at
// read time (never persisted, no migration) from lastError via a small
// closed set of known messages the backend itself controls; see
// artifacts/api-server/src/lib/clientRadarClient.ts's
// classifyClientRadarFailureReason. Only ever non-null when status is
// "failed" — always null for every other status, including "cancelled".
// A stable typed field to switch UI treatment on, replacing the old
// approach of pattern-matching lastError's raw text in the frontend.
export type ClientRadarFailureReason = "not_configured" | "runtime_failure";

export interface ClientRadarResearchRun {
  id: string;
  accountId: string;
  clientRadarRunId: string | null;
  status: ClientRadarResearchStatus;
  submittedAt: string | null;
  lastPolledAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  failureReason: ClientRadarFailureReason | null;
  // Nullable: Client Radar may complete a run without resolving an
  // account (see clientRadarResearchRuns.ts's syncClientRadarResearchResult).
  accountPayload: ClientRadarAccountPayload | null;
  // Nullable: no result has been persisted before completion.
  evidencePayload: ClientRadarEvidenceItem[] | null;
  resultSchemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface ClientRadarResearchRunResponse {
  researchRun: ClientRadarResearchRun | null;
}

// Carries the backend's own `code` (see sendError() in
// routes/clientRadarResearchRuns.ts: every error body is
// `{ error, code }`), plus `existingRun` — only present on the 409
// active_research_run_exists response, whose handler adds that field
// alongside error/code.
export class ClientRadarResearchApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly existingRun?: ClientRadarResearchRun,
  ) {
    super(message);
    this.name = "ClientRadarResearchApiError";
  }
}

async function throwForResponse(
  res: Response,
  fallback: string,
): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    existingRun?: ClientRadarResearchRun;
  };
  throw new ClientRadarResearchApiError(
    body.error ?? fallback,
    body.code,
    body.existingRun,
  );
}

export async function fetchLatestClientRadarResearchRun(
  accountId: string,
): Promise<ClientRadarResearchRun | null> {
  const res = await fetch(
    `/api/internal/accounts/${encodeURIComponent(accountId)}/client-radar-research`,
    { credentials: "include" },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not load Client Radar research.");
  }
  const body = (await res.json()) as ClientRadarResearchRunResponse;
  return body.researchRun;
}

export async function startClientRadarResearch(
  accountId: string,
): Promise<ClientRadarResearchRun> {
  const res = await fetch(
    `/api/internal/accounts/${encodeURIComponent(accountId)}/client-radar-research`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not start Client Radar research.");
  }
  const body = (await res.json()) as ClientRadarResearchRunResponse;
  return body.researchRun as ClientRadarResearchRun;
}

export async function refreshClientRadarResearchRun(
  researchRunId: string,
): Promise<ClientRadarResearchRun> {
  const res = await fetch(
    `/api/internal/client-radar-research/${encodeURIComponent(researchRunId)}/refresh`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not refresh Client Radar research.");
  }
  const body = (await res.json()) as ClientRadarResearchRunResponse;
  return body.researchRun as ClientRadarResearchRun;
}

// Stable query-key helper — same intent as ./accounts-api.ts's
// accountDetailQueryKey / ./account-decisions-api.ts's
// accountDecisionsQueryKey. No pagination for this resource, so accountId
// alone is both the fetch key and the correct invalidation-target prefix.
export function clientRadarResearchRunQueryKey(accountId: string) {
  return ["client-radar-research", accountId] as const;
}
