CREATE TYPE "public"."activation_event_type" AS ENUM('activated', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."decision_gate" AS ENUM('actionable', 'restricted', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."eligibility_outcome" AS ENUM('eligible', 'restricted', 'ineligible');--> statement-breakpoint
CREATE TYPE "public"."evaluation_mode" AS ENUM('preview', 'production');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."icp_profile_version_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."identity_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."identity_resolution_level" AS ENUM('anonymous', 'company', 'contact', 'known_crm_contact');--> statement-breakpoint
CREATE TYPE "public"."routing_output" AS ENUM('mql', 'sales_review', 'pipeline_assist', 'owner_alert', 'retarget', 'nurture', 'suppressed');--> statement-breakpoint
CREATE TABLE "icp_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active_version_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "icp_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "icp_profile_version_status" DEFAULT 'draft' NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "icp_profile_versions_version_number_positive" CHECK ("icp_profile_versions"."version_number" > 0),
	CONSTRAINT "icp_profile_versions_config_is_object" CHECK (jsonb_typeof("icp_profile_versions"."config") = 'object'),
	CONSTRAINT "icp_profile_versions_published_at_matches_status" CHECK (("icp_profile_versions"."status" = 'draft' AND "icp_profile_versions"."published_at" IS NULL) OR ("icp_profile_versions"."status" = 'published' AND "icp_profile_versions"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "icp_profile_activation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"event_type" "activation_event_type" NOT NULL,
	"version_id" uuid,
	"previous_active_version_id" uuid,
	"performed_by" text,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "icp_profile_activation_events_required_reference_by_type" CHECK (("icp_profile_activation_events"."event_type" = 'activated' AND "icp_profile_activation_events"."version_id" IS NOT NULL)
        OR ("icp_profile_activation_events"."event_type" = 'deactivated' AND "icp_profile_activation_events"."version_id" IS NULL AND "icp_profile_activation_events"."previous_active_version_id" IS NOT NULL)),
	CONSTRAINT "icp_profile_activation_events_activation_is_a_real_transition" CHECK ("icp_profile_activation_events"."event_type" <> 'activated' OR "icp_profile_activation_events"."previous_active_version_id" IS NULL OR "icp_profile_activation_events"."previous_active_version_id" <> "icp_profile_activation_events"."version_id")
);
--> statement-breakpoint
CREATE TABLE "evaluator_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"description" text,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluator_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "evaluator_versions_version_not_blank" CHECK (trim("evaluator_versions"."version") <> '')
);
--> statement-breakpoint
CREATE TABLE "decision_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"description" text,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_policy_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "decision_policy_versions_version_not_blank" CHECK (trim("decision_policy_versions"."version") <> '')
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_key" text NOT NULL,
	"company_domain" text,
	"company_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_account_key_unique" UNIQUE("account_key"),
	CONSTRAINT "accounts_account_key_not_blank" CHECK (trim("accounts"."account_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "account_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"raw_input" jsonb NOT NULL,
	"normalized_input" jsonb NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_snapshots_source_not_blank" CHECK (trim("account_snapshots"."source") <> ''),
	CONSTRAINT "account_snapshots_schema_version_not_blank" CHECK (trim("account_snapshots"."schema_version") <> ''),
	CONSTRAINT "account_snapshots_raw_input_is_object" CHECK (jsonb_typeof("account_snapshots"."raw_input") = 'object'),
	CONSTRAINT "account_snapshots_normalized_input_is_object" CHECK (jsonb_typeof("account_snapshots"."normalized_input") = 'object')
);
--> statement-breakpoint
CREATE TABLE "account_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"evaluator_version_id" uuid NOT NULL,
	"evaluation_mode" "evaluation_mode" NOT NULL,
	"status" "evaluation_status" NOT NULL,
	"error_detail" text,
	"fit_score" numeric,
	"fit_tier" text,
	"intent_score" numeric,
	"intent_tier" text,
	"identity_resolution_level" "identity_resolution_level",
	"identity_confidence" "identity_confidence",
	"actionability_score" numeric,
	"eligibility_outcome" "eligibility_outcome",
	"eligibility_restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hard_disqualifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "account_evaluations_fit_score_nonnegative" CHECK ("account_evaluations"."fit_score" IS NULL OR "account_evaluations"."fit_score" >= 0),
	CONSTRAINT "account_evaluations_intent_score_nonnegative" CHECK ("account_evaluations"."intent_score" IS NULL OR "account_evaluations"."intent_score" >= 0),
	CONSTRAINT "account_evaluations_actionability_score_nonnegative" CHECK ("account_evaluations"."actionability_score" IS NULL OR "account_evaluations"."actionability_score" >= 0),
	CONSTRAINT "account_evaluations_eligibility_restrictions_is_array" CHECK (jsonb_typeof("account_evaluations"."eligibility_restrictions") = 'array'),
	CONSTRAINT "account_evaluations_hard_disqualifiers_is_array" CHECK (jsonb_typeof("account_evaluations"."hard_disqualifiers") = 'array'),
	CONSTRAINT "account_evaluations_score_components_is_array" CHECK (jsonb_typeof("account_evaluations"."score_components") = 'array'),
	CONSTRAINT "account_evaluations_matched_rules_is_array" CHECK (jsonb_typeof("account_evaluations"."matched_rules") = 'array'),
	CONSTRAINT "account_evaluations_missing_inputs_is_array" CHECK (jsonb_typeof("account_evaluations"."missing_inputs") = 'array'),
	CONSTRAINT "account_evaluations_completed_requires_core_outputs" CHECK ("account_evaluations"."status" <> 'completed' OR (
        "account_evaluations"."fit_score" IS NOT NULL
        AND "account_evaluations"."fit_tier" IS NOT NULL AND trim("account_evaluations"."fit_tier") <> ''
        AND "account_evaluations"."intent_score" IS NOT NULL
        AND "account_evaluations"."intent_tier" IS NOT NULL AND trim("account_evaluations"."intent_tier") <> ''
        AND "account_evaluations"."identity_resolution_level" IS NOT NULL
        AND "account_evaluations"."identity_confidence" IS NOT NULL
        AND "account_evaluations"."actionability_score" IS NOT NULL
        AND "account_evaluations"."eligibility_outcome" IS NOT NULL
      )),
	CONSTRAINT "account_evaluations_completed_has_no_error_detail" CHECK ("account_evaluations"."status" <> 'completed' OR "account_evaluations"."error_detail" IS NULL),
	CONSTRAINT "account_evaluations_failed_requires_error_detail" CHECK ("account_evaluations"."status" <> 'failed' OR ("account_evaluations"."error_detail" IS NOT NULL AND trim("account_evaluations"."error_detail") <> ''))
);
--> statement-breakpoint
CREATE TABLE "account_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_evaluation_id" uuid NOT NULL,
	"decision_policy_version_id" uuid NOT NULL,
	"operational_context_snapshot" jsonb NOT NULL,
	"routing_output" "routing_output" NOT NULL,
	"routing_reason" text,
	"channel_availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overall_decision_gate" "decision_gate" NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "account_decisions_operational_context_is_object" CHECK (jsonb_typeof("account_decisions"."operational_context_snapshot") = 'object'),
	CONSTRAINT "account_decisions_channel_availability_is_object" CHECK (jsonb_typeof("account_decisions"."channel_availability") = 'object'),
	CONSTRAINT "account_decisions_blockers_is_array" CHECK (jsonb_typeof("account_decisions"."blockers") = 'array')
);
--> statement-breakpoint
ALTER TABLE "icp_profiles" ADD CONSTRAINT "icp_profiles_active_version_id_icp_profile_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."icp_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_profile_versions" ADD CONSTRAINT "icp_profile_versions_profile_id_icp_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."icp_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_profile_activation_events" ADD CONSTRAINT "icp_profile_activation_events_profile_id_icp_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."icp_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_profile_activation_events" ADD CONSTRAINT "icp_profile_activation_events_version_id_icp_profile_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."icp_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_profile_activation_events" ADD CONSTRAINT "icp_profile_activation_events_previous_active_version_id_icp_profile_versions_id_fk" FOREIGN KEY ("previous_active_version_id") REFERENCES "public"."icp_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_evaluations" ADD CONSTRAINT "account_evaluations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_evaluations" ADD CONSTRAINT "account_evaluations_snapshot_id_account_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."account_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_evaluations" ADD CONSTRAINT "account_evaluations_profile_version_id_icp_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."icp_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_evaluations" ADD CONSTRAINT "account_evaluations_evaluator_version_id_evaluator_versions_id_fk" FOREIGN KEY ("evaluator_version_id") REFERENCES "public"."evaluator_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_decisions" ADD CONSTRAINT "account_decisions_account_evaluation_id_account_evaluations_id_fk" FOREIGN KEY ("account_evaluation_id") REFERENCES "public"."account_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_decisions" ADD CONSTRAINT "account_decisions_decision_policy_version_id_decision_policy_versions_id_fk" FOREIGN KEY ("decision_policy_version_id") REFERENCES "public"."decision_policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "icp_profile_versions_profile_version_number_key" ON "icp_profile_versions" USING btree ("profile_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "icp_profile_versions_one_draft_per_profile" ON "icp_profile_versions" USING btree ("profile_id") WHERE "icp_profile_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "icp_profile_versions_profile_id_idx" ON "icp_profile_versions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "icp_profile_activation_events_profile_id_idx" ON "icp_profile_activation_events" USING btree ("profile_id","performed_at");--> statement-breakpoint
CREATE INDEX "account_snapshots_account_id_idx" ON "account_snapshots" USING btree ("account_id","captured_at");--> statement-breakpoint
CREATE INDEX "account_evaluations_account_id_idx" ON "account_evaluations" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "account_evaluations_account_id_production_idx" ON "account_evaluations" USING btree ("account_id","created_at") WHERE "account_evaluations"."evaluation_mode" = 'production';--> statement-breakpoint
CREATE INDEX "account_evaluations_profile_version_id_idx" ON "account_evaluations" USING btree ("profile_version_id");--> statement-breakpoint
CREATE INDEX "account_evaluations_snapshot_id_idx" ON "account_evaluations" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "account_decisions_account_evaluation_id_idx" ON "account_decisions" USING btree ("account_evaluation_id","created_at");