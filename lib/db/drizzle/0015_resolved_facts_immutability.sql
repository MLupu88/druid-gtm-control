-- =========================================================================
-- Milestone 3F — resolved_facts immutability.
--
-- Reuses reject_update_delete() (defined in 0001_integrity_triggers.sql)
-- rather than redefining it.
-- =========================================================================

CREATE TRIGGER resolved_facts_immutable
BEFORE UPDATE OR DELETE ON resolved_facts
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
