// GTM V2 Stage 3, Unit 2 — attention item create/resolve write paths.
//
// attention_items is the PostgreSQL source of truth for "why does this
// canonical account need human review" (see
// @workspace/db/schema/attentionItems.ts). This service exposes exactly
// two writes:
//
//   - createAttentionItem: insert-first idempotent creation, deduplicated
//     on (accountId, reasonCode, source, sourceRef) among OPEN items —
//     mirrors ../services/signals.ts's recordSignal shape (always attempt
//     the INSERT, never a pre-check-then-insert SELECT; only on a caught
//     23505 against one of the two partial dedup unique indexes does this
//     re-read the row that won the race and decide duplicate vs. conflict
//     by comparing every other caller-controlled immutable field).
//   - resolveAttentionItem: a single conditional UPDATE (status: open ->
//     resolved), deliberately mirroring ../services/accountFacts.ts's
//     compare-and-swap shape but simpler — one table, one WHERE-guarded
//     statement, no db.transaction() wrapper. The row's own lock (taken by
//     the UPDATE itself) is the only serialization concurrent resolves
//     need; a follow-up SELECT (only reached when the UPDATE affected zero
//     rows) classifies not_found vs. replayed vs. conflict.
//
// Neither function wraps its write in an explicit transaction — each path
// is exactly one write statement, with the two partial unique indexes,
// the row lock the UPDATE itself takes, and the
// attention_items_lifecycle_guard trigger (0011_attention_items_lifecycle.sql)
// as the final authority. The trigger permits no UPDATE shape other than
// a well-formed open -> resolved transition; this service's own
// WHERE status = 'open' guard exists so the common "already resolved"
// case is a normal zero-row UPDATE result, never a caught trigger
// exception.
//
// Only imports from @workspace/db/schema, never @workspace/db itself — the
// database instance is always received via explicit injection, mirroring
// every other service in this package.

import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accounts, attentionItems, type AttentionItem } from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// Local to this domain — deliberately NOT ../services/icpEvaluationResolvers.ts's
// AccountNotFoundError, an unrelated evaluation-domain service's error
// class. This repo has no shared, cross-domain "account not found" error
// intended for reuse (every existing importer of that class is itself an
// evaluation/facts-adjacent concern); attention items get their own.
export class AttentionAccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" was not found.`);
    this.name = "AttentionAccountNotFoundError";
  }
}

// ---------------------------------------------------------------------
// Structural equality — order-independent object keys, order-sensitive
// arrays. Local copy of ../services/signals.ts's structurallyEqual (this
// repo's convention is a small localized copy per call site, not a shared
// cross-domain utility — see that file's own comment). Needed because
// jsonb round-trips through Postgres with key order not preserved, so a
// literal deepEqual of context against a freshly-normalized request body
// would be a false negative for a genuinely identical retry.
// ---------------------------------------------------------------------

export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!structurallyEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i += 1) {
      if (aKeys[i] !== bKeys[i]) return false;
    }
    return aKeys.every((key) => structurallyEqual(aObj[key], bObj[key]));
  }

  return false;
}

// ---------------------------------------------------------------------
// Constraint-violation detection — local mirror of
// ../services/signals.ts's/../services/accountFacts.ts's own
// findPgConstraintErrorInfo walk (same repo convention: a small localized
// copy per call site). drizzle-orm's node-postgres driver wraps the raw
// `pg` DatabaseError (which carries `code`/`constraint` directly) inside a
// DrizzleQueryError, exposed only via `.cause`.
// ---------------------------------------------------------------------

const MAX_ERROR_CAUSE_DEPTH = 5;

interface PgConstraintErrorInfo {
  code: string;
  constraint: string;
}

function findPgConstraintErrorInfo(err: unknown): PgConstraintErrorInfo | null {
  const visited = new Set<unknown>();
  let current: unknown = err;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if (visited.has(current)) return null;
    visited.add(current);

    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.constraint === "string") {
      return { code: candidate.code, constraint: candidate.constraint };
    }

    current = candidate.cause;
  }
  return null;
}

// The two partial unique indexes attention_items.ts declares, split on
// whether source_ref is present (NULL is never equal to NULL in a unique
// index, so "no specific triggering row" needs its own index scoped to
// (account, reason, source) alone).
const DEDUP_WITH_REF_CONSTRAINT = "attention_items_open_dedup_with_ref_uq";
const DEDUP_WITHOUT_REF_CONSTRAINT = "attention_items_open_dedup_without_ref_uq";

function isAttentionItemDedupConflict(err: unknown): boolean {
  const info = findPgConstraintErrorInfo(err);
  return (
    info !== null &&
    info.code === "23505" &&
    (info.constraint === DEDUP_WITH_REF_CONSTRAINT || info.constraint === DEDUP_WITHOUT_REF_CONSTRAINT)
  );
}

// ---------------------------------------------------------------------
// Create — normalization
// ---------------------------------------------------------------------

export interface CreateAttentionItemArgs {
  db: Db;
  accountId: string;
  reasonCode: string;
  reasonDetail: string | null;
  source: AttentionItem["source"];
  sourceRef: string | null;
  context: Record<string, unknown>;
  createdBy: string;
}

export interface NormalizedCreateAttentionItemInput {
  accountId: string;
  reasonCode: string;
  reasonDetail: string | null;
  source: AttentionItem["source"];
  sourceRef: string | null;
  context: Record<string, unknown>;
  createdBy: string;
}

function normalizeNullableTrimmedString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Produces the single normalized representation used for BOTH the INSERT
 * values and the duplicate/conflict comparison against an existing row —
 * requirement: never normalize twice with the two normalizations able to
 * drift apart. reasonCode is trimmed AND lowercased, mirroring
 * attention_items_reason_code_is_canonical_form's CHECK exactly (the DB
 * is the final authority; this keeps the service's own comparison logic
 * from ever disagreeing with what the CHECK would accept). reasonDetail/
 * sourceRef trim to null when blank or absent. context defaults to {}
 * when omitted. createdBy is trimmed but never defaulted — it is always
 * caller-supplied (see attentionItems.ts's own module comment: there is
 * no server-derived identity at the requireServiceAuth boundary).
 */
export function normalizeCreateAttentionItemInput(
  args: Omit<CreateAttentionItemArgs, "db">,
): NormalizedCreateAttentionItemInput {
  return {
    accountId: args.accountId,
    reasonCode: args.reasonCode.trim().toLowerCase(),
    reasonDetail: normalizeNullableTrimmedString(args.reasonDetail),
    source: args.source,
    sourceRef: normalizeNullableTrimmedString(args.sourceRef),
    context: args.context ?? {},
    createdBy: args.createdBy.trim(),
  };
}

/**
 * True when every caller-controlled immutable field the create request
 * carries matches the existing open row exactly. accountId/reasonCode/
 * source/sourceRef are NOT re-checked here — fetchExistingOpenAttentionItem
 * already selected the existing row BY those four fields, so equality on
 * them is guaranteed by construction. Only the remaining immutable
 * fields — reasonDetail, context (compared structurally, order-
 * independent for objects, order-sensitive for arrays), and createdBy —
 * decide duplicate vs. conflict. createdBy participates deliberately: the
 * lifecycle trigger treats it as immutable creation-time content exactly
 * like reasonDetail/context, so a differing createdBy on the same dedup
 * key is conflicting content, never a silently-accepted replay.
 */
export function isDuplicateOfExisting(
  normalized: Pick<NormalizedCreateAttentionItemInput, "reasonDetail" | "context" | "createdBy">,
  existing: Pick<AttentionItem, "reasonDetail" | "context" | "createdBy">,
): boolean {
  return (
    normalized.reasonDetail === existing.reasonDetail &&
    normalized.createdBy === existing.createdBy &&
    structurallyEqual(normalized.context, existing.context)
  );
}

// ---------------------------------------------------------------------
// Create — the only creation write path this service exposes.
// ---------------------------------------------------------------------

export type CreateAttentionItemResult =
  | { outcome: "created"; item: AttentionItem }
  | { outcome: "duplicate"; item: AttentionItem }
  | { outcome: "conflict"; existingItem: AttentionItem };

async function fetchExistingOpenAttentionItem(
  db: Db,
  accountId: string,
  reasonCode: string,
  source: AttentionItem["source"],
  sourceRef: string | null,
): Promise<AttentionItem | undefined> {
  const sourceRefCondition =
    sourceRef === null ? isNull(attentionItems.sourceRef) : eq(attentionItems.sourceRef, sourceRef);
  const [existing] = await db
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.accountId, accountId),
        eq(attentionItems.reasonCode, reasonCode),
        eq(attentionItems.source, source),
        sourceRefCondition,
        eq(attentionItems.status, "open"),
      ),
    )
    .limit(1);
  return existing;
}

/**
 * Insert-first idempotent write: always attempts the INSERT first (never a
 * pre-check SELECT beyond the account-existence check below), so two
 * concurrent requests for the same (accountId, reasonCode, source,
 * sourceRef) are resolved purely by which one wins the database's own
 * partial unique index — there is no read-then-write window for a race to
 * hide in. The loser (and any later exact/conflicting retry) catches the
 * resulting 23505, re-reads the open row the winner committed, and decides
 * duplicate vs. conflict via isDuplicateOfExisting. Never updates or
 * overwrites an existing row.
 */
export async function createAttentionItem(args: CreateAttentionItemArgs): Promise<CreateAttentionItemResult> {
  const { db } = args;
  const normalized = normalizeCreateAttentionItemInput(args);

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, normalized.accountId))
    .limit(1);
  if (!account) {
    throw new AttentionAccountNotFoundError(normalized.accountId);
  }

  try {
    const [inserted] = await db
      .insert(attentionItems)
      .values({
        accountId: normalized.accountId,
        reasonCode: normalized.reasonCode,
        reasonDetail: normalized.reasonDetail,
        source: normalized.source,
        sourceRef: normalized.sourceRef,
        context: normalized.context,
        createdBy: normalized.createdBy,
      })
      .returning();
    if (!inserted) {
      throw new Error("createAttentionItem: insert into attention_items returned no row.");
    }
    return { outcome: "created", item: inserted };
  } catch (err) {
    if (!isAttentionItemDedupConflict(err)) {
      throw err;
    }

    const existing = await fetchExistingOpenAttentionItem(
      db,
      normalized.accountId,
      normalized.reasonCode,
      normalized.source,
      normalized.sourceRef,
    );
    if (!existing) {
      // The unique-violation proves a matching open row exists — a
      // missing re-fetch here would mean something inexplicable happened
      // between the failed insert and this read. Surface the original
      // database error rather than inventing a result (mirrors
      // ../services/signals.ts's recordSignal).
      throw err;
    }

    if (isDuplicateOfExisting(normalized, existing)) {
      return { outcome: "duplicate", item: existing };
    }
    return { outcome: "conflict", existingItem: existing };
  }
}

// ---------------------------------------------------------------------
// Resolve — normalization
// ---------------------------------------------------------------------

export interface ResolveAttentionItemArgs {
  db: Db;
  attentionItemId: string;
  resolvedBy: string;
  resolutionReason: string;
}

export interface NormalizedResolveAttentionItemInput {
  resolvedBy: string;
  resolutionReason: string;
}

export function normalizeResolveAttentionItemInput(
  args: Pick<ResolveAttentionItemArgs, "resolvedBy" | "resolutionReason">,
): NormalizedResolveAttentionItemInput {
  return {
    resolvedBy: args.resolvedBy.trim(),
    resolutionReason: args.resolutionReason.trim(),
  };
}

/**
 * True when the stored resolution (on an already-resolved row) matches
 * the supplied resolution data exactly — the replay-vs-conflict decision
 * for an already-resolved item. resolvedAt is deliberately never compared
 * (it is server-generated via now(), never caller-supplied).
 */
export function isReplayOfExistingResolution(
  normalized: NormalizedResolveAttentionItemInput,
  existing: Pick<AttentionItem, "resolvedBy" | "resolutionReason">,
): boolean {
  return existing.resolvedBy === normalized.resolvedBy && existing.resolutionReason === normalized.resolutionReason;
}

// ---------------------------------------------------------------------
// Resolve — the only resolution write path this service exposes.
// ---------------------------------------------------------------------

export type ResolveAttentionItemResult =
  | { kind: "not_found" }
  | { kind: "resolved"; item: AttentionItem }
  | { kind: "replayed"; item: AttentionItem }
  | { kind: "conflict"; existingItem: AttentionItem };

/**
 * One conditional UPDATE (status: open -> resolved), no transaction
 * wrapper. The UPDATE's own row lock is the only serialization two
 * concurrent resolves of the same item need: under READ COMMITTED, the
 * loser's UPDATE blocks on the row lock the winner is holding, then
 * re-evaluates WHERE status = 'open' against the winner's now-committed
 * row, matches zero rows, and falls through to the classification SELECT
 * below — which can only ever observe status = 'resolved' at that point
 * (resolution is one-way, and the lifecycle trigger permits no other
 * UPDATE shape), so "still open" is not a real branch to handle here.
 */
export async function resolveAttentionItem(args: ResolveAttentionItemArgs): Promise<ResolveAttentionItemResult> {
  const { db, attentionItemId } = args;
  const normalized = normalizeResolveAttentionItemInput(args);

  const [updated] = await db
    .update(attentionItems)
    .set({
      status: "resolved",
      resolvedAt: sql`now()`,
      resolvedBy: normalized.resolvedBy,
      resolutionReason: normalized.resolutionReason,
    })
    .where(and(eq(attentionItems.id, attentionItemId), eq(attentionItems.status, "open")))
    .returning();

  if (updated) {
    return { kind: "resolved", item: updated };
  }

  const [existing] = await db.select().from(attentionItems).where(eq(attentionItems.id, attentionItemId)).limit(1);
  if (!existing) {
    return { kind: "not_found" };
  }

  if (isReplayOfExistingResolution(normalized, existing)) {
    return { kind: "replayed", item: existing };
  }
  return { kind: "conflict", existingItem: existing };
}
