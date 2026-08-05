-- =========================================================================
-- GTM V2 Unit 1 — signals / identity_resolution_events immutability.
--
-- Reuses reject_update_delete() (defined in 0001_integrity_triggers.sql)
-- rather than redefining it — the exact same insert-only guarantee every
-- other history table in this schema already has (account_snapshots,
-- account_evaluations, account_decisions, evaluator_versions,
-- decision_policy_versions, account_facts).
--
-- account_aliases and account_people deliberately get NO such trigger:
-- they are mutable, rebuildable relationship/index rows (see the
-- comments in accountAliases.ts / accountPeople.ts), not history tables.
-- people is likewise mutable — it is a canonical identity record, not an
-- append-only ledger.
-- =========================================================================

CREATE TRIGGER signals_immutable
BEFORE UPDATE OR DELETE ON signals
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
--> statement-breakpoint

CREATE TRIGGER identity_resolution_events_immutable
BEFORE UPDATE OR DELETE ON identity_resolution_events
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
