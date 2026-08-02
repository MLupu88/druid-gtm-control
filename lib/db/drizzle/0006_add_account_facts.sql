CREATE TABLE "account_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"recorded_by" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correction_reason" text,
	"supersedes_fact_id" uuid,
	CONSTRAINT "account_facts_field_allowed" CHECK ("account_facts"."field" IN ('company.industry', 'company.country', 'company.region', 'company.employeeRange', 'company.revenueRange')),
	CONSTRAINT "account_facts_source_is_manual_operator_v1" CHECK ("account_facts"."source" = 'manual-operator-v1'),
	CONSTRAINT "account_facts_value_not_blank" CHECK (trim("account_facts"."value") <> ''),
	CONSTRAINT "account_facts_value_max_length" CHECK (length("account_facts"."value") <= 500),
	CONSTRAINT "account_facts_region_value_allowed" CHECK ("account_facts"."field" <> 'company.region' OR "account_facts"."value" IN ('us', 'emea', 'other')),
	CONSTRAINT "account_facts_recorded_by_not_blank" CHECK (trim("account_facts"."recorded_by") <> ''),
	CONSTRAINT "account_facts_correction_reason_iff_supersedes" CHECK (("account_facts"."supersedes_fact_id" IS NULL AND "account_facts"."correction_reason" IS NULL)
        OR ("account_facts"."supersedes_fact_id" IS NOT NULL AND "account_facts"."correction_reason" IS NOT NULL AND trim("account_facts"."correction_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "account_fact_current" (
	"account_id" uuid NOT NULL,
	"field" text NOT NULL,
	"fact_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_fact_current_account_id_field_pk" PRIMARY KEY("account_id","field")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_facts_id_account_field_uq" ON "account_facts" USING btree ("id","account_id","field");--> statement-breakpoint
ALTER TABLE "account_facts" ADD CONSTRAINT "account_facts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_facts" ADD CONSTRAINT "account_facts_supersedes_same_account_field_fk" FOREIGN KEY ("supersedes_fact_id","account_id","field") REFERENCES "public"."account_facts"("id","account_id","field") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_fact_current" ADD CONSTRAINT "account_fact_current_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_fact_current" ADD CONSTRAINT "account_fact_current_fact_same_account_field_fk" FOREIGN KEY ("fact_id","account_id","field") REFERENCES "public"."account_facts"("id","account_id","field") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_facts_supersedes_fact_id_uq" ON "account_facts" USING btree ("supersedes_fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_facts_one_root_per_account_field" ON "account_facts" USING btree ("account_id","field") WHERE "account_facts"."supersedes_fact_id" IS NULL;--> statement-breakpoint
CREATE INDEX "account_facts_account_field_idx" ON "account_facts" USING btree ("account_id","field","recorded_at");