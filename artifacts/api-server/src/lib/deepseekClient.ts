// LS6 — outbound HTTP client for DeepSeek's chat-completions API
// (OpenAI-compatible shape). Mirrors ./clientRadarClient.ts's own
// convention exactly: env var read per-call (not at module load), fetch
// + AbortSignal.timeout, a typed *NotConfiguredError distinct from a
// genuine API failure, strict response-shape validation (never trust
// the provider blindly). The API key is read from DEEPSEEK_API_KEY and
// is never included in any returned value, thrown error, or log line —
// only the Authorization header of the outgoing request carries it.
//
// This is the ONLY module in this repo that calls an LLM. It is
// intentionally dumb: it knows nothing about Overview, observations, or
// grounding — see ../services/overviewSummary.ts for all of that. This
// module's only job is "send these two prompt strings, get back the
// model's raw text content, or fail loudly."

const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-chat";
const REQUEST_TIMEOUT_MS = 20000;

export const DEEPSEEK_API_KEY_NOT_CONFIGURED_MESSAGE = "DEEPSEEK_API_KEY is not configured.";

export class DeepSeekNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekNotConfiguredError";
  }
}

/** Thrown for any non-2xx or structurally invalid DeepSeek response. Never carries the API key. */
export class DeepSeekApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DeepSeekApiError";
    this.status = status;
  }
}

interface DeepSeekConfig {
  apiKey: string;
}

function getConfig(): DeepSeekConfig {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new DeepSeekNotConfiguredError(DEEPSEEK_API_KEY_NOT_CONFIGURED_MESSAGE);
  }
  return { apiKey };
}

export interface DeepSeekChatCompletionArgs {
  systemPrompt: string;
  userPrompt: string;
  /** Forces DeepSeek's JSON-object response mode (OpenAI-compatible `response_format`). The prompt itself must still instruct the model to produce JSON — this flag alone does not. */
  jsonMode?: boolean;
  /** Test-only override; defaults to the real fetch. */
  fetchImpl?: typeof fetch;
}

function extractMessageContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.choices) || record.choices.length === 0) return null;
  const first = record.choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

/**
 * Sends one system+user prompt pair to DeepSeek and returns the model's
 * raw text content, unparsed and unvalidated — the caller (see
 * ../services/overviewSummary.ts) owns all shape/grounding/language
 * validation. Never retries: a single failed attempt is a single
 * failure, surfaced immediately as a typed error so the caller can map
 * it to a safe "unavailable" state rather than silently retrying a
 * paid API call.
 */
export async function requestDeepSeekChatCompletion(
  args: DeepSeekChatCompletionArgs,
): Promise<string> {
  const { apiKey } = getConfig();
  const doFetch = args.fetchImpl ?? fetch;

  const response = await doFetch(`${DEEPSEEK_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      temperature: 0,
      ...(args.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
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
    throw new DeepSeekApiError(
      response.status,
      "DeepSeek returned a malformed or non-JSON response.",
    );
  }

  if (!response.ok) {
    throw new DeepSeekApiError(response.status, `DeepSeek returned HTTP ${response.status}.`);
  }

  const content = extractMessageContent(data);
  if (content === null) {
    throw new DeepSeekApiError(response.status, "DeepSeek response is missing message content.");
  }

  return content;
}
