-- =========================================================================
-- Milestone 4A — account_claims immutability.
--
-- Reuses reject_update_delete() (defined in 0001_integrity_triggers.sql)
-- rather than redefining it — the exact same insert-only guarantee every
-- other history table in this schema already has (signals,
-- identity_resolution_events, account_snapshots, account_evaluations,
-- account_decisions, evaluator_versions, decision_policy_versions,
-- account_facts, observations, resolved_facts).
--
-- account_claim_current is deliberately NOT given this trigger — it is
-- the mutable, rebuildable current-pointer table (see
-- accountClaimCurrent.ts), mirroring account_fact_current's own
-- exemption.
-- =========================================================================

CREATE TRIGGER account_claims_immutable
BEFORE UPDATE OR DELETE ON account_claims
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
