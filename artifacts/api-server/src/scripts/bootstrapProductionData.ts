// One-off production data bootstrap for the GTM PostgreSQL database:
// imports the curated operational target accounts from the configured
// Google Sheet's ICP_Target_Accounts tab, seeds exactly one starter ICP
// draft profile if none exists yet, and removes the synthetic
// write-validation account once real target data has been confirmed.
// Safely re-runnable — account import is idempotent via
// accounts.accountKey's unique constraint (onConflictDoNothing), and the
// profile seed is skipped entirely once any icp_profiles row already
// exists.
//
// ICP_Target_Accounts (15 curated operational accounts) is the only
// source read here. "Candidate Accounts" (2,010 draft enrichment/ads
// candidates) must NEVER be read or imported by this script — those are
// not operational accounts and have no place in the canonical accounts
// table. ICP_Account_Records is no longer read at all: production
// confirmed it contains only a single synthetic validation row, not real
// account data.
//
// Explicitly out of scope, by design: legacy signals, evaluations,
// decisions, queues, recommendations, campaign data, and action-log
// history are never read or written here — that is a separate, later
// slice, not something this script attempts.
//
// Requires GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, and DATABASE_URL.
// Run via: pnpm --filter @workspace/api-server run bootstrap:production-data

import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { createProfile } from "../services/icpProfiles.js";

const { Pool } = pg;

const TARGET_ACCOUNTS_TAB = "ICP_Target_Accounts";
const STARTER_PROFILE_NAME = "Starter ICP";
const STARTER_PROFILE_DESCRIPTION =
  "Initial draft profile created during the PostgreSQL production cutover. Review and customize before production activation.";

// The single synthetic row ICP_Account_Records was seeded with to prove
// this script's write path worked, back before ICP_Target_Accounts was
// confirmed as the real source. Removed once real target data has been
// successfully imported — see the cleanup step below.
const SYNTHETIC_VALIDATION_ACCOUNT_KEY =
  "dom:unit-d-write-validation-20260710.com";

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

// Structurally minimal, schema-valid IcpProfileConfigV1 shape — no rules
// invented on the operator's behalf (a fake "has a domain" fit rule
// describes nothing about what makes a good customer, it only confirms a
// company record exists), and no arbitrary tier labels ("base"/"floor"
// carry no business meaning). This mirrors
// ../../../druid-gtm/src/lib/icp-profile-config-editing.ts's
// buildStarterProfileConfig() exactly — the same truthful, empty starting
// point every profile created through the UI gets — so this one-time
// production seed is not a second, divergent definition of "starter".
function starterProfileConfig() {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "not_yet_qualified", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "no_observed_intent", minScore: 0 }] },
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

async function readTargetAccountsTab(
  sheetId: string,
  auth: ReturnType<typeof buildSheetsAuth>,
): Promise<Record<string, string>[]> {
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: TARGET_ACCOUNTS_TAB,
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

// Domain normalization, exactly as specified: trim, lowercase, strip a
// leading http(s):// scheme, strip a leading www., strip trailing
// slashes, and reject an empty result (null, not "").
function normalizeDomain(value: string | undefined): string | null {
  let normalized = (value ?? "").trim().toLowerCase();
  normalized = normalized.replace(/^https?:\/\//, "");
  normalized = normalized.replace(/^www\./, "");
  normalized = normalized.replace(/\/+$/, "");
  return normalized === "" ? null : normalized;
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

try {
  // ---------------------------------------------------------------------
  // 1. Import curated target accounts from ICP_Target_Accounts only.
  // account_name -> companyName, domain -> normalized companyDomain, and
  // the normalized domain also derives accountKey ("dom:<domain>") —
  // there is no separate account-key column on this tab. No other column
  // on this tab, and no other tab (Candidate Accounts, signals, queues,
  // action log, campaigns), is ever read here.
  // ---------------------------------------------------------------------
  const auth = buildSheetsAuth(googleServiceAccountJson);
  const rows = await readTargetAccountsTab(googleSheetId, auth);
  console.log(`Read ${rows.length} row(s) from "${TARGET_ACCOUNTS_TAB}".`);

  let skippedInvalidDomain = 0;
  let inserted = 0;
  let alreadyPresent = 0;
  let validRowCount = 0;

  for (const row of rows) {
    const normalizedDomain = normalizeDomain(row.domain);
    if (!normalizedDomain) {
      skippedInvalidDomain += 1;
      continue;
    }

    validRowCount += 1;
    const accountKey = `dom:${normalizedDomain}`;
    const companyName = toNullableTrimmed(row.account_name);

    const [insertedRow] = await db
      .insert(schema.accounts)
      .values({ accountKey, companyDomain: normalizedDomain, companyName })
      .onConflictDoNothing({ target: schema.accounts.accountKey })
      .returning();

    if (insertedRow) {
      inserted += 1;
    } else {
      alreadyPresent += 1;
    }
  }

  console.log(
    `Skipped ${skippedInvalidDomain} row(s) with a blank or invalid domain.`,
  );
  console.log(`Inserted ${inserted} new account(s).`);
  console.log(
    `${alreadyPresent} account(s) were already present (accountKey conflict).`,
  );

  // ---------------------------------------------------------------------
  // 2. Remove the synthetic write-validation account, but only once the
  // target tab was read without error (guaranteed simply by reaching this
  // point) AND at least one valid target row was actually produced from
  // it — never delete this on the strength of an empty or entirely
  // invalid tab read.
  // ---------------------------------------------------------------------
  if (validRowCount > 0) {
    const [deletedRow] = await db
      .delete(schema.accounts)
      .where(eq(schema.accounts.accountKey, SYNTHETIC_VALIDATION_ACCOUNT_KEY))
      .returning();
    if (deletedRow) {
      console.log(
        `Deleted synthetic validation account "${SYNTHETIC_VALIDATION_ACCOUNT_KEY}".`,
      );
    } else {
      console.log(
        `Synthetic validation account "${SYNTHETIC_VALIDATION_ACCOUNT_KEY}" was already absent.`,
      );
    }
  } else {
    console.log(
      `Skipping synthetic validation account cleanup — no valid target row was produced from "${TARGET_ACCOUNTS_TAB}".`,
    );
  }

  // ---------------------------------------------------------------------
  // 3. Seed exactly one starter ICP draft profile, only if none exists.
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
