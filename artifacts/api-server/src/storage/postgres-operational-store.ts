// PostgreSQL implementation of the operational-ledger storage boundary.
//
// Not wired into any route in this unit — Google Sheets remains the system
// of record for every existing GTM Mission Control endpoint. This class
// exists so later units can adopt the ledger one write path at a time.
import { eq, inArray } from "drizzle-orm";
import {
  accounts,
  actionAttempts,
  actionEvents,
  getDb,
  operatorDecisions,
  queueItems,
  scoreRuns,
  signalEvents,
  suppressions,
} from "@workspace/db";
import type {
  Account,
  AccountSnapshotInput,
  AccountTimeline,
  AccountTimelineEntry,
  ActionAttempt,
  ActionAttemptInput,
  ActionEvent,
  ActionEventInput,
  OperationalStore,
  OperatorDecision,
  OperatorDecisionInput,
  QueueItem,
  QueueItemInput,
  ScoreRun,
  ScoreRunInput,
  SignalEvent,
  SignalEventInput,
  Suppression,
  SuppressionInput,
} from "./operational-store";

export class PostgresOperationalStore implements OperationalStore {
  // upsertAccountSnapshot replaces the account row's current-state fields
  // wholesale (a "snapshot" is the full state as of now, not a patch) —
  // fields the caller doesn't pass are stored as null, both on first insert
  // and on any later conflict update. This is a single atomic statement
  // (INSERT ... ON CONFLICT ... DO UPDATE), so no transaction is needed.
  async upsertAccountSnapshot(input: AccountSnapshotInput): Promise<Account> {
    const db = getDb();
    const now = new Date();

    const values = {
      accountKey: input.accountKey,
      companyDomain: input.companyDomain ?? null,
      companyName: input.companyName ?? null,
      identityResolution: input.identityResolution ?? null,
      matchConfidence: input.matchConfidence ?? null,
      currentOutput: input.currentOutput ?? null,
      currentScore: input.currentScore ?? null,
      currentQueueStatus: input.currentQueueStatus ?? null,
      firstSeenAt: input.firstSeenAt ?? null,
      lastSeenAt: input.lastSeenAt ?? null,
      metadata: input.metadata ?? null,
      updatedAt: now,
    };

    const [row] = await db
      .insert(accounts)
      .values(values)
      .onConflictDoUpdate({
        target: accounts.accountKey,
        set: values,
      })
      .returning();

    return row;
  }

  // Idempotent by event_id: replaying the same upstream signal never creates
  // a second row. The insert-or-fetch is two statements forming one logical
  // operation, so it runs inside a transaction.
  async appendSignalEvent(input: SignalEventInput): Promise<SignalEvent> {
    const db = getDb();

    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(signalEvents)
        .values({
          eventId: input.eventId,
          accountId: input.accountId ?? null,
          source: input.source ?? null,
          signalType: input.signalType ?? null,
          resolutionLevel: input.resolutionLevel ?? null,
          occurredAt: input.occurredAt ?? null,
          rawPayload: input.rawPayload ?? null,
          normalizedPayload: input.normalizedPayload ?? null,
        })
        .onConflictDoNothing({ target: signalEvents.eventId })
        .returning();

      if (inserted[0]) {
        return inserted[0];
      }

      const [existing] = await tx
        .select()
        .from(signalEvents)
        .where(eq(signalEvents.eventId, input.eventId));

      if (!existing) {
        throw new Error(
          "appendSignalEvent: insert conflicted but no existing row was found for this event_id.",
        );
      }

      return existing;
    });
  }

  // Append-only: one row per scoring pass. Never updates a prior run.
  async recordScoreRun(input: ScoreRunInput): Promise<ScoreRun> {
    const db = getDb();

    const [row] = await db
      .insert(scoreRuns)
      .values({
        accountId: input.accountId,
        model: input.model,
        ruleVersion: input.ruleVersion ?? null,
        fitScore: input.fitScore ?? null,
        interestScore: input.interestScore ?? null,
        identityScore: input.identityScore ?? null,
        actionabilityScore: input.actionabilityScore ?? null,
        timingScore: input.timingScore ?? null,
        riskState: input.riskState ?? null,
        totalScore: input.totalScore ?? null,
        components: input.components ?? null,
        calculatedAt: input.calculatedAt ?? null,
      })
      .returning();

    return row;
  }

  // Current-state row per queue entry. When id is provided, updates that
  // row in place; otherwise inserts a new one. A single statement either
  // way, so no transaction is required.
  async upsertQueueItem(input: QueueItemInput): Promise<QueueItem> {
    const db = getDb();
    const now = new Date();

    if (input.id) {
      const [row] = await db
        .update(queueItems)
        .set({
          queueType: input.queueType,
          status: input.status ?? null,
          recommendedOutput: input.recommendedOutput ?? null,
          recommendedAction: input.recommendedAction ?? null,
          assignedTo: input.assignedTo ?? null,
          openedAt: input.openedAt ?? null,
          resolvedAt: input.resolvedAt ?? null,
          metadata: input.metadata ?? null,
          updatedAt: now,
        })
        .where(eq(queueItems.id, input.id))
        .returning();

      if (!row) {
        throw new Error(`upsertQueueItem: no queue item found for id ${input.id}.`);
      }

      return row;
    }

    const [row] = await db
      .insert(queueItems)
      .values({
        accountId: input.accountId,
        queueType: input.queueType,
        status: input.status ?? null,
        recommendedOutput: input.recommendedOutput ?? null,
        recommendedAction: input.recommendedAction ?? null,
        assignedTo: input.assignedTo ?? null,
        openedAt: input.openedAt ?? null,
        resolvedAt: input.resolvedAt ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();

    return row;
  }

  // Append-only audit trail — every decision is a new row, never overwritten.
  async recordOperatorDecision(input: OperatorDecisionInput): Promise<OperatorDecision> {
    const db = getDb();

    const [row] = await db
      .insert(operatorDecisions)
      .values({
        accountId: input.accountId,
        queueItemId: input.queueItemId ?? null,
        decision: input.decision,
        reason: input.reason ?? null,
        operatorId: input.operatorId ?? null,
        operatorName: input.operatorName ?? null,
        operatorEmail: input.operatorEmail ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();

    return row;
  }

  // Idempotent by idempotency_key: a retried request from the frontend
  // never creates a second attempt. Same insert-or-fetch pattern as
  // appendSignalEvent, so it also runs inside a transaction.
  async createActionAttempt(input: ActionAttemptInput): Promise<ActionAttempt> {
    const db = getDb();

    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(actionAttempts)
        .values({
          accountId: input.accountId,
          decisionId: input.decisionId ?? null,
          capability: input.capability,
          capabilityMaturity: input.capabilityMaturity,
          executionState: input.executionState,
          idempotencyKey: input.idempotencyKey,
          requestedBy: input.requestedBy ?? null,
          requestedAt: input.requestedAt ?? null,
          acceptedAt: input.acceptedAt ?? null,
          completedAt: input.completedAt ?? null,
          failureReason: input.failureReason ?? null,
          externalReferenceId: input.externalReferenceId ?? null,
          provider: input.provider ?? null,
          requestPayload: input.requestPayload ?? null,
          responsePayload: input.responsePayload ?? null,
          metadata: input.metadata ?? null,
        })
        .onConflictDoNothing({ target: actionAttempts.idempotencyKey })
        .returning();

      if (inserted[0]) {
        return inserted[0];
      }

      const [existing] = await tx
        .select()
        .from(actionAttempts)
        .where(eq(actionAttempts.idempotencyKey, input.idempotencyKey));

      if (!existing) {
        throw new Error(
          "createActionAttempt: insert conflicted but no existing row was found for this idempotency_key.",
        );
      }

      return existing;
    });
  }

  // Append-only: one row per state transition / provider callback. Never
  // updated or replaced — action_attempts holds the current state instead.
  async appendActionEvent(input: ActionEventInput): Promise<ActionEvent> {
    const db = getDb();

    const [row] = await db
      .insert(actionEvents)
      .values({
        actionAttemptId: input.actionAttemptId,
        eventType: input.eventType,
        executionState: input.executionState ?? null,
        message: input.message ?? null,
        externalReferenceId: input.externalReferenceId ?? null,
        payload: input.payload ?? null,
        occurredAt: input.occurredAt ?? null,
      })
      .returning();

    return row;
  }

  // Suppressions are preserved, never deleted. This unit only adds new
  // suppression rows (active=true by column default); revoking one later
  // is a plain UPDATE (active=false, revoked_at=now()) on the existing row,
  // intentionally not exposed as a store method yet since it isn't part of
  // this bounded unit's interface.
  async addSuppression(input: SuppressionInput): Promise<Suppression> {
    const db = getDb();

    const [row] = await db
      .insert(suppressions)
      .values({
        accountId: input.accountId ?? null,
        companyDomain: input.companyDomain ?? null,
        contactEmail: input.contactEmail ?? null,
        reason: input.reason ?? null,
        source: input.source ?? null,
        createdBy: input.createdBy ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();

    return row;
  }

  // Everything known about one account, merged into a single chronological
  // (earliest-first) timeline. Rows with no usable timestamp sort last
  // rather than being silently dropped.
  async getAccountTimeline(accountId: string): Promise<AccountTimeline> {
    const db = getDb();

    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));

    const [signals, scores, queues, decisions, attempts, suppressionRows] = await Promise.all([
      db.select().from(signalEvents).where(eq(signalEvents.accountId, accountId)),
      db.select().from(scoreRuns).where(eq(scoreRuns.accountId, accountId)),
      db.select().from(queueItems).where(eq(queueItems.accountId, accountId)),
      db.select().from(operatorDecisions).where(eq(operatorDecisions.accountId, accountId)),
      db.select().from(actionAttempts).where(eq(actionAttempts.accountId, accountId)),
      db.select().from(suppressions).where(eq(suppressions.accountId, accountId)),
    ]);

    const attemptIds = attempts.map((a) => a.id);
    const events = attemptIds.length
      ? await db.select().from(actionEvents).where(inArray(actionEvents.actionAttemptId, attemptIds))
      : [];

    const entries: AccountTimelineEntry[] = [
      ...signals.map((record): AccountTimelineEntry => ({
        kind: "signal_event",
        occurredAt: record.occurredAt ?? record.createdAt,
        record,
      })),
      ...scores.map((record): AccountTimelineEntry => ({
        kind: "score_run",
        occurredAt: record.calculatedAt,
        record,
      })),
      ...queues.map((record): AccountTimelineEntry => ({
        kind: "queue_item",
        occurredAt: record.openedAt ?? record.createdAt,
        record,
      })),
      ...decisions.map((record): AccountTimelineEntry => ({
        kind: "operator_decision",
        occurredAt: record.createdAt,
        record,
      })),
      ...attempts.map((record): AccountTimelineEntry => ({
        kind: "action_attempt",
        occurredAt: record.requestedAt,
        record,
      })),
      ...events.map((record): AccountTimelineEntry => ({
        kind: "action_event",
        occurredAt: record.occurredAt ?? record.createdAt,
        record,
      })),
      ...suppressionRows.map((record): AccountTimelineEntry => ({
        kind: "suppression",
        occurredAt: record.createdAt,
        record,
      })),
    ];

    entries.sort((a, b) => {
      const aTime = a.occurredAt ? a.occurredAt.getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.occurredAt ? b.occurredAt.getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });

    return { account: account ?? null, entries };
  }
}
