// server/sheets.js — reads the ICP_Review_Queue tab (and others) with a mock fallback.
// Uses a Google service account (GOOGLE_SERVICE_ACCOUNT_JSON) + GOOGLE_SHEET_ID.
// If creds are absent, returns mock rows so the UI is fully usable before wiring Sheets.
import { google } from "googleapis";
import { MOCK_QUEUE } from "../shared/mockData.js";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

function client() {
  if (!SA || !SHEET_ID) return null;
  const creds = JSON.parse(SA);
  const auth = new google.auth.JWT(creds.client_email, null, creds.private_key,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  return google.sheets({ version: "v4", auth });
}

// Read any tab into array-of-objects keyed by header row.
export async function readTab(tab) {
  const api = client();
  if (!api) return tab === "ICP_Review_Queue" ? MOCK_QUEUE : [];
  const res = await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tab });
  const [headers, ...rows] = res.data.values || [[]];
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// Cache reads briefly so dashboard polling doesn't hammer the Sheets quota.
const cache = new Map();
export async function readTabCached(tab, ttlMs = 5000) {
  const hit = cache.get(tab);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await readTab(tab);
  cache.set(tab, { v, t: Date.now() });
  return v;
}

// PHASE C: pick the live queue tab from ICP_Config.queue_source (defaults to legacy signal queue).
export async function readActiveQueue() {
  let cfg = [];
  try { cfg = await readTabCached("ICP_Config"); } catch (e) { cfg = []; }
  const map = {};
  (cfg || []).forEach((r) => { if (r && r.key != null) map[String(r.key).trim()] = r.value; });
  const source = String(map.queue_source || "signal_queue").trim().toLowerCase();
  const tab = source === "account_queue" ? "ICP_Account_Queue" : "ICP_Review_Queue";
  const rows = await readTabCached(tab);
  return { source, tab, rows };
}
