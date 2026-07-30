// Outbound HTTP client for the Client Radar research-run API (see
// artifacts/api-server/src/routes/n8n.ts for the sibling convention this
// follows: env vars read per-call rather than at module load, base URL
// trailing-slash normalization, fetch + AbortSignal.timeout). The bearer
// token is read from CLIENT_RADAR_API_TOKEN and is never included in any
// returned value, thrown error, or log line — only the Authorization
// header of the outgoing request carries it.

const REQUEST_TIMEOUT_MS = 12000;

export type ClientRadarRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const RUN_STATUSES: ReadonlySet<string> = new Set<ClientRadarRunStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

function isClientRadarRunStatus(value: unknown): value is ClientRadarRunStatus {
  return typeof value === "string" && RUN_STATUSES.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Thrown for any non-2xx or structurally invalid Client Radar response. Never carries the bearer token. */
export class ClientRadarApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ClientRadarApiError";
    this.status = status;
  }
}

interface ClientRadarConfig {
  baseUrl: string;
  apiToken: string;
}

function getConfig(): ClientRadarConfig {
  const baseUrl = process.env.CLIENT_RADAR_BASE_URL;
  if (!baseUrl) {
    throw new Error("CLIENT_RADAR_BASE_URL is not configured.");
  }

  const apiToken = process.env.CLIENT_RADAR_API_TOKEN;
  if (!apiToken) {
    throw new Error("CLIENT_RADAR_API_TOKEN is not configured.");
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiToken };
}

async function clientRadarFetch(
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const { baseUrl, apiToken } = getConfig();

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${apiToken}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let data: unknown;
  let parseFailed = false;
  try {
    data = await response.json();
  } catch {
    parseFailed = true;
  }

  if (parseFailed) {
    throw new ClientRadarApiError(
      response.status,
      "Client Radar returned a malformed or non-JSON response.",
    );
  }

  if (!response.ok) {
    throw new ClientRadarApiError(
      response.status,
      `Client Radar returned HTTP ${response.status}.`,
    );
  }

  return data;
}

function presentString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

// ---------------------------------------------------------------------------
// POST /api/gtm/research-runs
// ---------------------------------------------------------------------------

export interface SubmitClientRadarResearchInput {
  company: string;
  domain?: string | null;
  country?: string | null;
  industry?: string | null;
}

export interface SubmitClientRadarResearchResult {
  run_id: string;
  status: ClientRadarRunStatus;
  message: string | null;
  data: null;
}

// HTTP 200 with status "failed" is a fully valid parsed response here — the
// run was durably created even though dispatch to the scanner failed. Only
// run_id and status are validated strictly; a 200 must never be assumed to
// mean the research run itself completed.
function parseSubmitResponse(data: unknown): SubmitClientRadarResearchResult {
  if (typeof data !== "object" || data === null) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned an unexpected response shape for research-run submission.",
    );
  }

  const record = data as Record<string, unknown>;

  if (!isNonEmptyString(record.run_id)) {
    throw new ClientRadarApiError(
      502,
      "Client Radar response is missing a valid run_id.",
    );
  }

  if (!isClientRadarRunStatus(record.status)) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned an unrecognized research-run status.",
    );
  }

  return {
    run_id: record.run_id,
    status: record.status,
    message: typeof record.message === "string" ? record.message : null,
    data: null,
  };
}

export async function submitClientRadarResearch(
  input: SubmitClientRadarResearchInput,
): Promise<SubmitClientRadarResearchResult> {
  const domain = presentString(input.domain);
  const country = presentString(input.country);
  const industry = presentString(input.industry);

  const data = await clientRadarFetch("/api/gtm/research-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companies: [input.company],
      ...(domain !== undefined ? { domain } : {}),
      ...(country !== undefined ? { country } : {}),
      ...(industry !== undefined ? { industry } : {}),
    }),
  });

  return parseSubmitResponse(data);
}

// ---------------------------------------------------------------------------
// GET /api/gtm/research-runs/:runId/status
// ---------------------------------------------------------------------------

export interface ClientRadarStatusResult {
  run_id: string;
  status: ClientRadarRunStatus;
  message: string | null;
  data: {
    error_code: string | null;
    run_type: string;
    requested_at: string;
    started_at: string | null;
    completed_at: string | null;
    failed_at: string | null;
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseStatusResponse(data: unknown): ClientRadarStatusResult {
  if (typeof data !== "object" || data === null) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned an unexpected response shape for research-run status.",
    );
  }

  const record = data as Record<string, unknown>;

  if (!isNonEmptyString(record.run_id)) {
    throw new ClientRadarApiError(
      502,
      "Client Radar response is missing a valid run_id.",
    );
  }

  if (!isClientRadarRunStatus(record.status)) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned an unrecognized research-run status.",
    );
  }

  if (typeof record.data !== "object" || record.data === null) {
    throw new ClientRadarApiError(
      502,
      "Client Radar response is missing the status data object.",
    );
  }

  const nested = record.data as Record<string, unknown>;

  if (typeof nested.run_type !== "string" || typeof nested.requested_at !== "string") {
    throw new ClientRadarApiError(
      502,
      "Client Radar status data is missing required fields.",
    );
  }

  return {
    run_id: record.run_id,
    status: record.status,
    message: typeof record.message === "string" ? record.message : null,
    data: {
      error_code: nullableString(nested.error_code),
      run_type: nested.run_type,
      requested_at: nested.requested_at,
      started_at: nullableString(nested.started_at),
      completed_at: nullableString(nested.completed_at),
      failed_at: nullableString(nested.failed_at),
    },
  };
}

export async function getClientRadarResearchStatus(
  runId: string,
): Promise<ClientRadarStatusResult> {
  const data = await clientRadarFetch(
    `/api/gtm/research-runs/${encodeURIComponent(runId)}/status`,
    { method: "GET" },
  );

  return parseStatusResponse(data);
}

// ---------------------------------------------------------------------------
// GET /api/gtm/research-runs/:runId/result
// ---------------------------------------------------------------------------

export interface ClientRadarEvidenceItem {
  id: string;
  source_type: string | null;
  title: string | null;
  url: string | null;
  content: string | null;
  created_at: string;
}

export interface ClientRadarResultAccount {
  company: string;
  domain: string | null;
  country: string | null;
  industry: string | null;
  account: Record<string, unknown> | null;
  evidence: {
    items: ClientRadarEvidenceItem[];
    total: number;
  };
}

export type ClientRadarResultResponse =
  | {
      run_id: string;
      status: Exclude<ClientRadarRunStatus, "completed">;
      message: string | null;
      accounts: [];
    }
  | {
      run_id: string;
      status: "completed";
      message: null;
      accounts: ClientRadarResultAccount[];
    };

function parseEvidenceItem(value: unknown): ClientRadarEvidenceItem {
  if (typeof value !== "object" || value === null) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned a malformed evidence item.",
    );
  }

  const record = value as Record<string, unknown>;

  if (!isNonEmptyString(record.id) || typeof record.created_at !== "string") {
    throw new ClientRadarApiError(
      502,
      "Client Radar evidence item is missing required fields.",
    );
  }

  return {
    id: record.id,
    source_type: nullableString(record.source_type),
    title: nullableString(record.title),
    url: nullableString(record.url),
    content: nullableString(record.content),
    created_at: record.created_at,
  };
}

function parseResultAccount(value: unknown): ClientRadarResultAccount {
  if (typeof value !== "object" || value === null) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned a malformed account result.",
    );
  }

  const record = value as Record<string, unknown>;

  if (typeof record.company !== "string") {
    throw new ClientRadarApiError(
      502,
      "Client Radar account result is missing a company name.",
    );
  }

  const account =
    typeof record.account === "object" && record.account !== null
      ? (record.account as Record<string, unknown>)
      : null;

  const evidence =
    typeof record.evidence === "object" && record.evidence !== null
      ? (record.evidence as Record<string, unknown>)
      : null;

  if (!evidence || !Array.isArray(evidence.items) || typeof evidence.total !== "number") {
    throw new ClientRadarApiError(
      502,
      "Client Radar account result is missing evidence data.",
    );
  }

  return {
    company: record.company,
    domain: nullableString(record.domain),
    country: nullableString(record.country),
    industry: nullableString(record.industry),
    account,
    evidence: {
      items: evidence.items.map(parseEvidenceItem),
      total: evidence.total,
    },
  };
}

function parseResultResponse(data: unknown): ClientRadarResultResponse {
  if (typeof data !== "object" || data === null) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned an unexpected response shape for research-run result.",
    );
  }

  const record = data as Record<string, unknown>;

  if (!isNonEmptyString(record.run_id)) {
    throw new ClientRadarApiError(
      502,
      "Client Radar response is missing a valid run_id.",
    );
  }

  if (!isClientRadarRunStatus(record.status)) {
    throw new ClientRadarApiError(
      502,
      "Client Radar returned an unrecognized research-run status.",
    );
  }

  if (record.status !== "completed") {
    return {
      run_id: record.run_id,
      status: record.status,
      message: typeof record.message === "string" ? record.message : null,
      accounts: [],
    };
  }

  if (!Array.isArray(record.accounts)) {
    throw new ClientRadarApiError(
      502,
      "Client Radar completed result is missing an accounts array.",
    );
  }

  return {
    run_id: record.run_id,
    status: "completed",
    message: null,
    accounts: record.accounts.map(parseResultAccount),
  };
}

export async function getClientRadarResearchResult(
  runId: string,
): Promise<ClientRadarResultResponse> {
  const data = await clientRadarFetch(
    `/api/gtm/research-runs/${encodeURIComponent(runId)}/result`,
    { method: "GET" },
  );

  return parseResultResponse(data);
}
