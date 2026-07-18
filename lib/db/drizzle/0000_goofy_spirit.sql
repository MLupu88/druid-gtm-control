CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_key" text NOT NULL,
	"company_domain" text,
	"company_name" text,
	"identity_resolution" text,
	"match_confidence" text,
	"current_output" text,
	"current_score" integer,
	"current_queue_status" text,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "accounts_account_key_unique" UNIQUE("account_key")
);
--> statement-breakpoint
CREATE TABLE "signal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"account_id" uuid,
	"source" text,
	"signal_type" text,
	"resolution_level" text,
	"occurred_at" timestamp with time zone,
	"raw_payload" jsonb,
	"normalized_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "score_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"model" text NOT NULL,
	"rule_version" text,
	"fit_score" integer,
	"interest_score" integer,
	"identity_score" integer,
	"actionability_score" integer,
	"timing_score" integer,
	"risk_state" text,
	"total_score" integer,
	"components" jsonb,
	"calculated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"queue_type" text NOT NULL,
	"status" text,
	"recommended_output" text,
	"recommended_action" text,
	"assigned_to" text,
	"opened_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "operator_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"queue_item_id" uuid,
	"decision" text NOT NULL,
	"reason" text,
	"operator_id" text,
	"operator_name" text,
	"operator_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "action_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"decision_id" uuid,
	"capability" text NOT NULL,
	"capability_maturity" text NOT NULL,
	"execution_state" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"external_reference_id" text,
	"provider" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"metadata" jsonb,
	CONSTRAINT "action_attempts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_attempt_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"execution_state" text,
	"message" text,
	"external_reference_id" text,
	"payload" jsonb,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"company_domain" text,
	"contact_email" text,
	"reason" text,
	"source" text,
	"created_by" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "connector_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_key" text NOT NULL,
	"capability_maturity" text,
	"credential_state" text,
	"health_state" text,
	"workflow_state" text,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_states_connector_key_unique" UNIQUE("connector_key")
);
--> statement-breakpoint
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_runs" ADD CONSTRAINT "score_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_decisions" ADD CONSTRAINT "operator_decisions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_decisions" ADD CONSTRAINT "operator_decisions_queue_item_id_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."queue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_decision_id_operator_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."operator_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_action_attempt_id_action_attempts_id_fk" FOREIGN KEY ("action_attempt_id") REFERENCES "public"."action_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_company_domain_idx" ON "accounts" USING btree ("company_domain");--> statement-breakpoint
CREATE INDEX "accounts_current_queue_status_idx" ON "accounts" USING btree ("current_queue_status");--> statement-breakpoint
CREATE INDEX "signal_events_account_id_idx" ON "signal_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "signal_events_occurred_at_idx" ON "signal_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "score_runs_account_id_idx" ON "score_runs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "score_runs_calculated_at_idx" ON "score_runs" USING btree ("calculated_at");--> statement-breakpoint
CREATE INDEX "score_runs_model_idx" ON "score_runs" USING btree ("model");--> statement-breakpoint
CREATE INDEX "queue_items_account_id_idx" ON "queue_items" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "queue_items_status_idx" ON "queue_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "queue_items_queue_type_idx" ON "queue_items" USING btree ("queue_type");--> statement-breakpoint
CREATE INDEX "operator_decisions_account_id_idx" ON "operator_decisions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "operator_decisions_queue_item_id_idx" ON "operator_decisions" USING btree ("queue_item_id");--> statement-breakpoint
CREATE INDEX "operator_decisions_created_at_idx" ON "operator_decisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "action_attempts_account_id_idx" ON "action_attempts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "action_attempts_decision_id_idx" ON "action_attempts" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "action_attempts_execution_state_idx" ON "action_attempts" USING btree ("execution_state");--> statement-breakpoint
CREATE INDEX "action_attempts_capability_idx" ON "action_attempts" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "action_events_action_attempt_id_idx" ON "action_events" USING btree ("action_attempt_id");--> statement-breakpoint
CREATE INDEX "action_events_occurred_at_idx" ON "action_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "suppressions_account_id_idx" ON "suppressions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "suppressions_company_domain_idx" ON "suppressions" USING btree ("company_domain");--> statement-breakpoint
CREATE INDEX "suppressions_contact_email_idx" ON "suppressions" USING btree ("contact_email");--> statement-breakpoint
CREATE INDEX "suppressions_active_idx" ON "suppressions" USING btree ("active");--> statement-breakpoint
CREATE INDEX "connector_states_health_state_idx" ON "connector_states" USING btree ("health_state");