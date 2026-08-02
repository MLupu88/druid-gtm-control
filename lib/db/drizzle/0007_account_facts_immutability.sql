-- =========================================================================
-- Unit 2 Slice 1 — account_facts immutability.
--
-- Reuses reject_update_delete() (defined in 0001_integrity_triggers.sql)
-- rather than redefining it — this is the exact same insert-only guarantee
-- every other history table in this schema already has (account_snapshots,
-- account_evaluations, account_decisions, evaluator_versions,
-- decision_policy_versions).
--
-- account_fact_current deliberately gets NO such trigger: it is a mutable,
-- fully rebuildable pointer table, not a history table. Its cross-table
-- correctness (fact_id must belong to the same account_id/field) is
-- already guaranteed by the composite foreign key defined in
-- 0006_add_account_facts.sql — no trigger is required there.
-- =========================================================================

CREATE TRIGGER account_facts_immutable
BEFORE UPDATE OR DELETE ON account_facts
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
