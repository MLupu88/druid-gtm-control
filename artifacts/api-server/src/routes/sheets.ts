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


interface CampaignAccountIndexes {
  byAccountKey: Map<string, Record<string, string>>;
  byDomain: Map<string, Record<string, string>>;
}

function buildCampaignAccountIndexes(
  accountRows: Record<string, string>[],
): CampaignAccountIndexes {
  const byAccountKey = new Map<string, Record<string, string>>();
  const byDomain = new Map<string, Record<string, string>>();

  for (const account of accountRows) {
    const accountKey = firstString(account.account_key).toLowerCase();
    const domain = firstString(account.company_domain).toLowerCase();

    if (accountKey) byAccountKey.set(accountKey, account);
    if (domain) byDomain.set(domain, account);
  }

  return { byAccountKey, byDomain };
}

function findCampaignAccount(
  row: Record<string, string>,
  indexes: CampaignAccountIndexes,
): Record<string, string> | undefined {
  const accountKey = firstString(row.account_key).toLowerCase();
  const domain = firstString(row.company_domain).toLowerCase();

  return (
    (accountKey ? indexes.byAccountKey.get(accountKey) : undefined) ??
    (domain ? indexes.byDomain.get(domain) : undefined)
  );
}

function normalizeCampaignRow(
  row: Record<string, string>,
  indexes: CampaignAccountIndexes,
): Record<string, string> {
  const payload = parseActionPayload(row.payload_json);
  const account = findCampaignAccount(row, indexes);

  const campaignKey = firstString(
    row.campaign_key,
    payload.campaign_key,
    row.campaign,
    payload.campaign,
    row.latest_campaign,
    payload.latest_campaign,
    row.campaign_name,
    payload.campaign_name,
    account?.campaign_key,
    account?.campaign,
    account?.latest_campaign,
    account?.campaign_name,
  );

  const campaignName = firstString(
    row.campaign_name,
    payload.campaign_name,
    account?.campaign_name,
    campaignKey,
  );

  return {
    ...row,

    account_key: firstString(
      row.account_key,
      payload.account_key,
      account?.account_key,
    ),

    company_domain: firstString(
      row.company_domain,
      payload.company_domain,
      account?.company_domain,
    ),

    company_name: firstString(
      row.company_name,
      payload.company_name,
      account?.company_name,
    ),

    campaign_key: campaignKey,
    campaign_name: campaignName,

    latest_campaign: firstString(
      row.latest_campaign,
      payload.latest_campaign,
      account?.latest_campaign,
      campaignKey,
    ),

    recommended_output: firstString(
      row.recommended_output,
      payload.recommended_output,
      account?.recommended_output,
    ),

    recommended_action: firstString(
      row.recommended_action,
      payload.recommended_action,
      account?.recommended_action,
    ),

    recommended_solution: firstString(
      row.recommended_solution,
      payload.recommended_solution,
      account?.recommended_solution,
    ),

    why_now: firstString(
      row.why_now,
      payload.why_now,
      payload.signal_detail,
      account?.why_now,
    ),

    final_status: firstString(
      row.final_status,
      row.status,
      payload.final_status,
      payload.status,
    ),

    status: firstString(
      row.status,
      payload.status,
      row.final_status,
      payload.final_status,
    ),

    actual_cost: firstString(
      row.actual_cost,
      payload.actual_cost,
    ),

    estimated_cost: firstString(
      row.estimated_cost,
      payload.estimated_cost,
      row.cost,
      payload.cost,
    ),

    outcome: firstString(
      row.outcome,
      payload.outcome,
    ),

    outcome_status: firstString(
      row.outcome_status,
      payload.outcome_status,
    ),
  };
}

function campaignRowTimestamp(
  row: Record<string, string>,
): Date | null {
  const value = firstString(
    row.event_at,
    row.signal_at,
    row.action_at,
    row.approved_at,
    row.timestamp,
    row.latest_signal_at,
    row.last_signal_at,
    row.updated_at,
    row.created_at,
  );

  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCampaignDateBoundary(
  value: unknown,
  endOfDay: boolean,
): Date | null {
  const raw = firstString(value);
  if (!raw) return null;

  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? `${raw}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`
      : raw;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function campaignRowInPeriod(
  row: Record<string, string>,
  start: Date | null,
  end: Date | null,
): boolean {
  if (!start && !end) return true;

  const timestamp = campaignRowTimestamp(row);
  if (!timestamp) return false;

  if (start && timestamp < start) return false;
  if (end && timestamp > end) return false;

  return true;
}

function campaignAccountIdentity(
  row: Record<string, string>,
): string {
  const accountKey = firstString(row.account_key).toLowerCase();
  if (accountKey) return `account:${accountKey}`;

  const domain = firstString(row.company_domain).toLowerCase();
  if (domain) return `domain:${domain}`;

  const email = firstString(
    row.contact_email,
    row.selected_contact_email,
  ).toLowerCase();
  if (email) return `email:${email}`;

  const companyName = firstString(row.company_name).toLowerCase();
  if (companyName) return `company:${companyName}`;

  return "";
}

function dedupeCampaignRows(
  rows: Record<string, string>[],
): Record<string, string>[] {
  const seen = new Set<string>();

  return rows.filter((row, index) => {
    const identity =
      campaignAccountIdentity(row) ||
      `row:${index}:${firstString(row.event_id, row.timestamp)}`;

    if (seen.has(identity)) return false;

    seen.add(identity);
    return true;
  });
}

function campaignAttributionSummary(
  rows: Record<string, string>[],
): {
  total: number;
  attributed: number;
  unattributed: number;
} {
  const attributed = rows.filter((row) =>
    firstString(row.campaign_key, row.campaign_name)
  ).length;

  return {
    total: rows.length,
    attributed,
    unattributed: rows.length - attributed,
  };
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
// GET /api/sheets/campaign-report
// ---------------------------------------------------------------------------
router.get("/campaign-report", async (req, res) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetsConfigured() || !sheetId) {
    res.json({
      campaigns: [],
      selected_campaign: null,
      period: {
        start: null,
        end: null,
        mode: "campaign_lifetime",
      },
      summary: {
        signals: 0,
        unique_accounts: 0,
        accounts_reviewed: 0,
        accounts_requiring_attention: 0,
        recommended_actions: 0,
        human_decisions: 0,
        actions_logged: 0,
        outcomes_recorded: 0,
        actual_cost_actions: 0,
        estimated_cost_actions: 0,
        unavailable_cost_actions: 0,
      },
      attention_accounts: [],
      recommendations: [],
      decisions: [],
      actions: [],
      outcomes: [],
      costs: [],
      manual_exports: {
        linkedin_ready: 0,
        linkedin_exported: 0,
        linkedin_imported: 0,
        outcomes_received: 0,
      },
      attribution: {},
      limitations: ["Google Sheets is not configured."],
      usingSampleData: true,
    });
    return;
  }

  const readOptionalTab = async (
    tab: string,
  ): Promise<Record<string, string>[]> => {
    try {
      return await readTab(sheetId, tab);
    } catch (err) {
      req.log.warn(
        { err, tab },
        "sheets/campaign-report: optional tab unavailable",
      );
      return [];
    }
  };

  try {
    const [
      rawSignalRows,
      rawAccountRows,
      rawReviewQueueRows,
      rawAccountQueueRows,
      rawActionRows,
    ] = await Promise.all([
      readOptionalTab("ICP_Signal_Events"),
      readOptionalTab("ICP_Account_Records"),
      readOptionalTab("ICP_Review_Queue"),
      readOptionalTab("ICP_Account_Queue"),
      readOptionalTab("ICP_Action_Log"),
    ]);

    const accountIndexes =
      buildCampaignAccountIndexes(rawAccountRows);

    const signalRows = rawSignalRows.map((row) =>
      normalizeCampaignRow(row, accountIndexes)
    );

    const accountRows = rawAccountRows.map((row) =>
      normalizeCampaignRow(row, accountIndexes)
    );

    const reviewQueueRows = rawReviewQueueRows.map((row) =>
      normalizeCampaignRow(row, accountIndexes)
    );

    const accountQueueRows = rawAccountQueueRows.map((row) =>
      normalizeCampaignRow(row, accountIndexes)
    );

    const actionRows = rawActionRows
      .map(normalizeActionLogRow)
      .map((row) => normalizeCampaignRow(row, accountIndexes));

    const allRows = [
      ...signalRows,
      ...accountRows,
      ...reviewQueueRows,
      ...accountQueueRows,
      ...actionRows,
    ];

    const campaignMap = new Map<string, string>();

    for (const row of allRows) {
      const campaignKey = firstString(row.campaign_key);
      const campaignName = firstString(
        row.campaign_name,
        campaignKey,
      );

      if (campaignKey && !campaignMap.has(campaignKey)) {
        campaignMap.set(campaignKey, campaignName);
      }
    }

    const campaigns = Array.from(campaignMap.entries())
      .map(([campaign_key, campaign_name]) => {
        const matches = (row: Record<string, string>) =>
          row.campaign_key === campaign_key;

        return {
          campaign_key,
          campaign_name,
          signal_count: signalRows.filter(matches).length,
          account_count: dedupeCampaignRows(
            accountRows.filter(matches),
          ).length,
          action_count: actionRows.filter(matches).length,
        };
      })
      .sort((a, b) =>
        a.campaign_name.localeCompare(b.campaign_name)
      );

    const requestedCampaign = firstString(
      req.query.campaign,
    );

    const selectedDefinition = requestedCampaign
      ? campaigns.find(
          (campaign) =>
            campaign.campaign_key === requestedCampaign ||
            campaign.campaign_name === requestedCampaign,
        )
      : campaigns[0];

    const selectedCampaignKey = firstString(
      selectedDefinition?.campaign_key,
      requestedCampaign,
    );

    const selectedCampaignName = firstString(
      selectedDefinition?.campaign_name,
      campaignMap.get(selectedCampaignKey),
      selectedCampaignKey,
    );

    const periodStart = parseCampaignDateBoundary(
      req.query.start,
      false,
    );

    const periodEnd = parseCampaignDateBoundary(
      req.query.end,
      true,
    );

    const selectRows = (
      rows: Record<string, string>[],
    ): Record<string, string>[] =>
      rows.filter((row) => {
        if (!selectedCampaignKey) return false;

        const campaignMatches =
          row.campaign_key === selectedCampaignKey ||
          row.campaign_name === selectedCampaignKey ||
          row.campaign_name === selectedCampaignName;

        return (
          campaignMatches &&
          campaignRowInPeriod(row, periodStart, periodEnd)
        );
      });

    const selectedSignals = selectRows(signalRows);
    const selectedAccounts = selectRows(accountRows);
    const selectedReviewQueue = selectRows(reviewQueueRows);
    const selectedAccountQueue = selectRows(accountQueueRows);
    const selectedActions = selectRows(actionRows);

    const uniqueAccountRows = dedupeCampaignRows([
      ...selectedSignals,
      ...selectedAccounts,
      ...selectedReviewQueue,
      ...selectedAccountQueue,
      ...selectedActions,
    ]);

    const reviewedAccountRows =
      dedupeCampaignRows(selectedActions);

    const reviewedIdentities = new Set(
      reviewedAccountRows
        .map(campaignAccountIdentity)
        .filter(Boolean),
    );

    const attentionPattern =
      /sales review|human triage|manual review|owner alert|pipeline assist/i;

    const attentionCandidates = [
      ...selectedReviewQueue,
      ...selectedAccountQueue,
      ...selectedAccounts.filter((row) =>
        attentionPattern.test(
          firstString(
            row.recommended_output,
            row.recommended_action,
            row.final_status,
          ),
        )
      ),
    ].filter((row) => {
      const identity = campaignAccountIdentity(row);
      return !identity || !reviewedIdentities.has(identity);
    });

    const attentionAccounts =
      dedupeCampaignRows(attentionCandidates).map((row) => ({
        account_key: row.account_key,
        company_name: row.company_name,
        company_domain: row.company_domain,
        why_now: row.why_now,
        recommended_output: row.recommended_output,
        recommended_action: row.recommended_action,
        recommended_solution: row.recommended_solution,
        final_status: row.final_status,
      }));

    const recommendations = dedupeCampaignRows(
      selectedAccounts.filter((row) =>
        firstString(
          row.recommended_output,
          row.recommended_action,
          row.recommended_solution,
        ),
      ),
    ).map((row) => ({
      account_key: row.account_key,
      company_name: row.company_name,
      company_domain: row.company_domain,
      why_now: row.why_now,
      recommended_output: row.recommended_output,
      recommended_action: row.recommended_action,
      recommended_solution: row.recommended_solution,
    }));

    const actions = selectedActions.map((row) => {
      const actualCost = firstString(row.actual_cost);
      const estimatedCost = firstString(
        row.estimated_cost,
      );

      const outcome = firstString(row.outcome);
      const outcomeStatus = firstString(
        row.outcome_status,
      );

      return {
        account_key: row.account_key,
        company_name: row.company_name,
        company_domain: row.company_domain,
        action_type: firstString(
          row.action_type,
          row.recommended_output,
          row.recommended_action,
        ),
        recommended_output: row.recommended_output,
        recommended_action: row.recommended_action,
        final_status: row.final_status,
        status: row.status,
        why_now: row.why_now,
        action_at: firstString(
          row.action_at,
          row.approved_at,
          row.timestamp,
        ),
        actual_cost: actualCost,
        estimated_cost: estimatedCost,
        cost_status: actualCost
          ? "actual"
          : estimatedCost
            ? "estimated"
            : "unavailable",
        outcome,
        outcome_status: outcomeStatus,
      };
    });

    const decisions = actions
      .filter((action) =>
        firstString(
          action.final_status,
          action.status,
        ),
      )
      .map((action) => ({
        account_key: action.account_key,
        company_name: action.company_name,
        company_domain: action.company_domain,
        decision: firstString(
          action.final_status,
          action.status,
        ),
        decided_at: action.action_at,
        why_now: action.why_now,
      }));

    const outcomes = actions
      .filter((action) =>
        firstString(
          action.outcome,
          action.outcome_status,
        ),
      )
      .map((action) => ({
        account_key: action.account_key,
        company_name: action.company_name,
        company_domain: action.company_domain,
        outcome: action.outcome,
        outcome_status: action.outcome_status,
        recorded_at: action.action_at,
      }));

    const costs = actions.map((action) => ({
      account_key: action.account_key,
      company_name: action.company_name,
      action_type: action.action_type,
      actual_cost: action.actual_cost,
      estimated_cost: action.estimated_cost,
      cost_status: action.cost_status,
    }));

    const linkedinReady = actions.filter(
      (action) =>
        action.final_status ===
        "approved_linkedin_pending_tool",
    ).length;

    const linkedinExported = actions.filter(
      (action) =>
        /exported.*dripify/i.test(
          firstString(action.status, action.final_status),
        ),
    ).length;

    const linkedinImported = actions.filter(
      (action) =>
        /imported.*dripify/i.test(
          firstString(action.status, action.final_status),
        ),
    ).length;

    const outcomesReceived = outcomes.filter(
      (outcome) =>
        /received|completed|converted|responded/i.test(
          firstString(
            outcome.outcome_status,
            outcome.outcome,
          ),
        ),
    ).length;

    const attribution = {
      signal_events:
        campaignAttributionSummary(signalRows),
      account_records:
        campaignAttributionSummary(accountRows),
      review_queue:
        campaignAttributionSummary(reviewQueueRows),
      account_queue:
        campaignAttributionSummary(accountQueueRows),
      action_log:
        campaignAttributionSummary(actionRows),
    };

    const unattributedTotal = Object.values(
      attribution,
    ).reduce(
      (total, source) => total + source.unattributed,
      0,
    );

    const limitations: string[] = [];

    if (!actions.some((action) => action.actual_cost)) {
      limitations.push(
        "Actual vendor spend is unavailable. Estimated or unavailable cost status is shown.",
      );
    }

    if (outcomes.length === 0) {
      limitations.push(
        "No campaign outcome data is currently connected.",
      );
    }

    if (unattributedTotal > 0) {
      limitations.push(
        `${unattributedTotal} record(s) could not be attributed to a campaign.`,
      );
    }

    if ((periodStart || periodEnd) && allRows.some(
      (row) =>
        row.campaign_key === selectedCampaignKey &&
        !campaignRowTimestamp(row),
    )) {
      limitations.push(
        "Some campaign records have no usable timestamp and are excluded from the selected reporting period.",
      );
    }

    res.json({
      campaigns,
      selected_campaign: selectedCampaignKey
        ? {
            campaign_key: selectedCampaignKey,
            campaign_name: selectedCampaignName,
          }
        : null,
      period: {
        start: periodStart?.toISOString() ?? null,
        end: periodEnd?.toISOString() ?? null,
        mode:
          periodStart || periodEnd
            ? "selected_period"
            : "campaign_lifetime",
      },
      summary: {
        signals: selectedSignals.length,
        unique_accounts: uniqueAccountRows.length,
        accounts_reviewed:
          reviewedAccountRows.length ||
          selectedActions.length,
        accounts_requiring_attention:
          attentionAccounts.length,
        recommended_actions:
          recommendations.length,
        human_decisions: decisions.length,
        actions_logged: actions.length,
        outcomes_recorded: outcomes.length,
        actual_cost_actions: costs.filter(
          (cost) => cost.cost_status === "actual",
        ).length,
        estimated_cost_actions: costs.filter(
          (cost) => cost.cost_status === "estimated",
        ).length,
        unavailable_cost_actions: costs.filter(
          (cost) => cost.cost_status === "unavailable",
        ).length,
      },
      attention_accounts: attentionAccounts,
      recommendations,
      decisions,
      actions,
      outcomes,
      costs,
      manual_exports: {
        linkedin_ready: linkedinReady,
        linkedin_exported: linkedinExported,
        linkedin_imported: linkedinImported,
        outcomes_received: outcomesReceived,
      },
      attribution,
      limitations,
      usingSampleData: false,
    });
  } catch (err) {
    req.log.error(
      { err },
      "sheets/campaign-report: failed to build campaign packet",
    );

    res.status(500).json({
      error: "Campaign report could not be generated.",
      usingSampleData: false,
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
