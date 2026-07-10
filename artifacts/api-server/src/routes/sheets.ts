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


function parseActionPayload(value: string): Record<string, unknown> {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Older or malformed audit rows remain readable without payload enrichment.
  }

  return {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;

    const result = String(value).trim();
    if (result) return result;
  }

  return "";
}

function normalizeActionLogRow(
  row: Record<string, string>,
): Record<string, string> {
  const payload = parseActionPayload(row.payload_json);

  const selectedContact =
    payload.selected_contact &&
    typeof payload.selected_contact === "object" &&
    !Array.isArray(payload.selected_contact)
      ? (payload.selected_contact as Record<string, unknown>)
      : {};

  return {
    ...row,

    final_status: firstString(
      row.final_status,
      row.status,
      payload.final_status,
      payload.status,
    ),

    campaign_name: firstString(
      row.campaign_name,
      payload.campaign_name,
      payload.latest_campaign,
      payload.campaign,
    ),

    contact_name: firstString(
      row.contact_name,
      row.selected_contact_name,
      selectedContact.name,
      payload.contact_name,
      payload.best_contact_name,
    ),

    contact_email: firstString(
      row.contact_email,
      row.selected_contact_email,
      selectedContact.email,
      payload.contact_email,
      payload.best_contact_email,
    ),

    contact_title: firstString(
      row.contact_title,
      row.selected_contact_title,
      selectedContact.title,
      payload.contact_title,
      payload.best_contact_title,
    ),

    linkedin_profile_url: firstString(
      row.linkedin_profile_url,
      selectedContact.linkedin,
      payload.linkedin_profile_url,
      payload.linkedin,
      payload.best_contact_linkedin,
    ),

    country: firstString(
      row.country,
      payload.country,
      payload.country_raw,
      payload.region,
    ),

    industry: firstString(
      row.industry,
      payload.industry,
    ),

    recommended_solution: firstString(
      row.recommended_solution,
      payload.recommended_solution,
    ),

    why_now: firstString(
      row.why_now,
      payload.why_now,
      payload.signal_detail,
    ),
  };
}


function enrichQueueRowsWithCampaign(
  queueRows: Record<string, string>[],
  accountRows: Record<string, string>[],
): Record<string, string>[] {
  const byAccountKey = new Map<string, Record<string, string>>();
  const byDomain = new Map<string, Record<string, string>>();

  for (const account of accountRows) {
    const accountKey = firstString(account.account_key);
    const domain = firstString(account.company_domain).toLowerCase();

    if (accountKey) byAccountKey.set(accountKey, account);
    if (domain) byDomain.set(domain, account);
  }

  return queueRows.map((row) => {
    const accountKey = firstString(row.account_key);
    const domain = firstString(row.company_domain).toLowerCase();

    const account =
      (accountKey ? byAccountKey.get(accountKey) : undefined) ??
      (domain ? byDomain.get(domain) : undefined);

    if (!account) return row;

    const campaignName = firstString(
      row.campaign_name,
      row.latest_campaign,
      row.campaign,
      account.latest_campaign,
      account.campaign_name,
      account.campaign,
    );

    return {
      ...row,
      campaign_name: campaignName,
      latest_campaign: firstString(
        row.latest_campaign,
        account.latest_campaign,
        campaignName,
      ),
    };
  });
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

    let enrichedRows = rows;

    try {
      const accountRows = await readTab(sheetId, "ICP_Account_Records");
      enrichedRows = enrichQueueRowsWithCampaign(rows, accountRows);
    } catch (accountErr) {
      req.log.warn(
        { err: accountErr },
        "sheets/queue: account campaign enrichment unavailable",
      );
    }

    res.json({
      source: queueSource,
      tab,
      rows: enrichedRows,
      usingSampleData: false,
    });
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
    const rows = (await readTab(sheetId, "ICP_Action_Log")).map(normalizeActionLogRow);
    res.json({ rows, usingSampleData: false });
  } catch (err) {
    req.log.warn({ err }, "sheets/action-log: could not read action log tab");
    // Sheet is connected but this tab may be empty or not yet created
    res.json({ rows: [], usingSampleData: false });
  }
});

export default router;
