-- =========================================================================
-- Package 2, Phase 1 — integrity triggers.
--
-- drizzle-orm has no trigger DSL, so every cross-row/cross-table rule and
-- every immutability guarantee that a plain CHECK constraint cannot
-- express lives here, hand-authored, as a second migration applied after
-- the auto-generated baseline (0000_safe_preak.sql, which created every
-- table/enum/column/FK/CHECK/index directly expressible from
-- lib/db/src/schema/*.ts).
--
-- See lib/db/src/schema/*.ts for the narrative explanation of each rule;
-- this file is intentionally just the mechanism.
-- =========================================================================

-- -------------------------------------------------------------------------
-- icp_profile_versions: immutable once published. The only mutation ever
-- permitted is the draft -> published transition itself (which sets
-- published_at in the same statement — enforced separately by the
-- icp_profile_versions_published_at_matches_status CHECK). Once a row's
-- OLD.status is 'published', both UPDATE and DELETE are rejected.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION icp_profile_versions_immutable_after_publish()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'icp_profile_versions: published version % cannot be deleted', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'icp_profile_versions: published version % is immutable', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER icp_profile_versions_immutable_after_publish
BEFORE UPDATE OR DELETE ON icp_profile_versions
FOR EACH ROW EXECUTE FUNCTION icp_profile_versions_immutable_after_publish();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- icp_profiles: active_version_id, when set, must reference a PUBLISHED
-- version belonging to this same profile.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION icp_profiles_active_version_must_be_published()
RETURNS trigger AS $$
DECLARE
  v_profile_id uuid;
  v_status icp_profile_version_status;
BEGIN
  IF NEW.active_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile_id, status INTO v_profile_id, v_status
  FROM icp_profile_versions
  WHERE id = NEW.active_version_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'icp_profiles: active_version_id % does not exist', NEW.active_version_id;
  END IF;

  IF v_profile_id <> NEW.id THEN
    RAISE EXCEPTION 'icp_profiles: active_version_id % does not belong to profile %', NEW.active_version_id, NEW.id;
  END IF;

  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'icp_profiles: active_version_id % is not published (status=%)', NEW.active_version_id, v_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER icp_profiles_active_version_must_be_published
BEFORE INSERT OR UPDATE ON icp_profiles
FOR EACH ROW EXECUTE FUNCTION icp_profiles_active_version_must_be_published();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- icp_profile_activation_events: cross-table reference integrity.
--   - every non-null version reference (version_id and, when present,
--     previous_active_version_id) must belong to this event's profile_id;
--   - the version being activated (version_id, on 'activated' events)
--     must be published;
--   - the previous active version referenced during either an activation
--     or a deactivation (previous_active_version_id, when present) must
--     also be published — only published versions can ever have been
--     active in the first place.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION icp_profile_activation_events_integrity()
RETURNS trigger AS $$
DECLARE
  v_profile_id uuid;
  v_status icp_profile_version_status;
BEGIN
  IF NEW.version_id IS NOT NULL THEN
    SELECT profile_id, status INTO v_profile_id, v_status FROM icp_profile_versions WHERE id = NEW.version_id;
    IF v_profile_id IS NULL THEN
      RAISE EXCEPTION 'icp_profile_activation_events: version_id % does not exist', NEW.version_id;
    END IF;
    IF v_profile_id <> NEW.profile_id THEN
      RAISE EXCEPTION 'icp_profile_activation_events: version_id % does not belong to profile %', NEW.version_id, NEW.profile_id;
    END IF;
    IF NEW.event_type = 'activated' AND v_status <> 'published' THEN
      RAISE EXCEPTION 'icp_profile_activation_events: activated version % is not published (status=%)', NEW.version_id, v_status;
    END IF;
  END IF;

  IF NEW.previous_active_version_id IS NOT NULL THEN
    SELECT profile_id, status INTO v_profile_id, v_status FROM icp_profile_versions WHERE id = NEW.previous_active_version_id;
    IF v_profile_id IS NULL THEN
      RAISE EXCEPTION 'icp_profile_activation_events: previous_active_version_id % does not exist', NEW.previous_active_version_id;
    END IF;
    IF v_profile_id <> NEW.profile_id THEN
      RAISE EXCEPTION 'icp_profile_activation_events: previous_active_version_id % does not belong to profile %', NEW.previous_active_version_id, NEW.profile_id;
    END IF;
    IF v_status <> 'published' THEN
      RAISE EXCEPTION 'icp_profile_activation_events: previous_active_version_id % is not published (status=%)', NEW.previous_active_version_id, v_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER icp_profile_activation_events_integrity
BEFORE INSERT ON icp_profile_activation_events
FOR EACH ROW EXECUTE FUNCTION icp_profile_activation_events_integrity();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- Generic insert-only / immutable-table guard, reused by every table in
-- this schema whose entire point is an append-only historical record.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_update_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is an immutable/insert-only table: % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER icp_profile_activation_events_immutable
BEFORE UPDATE OR DELETE ON icp_profile_activation_events
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
--> statement-breakpoint

CREATE TRIGGER evaluator_versions_immutable
BEFORE UPDATE OR DELETE ON evaluator_versions
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
--> statement-breakpoint

CREATE TRIGGER decision_policy_versions_immutable
BEFORE UPDATE OR DELETE ON decision_policy_versions
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
--> statement-breakpoint

CREATE TRIGGER account_snapshots_immutable
BEFORE UPDATE OR DELETE ON account_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
--> statement-breakpoint

CREATE TRIGGER account_evaluations_immutable
BEFORE UPDATE OR DELETE ON account_evaluations
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
--> statement-breakpoint

CREATE TRIGGER account_decisions_immutable
BEFORE UPDATE OR DELETE ON account_decisions
FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- account_evaluations: account_id must match the referenced snapshot's
-- account_id — both are stored on this row for query convenience, but
-- without this check an evaluation could accidentally combine one
-- account with another account's snapshot.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION account_evaluations_account_matches_snapshot()
RETURNS trigger AS $$
DECLARE
  v_snapshot_account_id uuid;
BEGIN
  SELECT account_id INTO v_snapshot_account_id FROM account_snapshots WHERE id = NEW.snapshot_id;
  IF v_snapshot_account_id IS NULL THEN
    RAISE EXCEPTION 'account_evaluations: snapshot_id % does not exist', NEW.snapshot_id;
  END IF;
  IF v_snapshot_account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'account_evaluations: account_id % does not match snapshot %''s account_id %', NEW.account_id, NEW.snapshot_id, v_snapshot_account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER account_evaluations_account_matches_snapshot
BEFORE INSERT ON account_evaluations
FOR EACH ROW EXECUTE FUNCTION account_evaluations_account_matches_snapshot();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- account_evaluations: 'production' evaluations must reference a
-- PUBLISHED profile version. 'preview' evaluations may reference either
-- a draft or a published version (impact-preview workflows).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION account_evaluations_production_requires_published_version()
RETURNS trigger AS $$
DECLARE
  v_status icp_profile_version_status;
BEGIN
  IF NEW.evaluation_mode <> 'production' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status FROM icp_profile_versions WHERE id = NEW.profile_version_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'account_evaluations: profile_version_id % does not exist', NEW.profile_version_id;
  END IF;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'account_evaluations: production evaluation must reference a published profile version (status=%)', v_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER account_evaluations_production_requires_published_version
BEFORE INSERT ON account_evaluations
FOR EACH ROW EXECUTE FUNCTION account_evaluations_production_requires_published_version();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- account_decisions: must reference a COMPLETED, PRODUCTION evaluation.
-- A decision can never be built on a preview evaluation or a failed one.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION account_decisions_requires_completed_production_evaluation()
RETURNS trigger AS $$
DECLARE
  v_status evaluation_status;
  v_mode evaluation_mode;
BEGIN
  SELECT status, evaluation_mode INTO v_status, v_mode FROM account_evaluations WHERE id = NEW.account_evaluation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'account_decisions: account_evaluation_id % does not exist', NEW.account_evaluation_id;
  END IF;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'account_decisions: referenced evaluation % is not completed (status=%)', NEW.account_evaluation_id, v_status;
  END IF;
  IF v_mode <> 'production' THEN
    RAISE EXCEPTION 'account_decisions: referenced evaluation % is not a production evaluation (mode=%)', NEW.account_evaluation_id, v_mode;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER account_decisions_requires_completed_production_evaluation
BEFORE INSERT ON account_decisions
FOR EACH ROW EXECUTE FUNCTION account_decisions_requires_completed_production_evaluation();
