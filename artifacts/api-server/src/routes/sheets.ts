import { Router } from "express";
import { google } from "googleapis";
import { MOCK_QUEUE, MOCK_ACCOUNT_QUEUE } from "@workspace/gtm-shared";
import { logger } from "../lib/logger";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAuth() {
  const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonStr) return null;
  try {
    const credentials = JSON.parse(jsonStr) as object;
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  } catch (err) {
    logger.warn({ err }, "Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON");
    return null;
  }
}

async function readTab(
  sheetId: string,
  tab: string,
): Promise<Record<string, string>[]> {
  const auth = buildAuth();
  if (!auth) throw new Error("Google credentials not configured");

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: tab,
  });

  const [headers, ...dataRows] = response.data.values ?? [];
  if (!Array.isArray(headers) || headers.length === 0) return [];

  return dataRows.map((row: string[]) =>
    Object.fromEntries(
      (headers as string[]).map((h: string, i: number) => [h, row[i] ?? ""]),
    ),
  );
}

async function readConfigMap(sheetId: string): Promise<Record<string, string>> {
  const rows = await readTab(sheetId, "ICP_Config");
  const map: Record<string, string> = {};
  for (const row of rows) {
    const key = row["key"] ?? row["config_key"] ?? "";
    const val = row["value"] ?? row["config_value"] ?? "";
    if (key) map[key] = val;
  }
  return map;
}

function sheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SHEET_ID,
  );
}

// Keys the browser is allowed to receive from ICP_Config.
// Everything else is stripped before the response leaves the server.
const SAFE_CONFIG_KEYS = new Set([
  "engine_mode",
  "us_voice_cleared",
  "queue_source",
  "account_queue_write",
]);

function stripSensitiveConfigKeys(
  config: Record<string, string>,
): Record<string, string> {
  const SENSITIVE = /secret|token|password|key/i;
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (SAFE_CONFIG_KEYS.has(k)) {
      safe[k] = v;
    } else if (!SENSITIVE.test(k)) {
      safe[k] = v;
    }
  }
  return safe;
}

// ---------------------------------------------------------------------------
// GET /api/sheets/config
// ---------------------------------------------------------------------------
router.get("/config", async (req, res) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetsConfigured() || !sheetId) {
    res.json({ config: {}, usingSampleData: true });
    return;
  }
  try {
    const raw = await readConfigMap(sheetId);
    const config = stripSensitiveConfigKeys(raw);
    res.json({ config, usingSampleData: false });
  } catch (err) {
    req.log.warn({ err }, "sheets/config: falling back to empty config");
    res.json({ config: {}, usingSampleData: true });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sheets/queue
// ---------------------------------------------------------------------------
router.get("/queue", async (req, res) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetsConfigured() || !sheetId) {
    res.json({
      source: "signal_queue",
      tab: "ICP_Review_Queue",
      rows: MOCK_QUEUE,
      usingSampleData: true,
    });
    return;
  }

  let queueSource = "signal_queue";
  let tab = "ICP_Review_Queue";

  try {
    const config = await readConfigMap(sheetId);
    queueSource = config["queue_source"] ?? "signal_queue";
    tab =
      String(queueSource).toLowerCase() === "account_queue"
        ? "ICP_Account_Queue"
        : "ICP_Review_Queue";

    const rows = await readTab(sheetId, tab);
    res.json({ source: queueSource, tab, rows, usingSampleData: false });
  } catch (err) {
    req.log.warn({ err }, "sheets/queue: falling back to sample data");
    const isSampleAccountQueue =
      String(queueSource).toLowerCase() === "account_queue";
    res.json({
      source: queueSource,
      tab,
      rows: isSampleAccountQueue ? MOCK_ACCOUNT_QUEUE : MOCK_QUEUE,
      usingSampleData: true,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sheets/suppression
// ---------------------------------------------------------------------------
router.get("/suppression", async (req, res) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetsConfigured() || !sheetId) {
    res.json({ rows: [], usingSampleData: true });
    return;
  }

  try {
    const rows = await readTab(sheetId, "ICP_Suppression");
    res.json({ rows, usingSampleData: false });
  } catch (err) {
    req.log.warn({ err }, "sheets/suppression: could not read suppression tab");
    res.json({ rows: [], usingSampleData: true });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sheets/action-log
// ---------------------------------------------------------------------------
router.get("/action-log", async (req, res) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetsConfigured() || !sheetId) {
    res.json({ rows: [], usingSampleData: true });
    return;
  }

  try {
    const rows = await readTab(sheetId, "ICP_Action_Log");
    res.json({ rows, usingSampleData: false });
  } catch (err) {
    req.log.warn({ err }, "sheets/action-log: could not read action log tab");
    // Sheet is connected but this tab may be empty or not yet created
    res.json({ rows: [], usingSampleData: false });
  }
});

export default router;
