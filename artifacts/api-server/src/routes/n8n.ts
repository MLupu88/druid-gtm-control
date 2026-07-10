import { Router, type Request } from "express";
import { ENDPOINTS, CONFIG_WRITES } from "@workspace/gtm-shared";

const router = Router();

// ---------------------------------------------------------------------------
// Helper: flatten cockpit row/top-level fields into the flat contact shape
// n8n expects. top-level values win over row values when both are present.
// ---------------------------------------------------------------------------
function flattenN8nPayload(input: { row?: any; [k: string]: any }) {
  const { row = {}, ...top } = input;

  const pick = (...ks: string[]) => {
    for (const k of ks) {
      const topValue = top?.[k];
      if (topValue !== undefined && topValue !== null && topValue !== "") return topValue;

      const rowValue = row?.[k];
      if (rowValue !== undefined && rowValue !== null && rowValue !== "") return rowValue;
    }
    return "";
  };

  const contact_email = pick("contact_email", "best_contact_email");
  const contact_phone = pick("contact_phone", "best_contact_phone");
  const linkedin = pick("linkedin", "best_contact_linkedin");
  const contact_name = pick("contact_name", "best_contact_name");
  const contact_title = pick("contact_title", "best_contact_title");

  return {
    ...row,
    contact_email,
    contact_phone,
    linkedin,
    contact_name,
    contact_title,
    selected_contact: {
      email: contact_email,
      phone: contact_phone,
      linkedin,
      name: contact_name,
      title: contact_title,
    },
    ...top,
  };
}

// ---------------------------------------------------------------------------
// Helper: POST to n8n with two distinct server-side auth layers.
//
// Every n8n request:
//   x-gtm-receiver-secret -> N8N_RECEIVER_SECRET
//
// Control-plane requests additionally:
//   x-gtm-secret -> N8N_WEBHOOK_SECRET
// ---------------------------------------------------------------------------
const CONTROL_ENDPOINTS = new Set<string>([
  ENDPOINTS.activate,
  ENDPOINTS.decision,
  ENDPOINTS.action,
  ENDPOINTS.config,
]);

async function postToN8n(
  endpoint: string,
  body: object,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const baseUrl = process.env.N8N_BASE_URL;
  const receiverSecret = process.env.N8N_RECEIVER_SECRET;
  const controlSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!baseUrl) {
    throw new Error("Automation engine URL is not configured.");
  }

  if (!receiverSecret) {
    throw new Error("Automation engine receiver secret is not configured.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-gtm-receiver-secret": receiverSecret,
  };

  if (CONTROL_ENDPOINTS.has(endpoint)) {
    if (!controlSecret) {
      throw new Error("Automation engine control secret is not configured.");
    }

    headers["x-gtm-secret"] = controlSecret;
  }

  const url = `${baseUrl.replace(/\/$/, "")}${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });

  const data = await response
    .json()
    .catch(() => ({ rawStatus: response.status }));

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

// ---------------------------------------------------------------------------
// GET /api/n8n/status
// ---------------------------------------------------------------------------
router.get("/status", async (req, res) => {
  const baseUrl = process.env.N8N_BASE_URL;
  if (!baseUrl) {
    res.json({ configured: false, reachable: null });
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(baseUrl, { method: "HEAD", signal: controller.signal });
    clearTimeout(timer);
    res.json({ configured: true, reachable: true, statusCode: response.status });
  } catch (err) {
    req.log.info({ err }, "n8n/status: base URL unreachable");
    res.json({ configured: true, reachable: false });
  }
});

// ---------------------------------------------------------------------------
// Helper: stamp the server-verified operator identity onto an n8n payload.
// approved_by / approved_by_email / operator_role / approved_at are always
// derived from req.operator (set by requireAuth from the signed auth
// cookie) — any approved_by / approved_by_email sent by the client is
// ignored so the audit trail can't be spoofed from the browser.
// ---------------------------------------------------------------------------
function withOperatorStamp(req: Request) {
  const operator = req.operator;
  if (!operator) {
    throw new Error("Authentication required.");
  }
  return {
    approved_by: operator.name,
    approved_by_email: operator.email,
    operator_role: operator.role,
    approved_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// POST /api/n8n/activate  — approve voice / email / linkedin
// Body: { channel, row, reason }
// ---------------------------------------------------------------------------
router.post("/activate", async (req, res) => {
  const { channel, row, reason } = req.body as Record<string, unknown>;
  if (!channel || !reason) {
    res.status(400).json({ error: "channel and reason are required." });
    return;
  }
  try {
    const result = await postToN8n(
      ENDPOINTS.activate,
      flattenN8nPayload({ channel, row, reason, ...withOperatorStamp(req) }),
    );
    res.json(result);
  } catch (err: unknown) {
    req.log.warn({ err }, "n8n/activate failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "Could not reach the automation engine.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/n8n/decision  — reject / nurture / manual_review / suppress
// Body: { decision, row, reason }
// ---------------------------------------------------------------------------
router.post("/decision", async (req, res) => {
  const { decision, row, reason } = req.body as Record<string, unknown>;
  if (!decision || !reason) {
    res.status(400).json({ error: "decision and reason are required." });
    return;
  }
  try {
    const result = await postToN8n(
      ENDPOINTS.decision,
      flattenN8nPayload({ decision, row, reason, ...withOperatorStamp(req) }),
    );
    res.json(result);
  } catch (err: unknown) {
    req.log.warn({ err }, "n8n/decision failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "Could not reach the automation engine.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/n8n/action  — owner_alert / retry
// Body: { action, row, reason }
// ---------------------------------------------------------------------------
router.post("/action", async (req, res) => {
  const { action, row, reason } = req.body as Record<string, unknown>;
  if (!action || !reason) {
    res.status(400).json({ error: "action and reason are required." });
    return;
  }
  try {
    const result = await postToN8n(
      ENDPOINTS.action,
      flattenN8nPayload({ action, row, reason, ...withOperatorStamp(req) }),
    );
    res.json(result);
  } catch (err: unknown) {
    req.log.warn({ err }, "n8n/action failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "Could not reach the automation engine.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/n8n/config  — allowlisted keys only
// Body: { key, value, approved_by, approved_at, reason }
// ---------------------------------------------------------------------------
router.post("/config", async (req, res) => {
  const { key, value, reason } = req.body as Record<string, unknown>;

  if (!key || !value || !reason) {
    res.status(400).json({ error: "key, value, and reason are required." });
    return;
  }

  const keyStr = String(key);
  const valStr = String(value);
  const allowedKeys = Object.keys(CONFIG_WRITES) as (keyof typeof CONFIG_WRITES)[];

  if (!allowedKeys.includes(keyStr as keyof typeof CONFIG_WRITES)) {
    res.status(400).json({ error: `Config key '${keyStr}' is not allowed.` });
    return;
  }

  const allowedVals =
    CONFIG_WRITES[keyStr as keyof typeof CONFIG_WRITES] as string[];

  if (!allowedVals.includes(valStr)) {
    res.status(400).json({
      error: `Value '${valStr}' is not allowed for key '${keyStr}'.`,
    });
    return;
  }

  try {
    const result = await postToN8n(ENDPOINTS.config, {
      key: keyStr,
      value: valStr,
      reason,
      ...withOperatorStamp(req),
    });

    res.json(result);
  } catch (err: unknown) {
    req.log.warn({ err }, "n8n/config failed");
    res.status(502).json({
      error:
        err instanceof Error
          ? err.message
          : "Could not reach the automation engine.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/n8n/test-signal  — "Try a Sample Lead" ONLY — shadow engine
// Never routes to the live intake (/icp-signal-intake).
// Body: { preset, ...extra }
// ---------------------------------------------------------------------------
router.post("/test-signal", async (req, res) => {
  const { preset } = req.body as Record<string, unknown>;
  if (!preset) {
    res.status(400).json({ error: "preset is required." });
    return;
  }
  try {
    const result = await postToN8n(ENDPOINTS.testSignal, { ...req.body, test_mode: true });
    res.json(result);
  } catch (err: unknown) {
    req.log.warn({ err }, "n8n/test-signal failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "Could not reach the automation engine.",
    });
  }
});

export default router;
