-- =========================================================================
-- Milestone 3D — observations immutability.
--
-- Reuses reject_update_delete() (defined in 0001_integrity_triggers.sql)
-- rather than redefining it — the exact same insert-only guarantee every
-- other history table in this schema already has (signals,
-- identity_resolution_events, account_snapshots, account_evaluations,
-- account_decisions, evaluator_versions, decision_policy_versions,
-- account_facts).
-- =========================================================================

CREATE TRIGGER observations_immutable
BEFORE UPDATE OR DELETE ON observations
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
