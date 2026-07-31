// One-off production data bootstrap for the new GTM PostgreSQL database:
// imports real legacy accounts from the configured Google Sheet's
// ICP_Account_Records tab, and seeds exactly one starter ICP draft
// profile if none exists yet. Safely re-runnable — account import is
// idempotent via accounts.accountKey's unique constraint
// (onConflictDoNothing), and the profile seed is skipped entirely once
// any icp_profiles row already exists.
//
// Explicitly out of scope, by design: legacy signals, evaluations,
// decisions, queues, recommendations, campaign data, and action-log
// history are never read or written here — that is a separate, later
// slice, not something this script attempts.
//
// Requires GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, and DATABASE_URL.
// Run via: pnpm --filter @workspace/api-server run bootstrap:production-data

import { google } from "googleapis";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { createProfile } from "../services/icpProfiles.js";

const { Pool } = pg;

const ACCOUNT_RECORDS_TAB = "ICP_Account_Records";
const STARTER_PROFILE_NAME = "Starter ICP";
const STARTER_PROFILE_DESCRIPTION =
  "Initial draft profile created during the PostgreSQL production cutover. Review and customize before production activation.";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set to run the production data bootstrap.`);
  }
  return value;
}

const googleSheetId = requireEnv("GOOGLE_SHEET_ID");
const googleServiceAccountJson = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
const databaseUrl = requireEnv("DATABASE_URL");

// Exact minimal, schema-valid IcpProfileConfigV1 shape already proven in
// services/icpProfiles.test.ts / routes/icpProfiles.integration.test.ts —
// reused verbatim, not invented here.
function starterProfileConfig() {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "has_domain",
          description: "Has a domain",
          points: 10,
          condition: { op: "exists", field: "company.domain" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

// Same service-account parsing and Google Sheets read approach already
// used in ../routes/sheets.ts's buildAuth()/readTab() — reimplemented
// locally rather than importing that route file's private helpers.
function buildSheetsAuth(serviceAccountJson: string) {
  let credentials: object;
  try {
    credentials = JSON.parse(serviceAccountJson) as object;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON could not be parsed as JSON.");
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

async function readAccountRecordsTab(
  sheetId: string,
  auth: ReturnType<typeof buildSheetsAuth>,
): Promise<Record<string, string>[]> {
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: ACCOUNT_RECORDS_TAB,
  });

  const [headers, ...dataRows] = response.data.values ?? [];
  if (!Array.isArray(headers) || headers.length === 0) return [];

  return dataRows.map((row: string[]) =>
    Object.fromEntries(
      (headers as string[]).map((header, index) => [header, row[index] ?? ""]),
    ),
  );
}

function toNullableTrimmed(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

try {
  // ---------------------------------------------------------------------
  // 1. Import legacy accounts from ICP_Account_Records only. No other
  // column, and no other tab (signals, queues, action log, campaigns), is
  // ever read here.
  // ---------------------------------------------------------------------
  const auth = buildSheetsAuth(googleServiceAccountJson);
  const rows = await readAccountRecordsTab(googleSheetId, auth);
  console.log(`Read ${rows.length} row(s) from "${ACCOUNT_RECORDS_TAB}".`);

  let skippedBlankKey = 0;
  let inserted = 0;
  let alreadyPresent = 0;
  const domainToAccountKeys = new Map<string, Set<string>>();

  for (const row of rows) {
    const accountKey = (row.account_key ?? "").trim();
    if (!accountKey) {
      skippedBlankKey += 1;
      continue;
    }

    const companyDomain = toNullableTrimmed(row.company_domain);
    const companyName = toNullableTrimmed(row.company_name);

    if (companyDomain) {
      const normalizedDomain = companyDomain.toLowerCase();
      const keys = domainToAccountKeys.get(normalizedDomain) ?? new Set<string>();
      keys.add(accountKey);
      domainToAccountKeys.set(normalizedDomain, keys);
    }

    const [insertedRow] = await db
      .insert(schema.accounts)
      .values({ accountKey, companyDomain, companyName })
      .onConflictDoNothing({ target: schema.accounts.accountKey })
      .returning();

    if (insertedRow) {
      inserted += 1;
    } else {
      alreadyPresent += 1;
    }
  }

  console.log(`Skipped ${skippedBlankKey} row(s) with a blank account_key.`);
  console.log(`Inserted ${inserted} new account(s).`);
  console.log(
    `${alreadyPresent} account(s) were already present (accountKey conflict).`,
  );

  for (const [domain, keys] of domainToAccountKeys) {
    if (keys.size > 1) {
      console.warn(
        `WARNING: domain "${domain}" is associated with ${keys.size} distinct accountKeys (${[...keys].join(", ")}) — not deduplicated, review manually.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // 2. Seed exactly one starter ICP draft profile, only if none exists.
  // Never published, never activated — the preview resolver already
  // prefers a draft, so this alone is enough to make the Analysis lens
  // selector usable.
  // ---------------------------------------------------------------------
  const [existingProfile] = await db.select().from(schema.icpProfiles).limit(1);
  if (existingProfile) {
    console.log("An ICP profile already exists — skipping starter profile seed.");
  } else {
    const { profile, draftVersion } = await createProfile({
      db,
      name: STARTER_PROFILE_NAME,
      description: STARTER_PROFILE_DESCRIPTION,
      config: starterProfileConfig(),
      createdBy: null,
    });
    console.log(
      `Created starter ICP profile "${profile.name}" (${profile.id}) with draft version ${draftVersion.versionNumber} (${draftVersion.id}).`,
    );
  }
} finally {
  await pool.end();
}
