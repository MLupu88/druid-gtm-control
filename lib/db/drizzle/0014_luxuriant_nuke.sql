CREATE TYPE "public"."fact_resolution_state" AS ENUM('single_source', 'agreement', 'conflict', 'unresolved');--> statement-breakpoint
CREATE TABLE "resolved_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"canonical_field" text NOT NULL,
	"resolution_state" "fact_resolution_state" NOT NULL,
	"canonical_value" jsonb,
	"selected_observation_id" uuid,
	"selected_manual_account_fact_id" uuid,
	"supporting_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicting_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"considered_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"rationale" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolved_facts_canonical_field_allowed" CHECK ("resolved_facts"."canonical_field" IN ('company.industry', 'company.country', 'company.region', 'company.employeeRange', 'company.revenueRange', 'crm.owner', 'crm.lifecycleStage', 'crm.openOpportunity', 'crm.existingCustomer', 'crm.competitorFlag', 'crm.partnerFlag')),
	CONSTRAINT "resolved_facts_policy_version_not_blank" CHECK (trim("resolved_facts"."policy_version") <> ''),
	CONSTRAINT "resolved_facts_rationale_not_blank" CHECK (trim("resolved_facts"."rationale") <> ''),
	CONSTRAINT "resolved_facts_selected_evidence_mutually_exclusive" CHECK (NOT ("resolved_facts"."selected_observation_id" IS NOT NULL AND "resolved_facts"."selected_manual_account_fact_id" IS NOT NULL)),
	CONSTRAINT "resolved_facts_canonical_value_matches_state" CHECK (
        ("resolved_facts"."resolution_state" IN ('single_source', 'agreement')
          AND "resolved_facts"."canonical_value" IS NOT NULL
          AND ("resolved_facts"."selected_observation_id" IS NOT NULL OR "resolved_facts"."selected_manual_account_fact_id" IS NOT NULL))
        OR ("resolved_facts"."resolution_state" = 'unresolved'
          AND "resolved_facts"."canonical_value" IS NULL
          AND "resolved_facts"."selected_observation_id" IS NULL
          AND "resolved_facts"."selected_manual_account_fact_id" IS NULL)
        OR ("resolved_facts"."resolution_state" = 'conflict'
          AND (("resolved_facts"."canonical_value" IS NULL
              AND "resolved_facts"."selected_observation_id" IS NULL
              AND "resolved_facts"."selected_manual_account_fact_id" IS NULL)
            OR ("resolved_facts"."canonical_value" IS NOT NULL
              AND ("resolved_facts"."selected_observation_id" IS NOT NULL OR "resolved_facts"."selected_manual_account_fact_id" IS NOT NULL))))
      ),
	CONSTRAINT "resolved_facts_supporting_evidence_is_array" CHECK (jsonb_typeof("resolved_facts"."supporting_evidence") = 'array'),
	CONSTRAINT "resolved_facts_conflicting_evidence_is_array" CHECK (jsonb_typeof("resolved_facts"."conflicting_evidence") = 'array'),
	CONSTRAINT "resolved_facts_considered_evidence_is_array" CHECK (jsonb_typeof("resolved_facts"."considered_evidence") = 'array')
);
--> statement-breakpoint
ALTER TABLE "resolved_facts" ADD CONSTRAINT "resolved_facts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolved_facts" ADD CONSTRAINT "resolved_facts_selected_observation_id_observations_id_fk" FOREIGN KEY ("selected_observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolved_facts" ADD CONSTRAINT "resolved_facts_manual_fact_same_account_field_fk" FOREIGN KEY ("selected_manual_account_fact_id","account_id","canonical_field") REFERENCES "public"."account_facts"("id","account_id","field") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resolved_facts_id_account_field_uq" ON "resolved_facts" USING btree ("id","account_id","canonical_field");--> statement-breakpoint
CREATE INDEX "resolved_facts_account_field_resolved_at_idx" ON "resolved_facts" USING btree ("account_id","canonical_field","resolved_at");