// The storage boundary for the PostgreSQL operational ledger.
//
// This is additive: Google Sheets remains the system of record for every
// existing route. Nothing in this unit reads from or writes to this store
// from a live route — it exists so the ledger can be adopted incrementally,
// one write path at a time, in later units.
import type {
  accounts,
  actionAttempts,
  actionEvents,
  operatorDecisions,
  queueItems,
  scoreRuns,
  signalEvents,
  suppressions,
} from "@workspace/db";

export type Account = typeof accounts.$inferSelect;
export type SignalEvent = typeof signalEvents.$inferSelect;
export type ScoreRun = typeof scoreRuns.$inferSelect;
export type QueueItem = typeof queueItems.$inferSelect;
export type OperatorDecision = typeof operatorDecisions.$inferSelect;
export type ActionAttempt = typeof actionAttempts.$inferSelect;
export type ActionEvent = typeof actionEvents.$inferSelect;
export type Suppression = typeof suppressions.$inferSelect;

// account_key is the natural identity handed to us by the upstream engines
// (Google Sheets / n8n) — every write below (other than the account snapshot
// itself) takes the ledger's own accountId (a UUID), which callers obtain by
// calling upsertAccountSnapshot first. This keeps every other method a
// single-table statement instead of an implicit cross-table lookup.
export interface AccountSnapshotInput {
  accountKey: string;
  companyDomain?: string | null;
  companyName?: string | null;
  identityResolution?: string | null;
  matchConfidence?: string | null;
  currentOutput?: string | null;
  currentScore?: number | null;
  currentQueueStatus?: string | null;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface SignalEventInput {
  eventId: string;
  accountId?: string | null;
  source?: string | null;
  signalType?: string | null;
  resolutionLevel?: string | null;
  occurredAt?: Date | null;
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
}

export interface ScoreRunInput {
  accountId: string;
  model: string;
  ruleVersion?: string | null;
  fitScore?: number | null;
  interestScore?: number | null;
  identityScore?: number | null;
  actionabilityScore?: number | null;
  timingScore?: number | null;
  riskState?: string | null;
  totalScore?: number | null;
  components?: Record<string, unknown> | null;
  calculatedAt?: Date | null;
}

export interface QueueItemInput {
  // When id is provided, the existing row is updated in place. Otherwise a
  // new queue item is created. There is no implicit natural key across
  // (accountId, queueType) in this unit — callers that want "one open item
  // per account per queue" must look up the existing id themselves first
  // (e.g. via getAccountTimeline) and pass it back in.
  id?: string;
  accountId: string;
  queueType: string;
  status?: string | null;
  recommendedOutput?: string | null;
  recommendedAction?: string | null;
  assignedTo?: string | null;
  openedAt?: Date | null;
  resolvedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface OperatorDecisionInput {
  accountId: string;
  queueItemId?: string | null;
  decision: string;
  reason?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  operatorEmail?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ActionAttemptInput {
  accountId: string;
  decisionId?: string | null;
  capability: string;
  capabilityMaturity: string;
  executionState: string;
  idempotencyKey: string;
  requestedBy?: string | null;
  requestedAt?: Date | null;
  acceptedAt?: Date | null;
  completedAt?: Date | null;
  failureReason?: string | null;
  externalReferenceId?: string | null;
  provider?: string | null;
  requestPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface ActionEventInput {
  actionAttemptId: string;
  eventType: string;
  executionState?: string | null;
  message?: string | null;
  externalReferenceId?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date | null;
}

export interface SuppressionInput {
  accountId?: string | null;
  companyDomain?: string | null;
  contactEmail?: string | null;
  reason?: string | null;
  source?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type AccountTimelineEntry =
  | { kind: "signal_event"; occurredAt: Date | null; record: SignalEvent }
  | { kind: "score_run"; occurredAt: Date | null; record: ScoreRun }
  | { kind: "queue_item"; occurredAt: Date | null; record: QueueItem }
  | { kind: "operator_decision"; occurredAt: Date | null; record: OperatorDecision }
  | { kind: "action_attempt"; occurredAt: Date | null; record: ActionAttempt }
  | { kind: "action_event"; occurredAt: Date | null; record: ActionEvent }
  | { kind: "suppression"; occurredAt: Date | null; record: Suppression };

export interface AccountTimeline {
  account: Account | null;
  entries: AccountTimelineEntry[];
}

/**
 * Storage boundary for the PostgreSQL operational ledger. Implementations
 * must:
 *   - make appendSignalEvent idempotent by event_id (safe to replay);
 *   - make createActionAttempt idempotent by idempotency_key;
 *   - never overwrite existing rows in the append-only history methods
 *     (appendSignalEvent, recordScoreRun, recordOperatorDecision,
 *     appendActionEvent, addSuppression);
 *   - wrap any operation that requires more than one write in a transaction.
 */
export interface OperationalStore {
  upsertAccountSnapshot(input: AccountSnapshotInput): Promise<Account>;
  appendSignalEvent(input: SignalEventInput): Promise<SignalEvent>;
  recordScoreRun(input: ScoreRunInput): Promise<ScoreRun>;
  upsertQueueItem(input: QueueItemInput): Promise<QueueItem>;
  recordOperatorDecision(input: OperatorDecisionInput): Promise<OperatorDecision>;
  createActionAttempt(input: ActionAttemptInput): Promise<ActionAttempt>;
  appendActionEvent(input: ActionEventInput): Promise<ActionEvent>;
  addSuppression(input: SuppressionInput): Promise<Suppression>;
  getAccountTimeline(accountId: string): Promise<AccountTimeline>;
}
