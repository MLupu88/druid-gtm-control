ALTER TABLE "account_evaluations" ADD COLUMN "profile_config_snapshot" jsonb;--> statement-breakpoint
DO $$
DECLARE
  existing_count integer;
BEGIN
  SELECT count(*) INTO existing_count FROM "account_evaluations";
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'account_evaluations already contains % existing row(s): profile_config_snapshot cannot be backfilled truthfully. There is no reconstructable historical profile config for evaluations that were persisted before this column existed, and inventing {} or copying the CURRENT icp_profile_versions.config into those rows would misrepresent what the evaluator actually ran against at the time. Review and explicitly migrate (or intentionally discard) the existing account_evaluations rows before retrying this migration.', existing_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "account_evaluations" ALTER COLUMN "profile_config_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account_evaluations" ADD CONSTRAINT "account_evaluations_profile_config_snapshot_is_object" CHECK (jsonb_typeof("account_evaluations"."profile_config_snapshot") = 'object');
