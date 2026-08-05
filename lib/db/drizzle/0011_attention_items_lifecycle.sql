-- =========================================================================
-- GTM V2 Stage 3, Unit 1 — attention_items lifecycle/immutability.
--
-- Cannot reuse reject_update_delete() (0001_integrity_triggers.sql) as-is:
-- that function rejects every UPDATE unconditionally, but attention_items
-- must permit exactly one UPDATE per row — the open -> resolved
-- transition — before locking forever. So this is a bespoke guard,
-- mirroring the shape of icp_profile_versions_immutable_after_publish
-- (0001_integrity_triggers.sql) but stricter in two ways:
--   - DELETE is rejected unconditionally, regardless of OLD.status. An
--     attention item is never removable, not even while still open
--     (icp_profile_versions allows deleting an unpublished draft; this
--     table allows deleting nothing, ever).
--   - The one permitted UPDATE is narrowly shaped, not just "OLD.status
--     wasn't yet terminal": every column set at creation (id, account_id,
--     reason_code, reason_detail, source, source_ref, context,
--     created_at, created_by) must be byte-for-byte unchanged, and
--     NEW.status must be exactly 'resolved'. Any other UPDATE attempt
--     while OLD.status = 'open' — editing reason_detail, changing
--     context, or any no-op update that doesn't transition status — is
--     rejected, not just updates on an already-resolved row.
--
-- The resolution fields themselves (resolved_at IS NOT NULL,
-- resolved_by/resolution_reason non-blank) are already enforced by the
-- attention_items_resolution_fields_iff_resolved CHECK in
-- 0010_perpetual_wrecker.sql — this trigger does not duplicate that; it
-- only guards which UPDATE shapes are allowed to reach that CHECK at all.
-- =========================================================================

CREATE OR REPLACE FUNCTION attention_items_lifecycle_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attention_items: rows can never be deleted (id=%)', OLD.id;
  END IF;

  -- TG_OP = 'UPDATE' from here on.
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'attention_items: resolved row % is immutable', OLD.id;
  END IF;

  -- OLD.status = 'open': only a well-formed open -> resolved transition,
  -- with every creation-time column untouched, is permitted.
  IF NEW.status <> 'resolved'
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
    OR NEW.reason_detail IS DISTINCT FROM OLD.reason_detail
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
    OR NEW.context IS DISTINCT FROM OLD.context
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
  THEN
    RAISE EXCEPTION 'attention_items: the only permitted update is open -> resolved (setting resolved_at/resolved_by/resolution_reason) with no change to id/account_id/reason_code/reason_detail/source/source_ref/context/created_at/created_by (row %)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER attention_items_lifecycle_guard
BEFORE UPDATE OR DELETE ON attention_items
FOR EACH ROW EXECUTE FUNCTION attention_items_lifecycle_guard();
