// Milestone 4A — Account Brain claim ledger: recordClaim() (write) and
// getAccountClaims() (read). See @workspace/db/schema's accountClaims.ts
// for the full data-model rationale (open claimKey vocabulary, immutable
// append-only rows, contradiction preservation, status set once and
// never mutated).
//
// recordClaim() is the ONLY way any caller ever writes a claim — there is
// no raw insert call anywhere else in this codebase. It:
//   1. Verifies the account exists.
//   2. Loads the current claim (if any) for (accountId, claimKey) via
//      account_claim_current.
//   3. IDEMPOTENCY: an 'active' candidate that exactly matches the
//      current claim's (origin, valueType, value) is a true no-op — no
//      row is inserted. A repeated human confirmation of an unchanged
//      value is NOT treated as a duplicate (a fresh human confirmation
//      event is itself meaningful, even when the value is unchanged) —
//      the check compares origin too, not value alone. Mirrors
//      identityResolutionEvents' own "compare against latest row only"
//      idempotency shape rather than recordObservation's insert-first/
//      catch-23505 pattern (unsafe to nest inside a shared transaction
//      with other work).
//   4. Otherwise always inserts (append-only — never blocks a write).
//   5. Updates account_claim_current per precedence rules:
//        - human_confirmed/human_corrected: ALWAYS wins. status='rejected'
//          deletes the pointer (reverts the key to Unknown); otherwise
//          the pointer moves to the new row unconditionally.
//        - observed/derived/research: no current claim yet -> becomes
//          current. Current claim's value matches candidate's value ->
//          pointer refreshes to the new (more recent) row. Values
//          disagree -> pointer is left untouched; the new row is still
//          inserted and permanently visible (contradiction preserved,
//          never silently resolved to a machine-invented winner).
//
// getAccountClaims() is read-only, mirrors ../services/accountTruth.ts's
// own batched-evidence-resolution shape (one query per evidence kind,
// never N+1) — but is NOT built on top of accountTruth.ts's code: this
// module defines its own local evidence lookup so Account Brain's read
// path stays fully decoupled from the 3F/3H ICP-truth module, matching
// the same decoupling already applied at the schema layer.

import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  accountClaimCurrent,
  accountClaims,
  accountFacts,
  accounts,
  insertAccountClaimSchema,
  observations,
  type AccountClaim,
  type AccountClaimEvidenceReference,
} from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" was not found.`);
    this.name = "AccountNotFoundError";
  }
}

const HUMAN_ORIGINS = new Set(["human_confirmed", "human_corrected"]);

export interface RecordClaimArgs {
  accountId: string;
  claimKey: string;
  origin: AccountClaim["origin"];
  status?: AccountClaim["status"];
  valueType?: AccountClaim["valueType"];
  value?: unknown;
  confidence?: AccountClaim["confidence"];
  evidenceRefs?: AccountClaimEvidenceReference[];
  observedAt?: Date | null;
  recordedBy?: string | null;
  generatedByVersion?: string | null;
  supersedesClaimId?: string | null;
  correctionReason?: string | null;
}

export type RecordClaimOutcome = "inserted" | "duplicate";

export interface RecordClaimResult {
  outcome: RecordClaimOutcome;
  claim: AccountClaim;
  currentPointerUpdated: boolean;
}

// Structural jsonb equality — the same jsonb value round-tripped through
// Postgres may have re-ordered object keys, so this deliberately does not
// use JSON.stringify comparison.
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqualJson(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k, i) => k === bKeys[i] && deepEqualJson(aObj[k], bObj[k]));
  }
  return false;
}

async function loadCurrentClaim(
  tx: Tx,
  accountId: string,
  claimKey: string,
): Promise<AccountClaim | undefined> {
  const [pointer] = await tx
    .select({ claimId: accountClaimCurrent.claimId })
    .from(accountClaimCurrent)
    .where(and(eq(accountClaimCurrent.accountId, accountId), eq(accountClaimCurrent.claimKey, claimKey)))
    .limit(1);
  if (!pointer) return undefined;
  const [claim] = await tx.select().from(accountClaims).where(eq(accountClaims.id, pointer.claimId)).limit(1);
  return claim;
}

async function pointCurrentAt(tx: Tx, claim: AccountClaim): Promise<void> {
  await tx
    .insert(accountClaimCurrent)
    .values({ accountId: claim.accountId, claimKey: claim.claimKey, claimId: claim.id })
    .onConflictDoUpdate({
      target: [accountClaimCurrent.accountId, accountClaimCurrent.claimKey],
      set: { claimId: claim.id, updatedAt: new Date() },
    });
}

async function clearCurrent(tx: Tx, accountId: string, claimKey: string): Promise<void> {
  await tx
    .delete(accountClaimCurrent)
    .where(and(eq(accountClaimCurrent.accountId, accountId), eq(accountClaimCurrent.claimKey, claimKey)));
}

async function runRecordClaim(tx: Tx, args: RecordClaimArgs): Promise<RecordClaimResult> {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, args.accountId)).limit(1);
  if (!account) {
    throw new AccountNotFoundError(args.accountId);
  }

  const status = args.status ?? "active";
  const currentClaim = await loadCurrentClaim(tx, args.accountId, args.claimKey);

  if (
    status === "active" &&
    currentClaim &&
    currentClaim.status === "active" &&
    currentClaim.origin === args.origin &&
    deepEqualJson(currentClaim.valueType, args.valueType ?? null) &&
    deepEqualJson(currentClaim.value, args.value ?? null)
  ) {
    return { outcome: "duplicate", claim: currentClaim, currentPointerUpdated: false };
  }

  const insertValues = insertAccountClaimSchema.parse({
    accountId: args.accountId,
    claimKey: args.claimKey,
    origin: args.origin,
    status,
    valueType: args.valueType ?? null,
    value: args.value ?? null,
    confidence: args.confidence ?? null,
    evidenceRefs: args.evidenceRefs ?? [],
    observedAt: args.observedAt ?? null,
    recordedBy: args.recordedBy ?? null,
    generatedByVersion: args.generatedByVersion ?? null,
    supersedesClaimId: args.supersedesClaimId ?? null,
    correctionReason: args.correctionReason ?? null,
  });
  const [inserted] = await tx.insert(accountClaims).values(insertValues).returning();

  let currentPointerUpdated = false;
  if (HUMAN_ORIGINS.has(inserted.origin)) {
    if (inserted.status === "rejected") {
      await clearCurrent(tx, args.accountId, args.claimKey);
    } else {
      await pointCurrentAt(tx, inserted);
    }
    currentPointerUpdated = true;
  } else if (!currentClaim) {
    await pointCurrentAt(tx, inserted);
    currentPointerUpdated = true;
  } else if (
    currentClaim.status === "active" &&
    deepEqualJson(currentClaim.valueType, inserted.valueType) &&
    deepEqualJson(currentClaim.value, inserted.value)
  ) {
    await pointCurrentAt(tx, inserted);
    currentPointerUpdated = true;
  }
  // Else: machine-origin candidate disagrees with an existing active
  // current claim — inserted, but the pointer is deliberately left
  // untouched. Contradiction preserved, no invented winner.

  return { outcome: "inserted", claim: inserted, currentPointerUpdated };
}

/**
 * Records one claim candidate. Always runs inside its own transaction —
 * see module comment for the full precedence rules. Throws
 * AccountNotFoundError for an unknown accountId.
 */
export async function recordClaim(db: Db, args: RecordClaimArgs): Promise<RecordClaimResult> {
  return db.transaction((tx) => runRecordClaim(tx, args));
}

export type ResolvedClaimEvidenceDTO =
  | {
      kind: "observation";
      id: string;
      provider: string;
      value: unknown;
      observedAt: string | null;
      importedAt: string;
    }
  | {
      kind: "manual_account_fact";
      id: string;
      value: string;
      recordedBy: string;
      observedAt: string;
    }
  | { kind: "unknown"; id: string };

export interface AccountClaimDTO {
  id: string;
  claimKey: string;
  status: AccountClaim["status"];
  valueType: AccountClaim["valueType"];
  value: unknown;
  origin: AccountClaim["origin"];
  confidence: AccountClaim["confidence"];
  isCurrent: boolean;
  supersedesClaimId: string | null;
  correctionReason: string | null;
  recordedBy: string | null;
  generatedByVersion: string | null;
  observedAt: string | null;
  createdAt: string;
  evidence: ResolvedClaimEvidenceDTO[];
}

function dedupeRefsByKind(
  refs: readonly AccountClaimEvidenceReference[],
): { observationIds: string[]; manualFactIds: string[] } {
  const observationIds = new Set<string>();
  const manualFactIds = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "observation") observationIds.add(ref.id);
    else manualFactIds.add(ref.id);
  }
  return { observationIds: [...observationIds], manualFactIds: [...manualFactIds] };
}

async function loadEvidenceLookup(
  db: Db,
  refs: readonly AccountClaimEvidenceReference[],
): Promise<Map<string, ResolvedClaimEvidenceDTO>> {
  const { observationIds, manualFactIds } = dedupeRefsByKind(refs);
  const lookup = new Map<string, ResolvedClaimEvidenceDTO>();

  const [observationRows, manualFactRows] = await Promise.all([
    observationIds.length
      ? db
          .select({
            id: observations.id,
            provider: observations.provider,
            rawValue: observations.rawValue,
            normalizedValue: observations.normalizedValue,
            observedAt: observations.observedAt,
            importedAt: observations.importedAt,
          })
          .from(observations)
          .where(inArray(observations.id, observationIds))
      : Promise.resolve([]),
    manualFactIds.length
      ? db
          .select({
            id: accountFacts.id,
            value: accountFacts.value,
            recordedBy: accountFacts.recordedBy,
            observedAt: accountFacts.observedAt,
          })
          .from(accountFacts)
          .where(inArray(accountFacts.id, manualFactIds))
      : Promise.resolve([]),
  ]);

  for (const row of observationRows) {
    lookup.set(`observation:${row.id}`, {
      kind: "observation",
      id: row.id,
      provider: row.provider,
      value: row.normalizedValue ?? row.rawValue,
      observedAt: row.observedAt ? row.observedAt.toISOString() : null,
      importedAt: row.importedAt.toISOString(),
    });
  }
  for (const row of manualFactRows) {
    lookup.set(`manual_account_fact:${row.id}`, {
      kind: "manual_account_fact",
      id: row.id,
      value: row.value,
      recordedBy: row.recordedBy,
      observedAt: row.observedAt.toISOString(),
    });
  }
  return lookup;
}

function resolveRef(
  lookup: ReadonlyMap<string, ResolvedClaimEvidenceDTO>,
  ref: AccountClaimEvidenceReference,
): ResolvedClaimEvidenceDTO {
  return lookup.get(`${ref.kind}:${ref.id}`) ?? { kind: "unknown", id: ref.id };
}

/**
 * Every claim ever recorded for this account — including superseded and
 * contradicting rows, never just the current ones — sorted by claimKey
 * then newest-first within each key. isCurrent marks exactly the rows
 * account_claim_current presently points at. Throws AccountNotFoundError
 * for an unknown accountId.
 */
export async function getAccountClaims(db: Db, accountId: string): Promise<AccountClaimDTO[]> {
  const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const [claimRows, currentRows] = await Promise.all([
    db.select().from(accountClaims).where(eq(accountClaims.accountId, accountId)),
    db.select({ claimId: accountClaimCurrent.claimId }).from(accountClaimCurrent).where(eq(accountClaimCurrent.accountId, accountId)),
  ]);
  const currentClaimIds = new Set(currentRows.map((r) => r.claimId));

  const allEvidenceRefs = claimRows.flatMap((row) => row.evidenceRefs);
  const lookup = await loadEvidenceLookup(db, allEvidenceRefs);

  return claimRows
    .map((row) => ({
      id: row.id,
      claimKey: row.claimKey,
      status: row.status,
      valueType: row.valueType,
      value: row.value,
      origin: row.origin,
      confidence: row.confidence,
      isCurrent: currentClaimIds.has(row.id),
      supersedesClaimId: row.supersedesClaimId,
      correctionReason: row.correctionReason,
      recordedBy: row.recordedBy,
      generatedByVersion: row.generatedByVersion,
      observedAt: row.observedAt ? row.observedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      evidence: row.evidenceRefs.map((ref) => resolveRef(lookup, ref)),
    }))
    .sort((a, b) => a.claimKey.localeCompare(b.claimKey) || b.createdAt.localeCompare(a.createdAt));
}
