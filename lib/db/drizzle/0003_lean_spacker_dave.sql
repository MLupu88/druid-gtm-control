CREATE TYPE "public"."client_radar_research_status" AS ENUM('submitting', 'queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "client_radar_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"client_radar_run_id" text,
	"status" "client_radar_research_status" DEFAULT 'submitting' NOT NULL,
	"submitted_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"account_payload" jsonb,
	"evidence_payload" jsonb,
	"result_schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_radar_research_runs_client_radar_run_id_unique" UNIQUE("client_radar_run_id")
);
--> statement-breakpoint
ALTER TABLE "client_radar_research_runs" ADD CONSTRAINT "client_radar_research_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_radar_research_runs_account_id_idx" ON "client_radar_research_runs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_radar_research_runs_one_active_per_account" ON "client_radar_research_runs" USING btree ("account_id") WHERE "client_radar_research_runs"."status" IN ('submitting', 'queued', 'running');