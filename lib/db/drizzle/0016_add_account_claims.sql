CREATE TYPE "public"."claim_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."claim_origin" AS ENUM('observed', 'derived', 'research', 'human_confirmed', 'human_corrected');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('active', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."claim_value_type" AS ENUM('boolean', 'number', 'string', 'list', 'object');--> statement-breakpoint
CREATE TABLE "account_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"claim_key" text NOT NULL,
	"value_type" "claim_value_type",
	"value" jsonb,
	"origin" "claim_origin" NOT NULL,
	"confidence" "claim_confidence",
	"status" "claim_status" DEFAULT 'active' NOT NULL,
	"supersedes_claim_id" uuid,
	"correction_reason" text,
	"recorded_by" text,
	"generated_by_version" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_claims_claim_key_not_blank" CHECK (trim("account_claims"."claim_key") <> ''),
	CONSTRAINT "account_claims_claim_key_max_length" CHECK (length("account_claims"."claim_key") <= 200),
	CONSTRAINT "account_claims_claim_key_format" CHECK ("account_claims"."claim_key" ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)+$'),
	CONSTRAINT "account_claims_active_has_value" CHECK (
        ("account_claims"."status" = 'active' AND "account_claims"."value" IS NOT NULL AND "account_claims"."value_type" IS NOT NULL)
        OR ("account_claims"."status" = 'rejected' AND "account_claims"."value" IS NULL AND "account_claims"."value_type" IS NULL)
      ),
	CONSTRAINT "account_claims_rejected_requires_human_correction" CHECK ("account_claims"."status" <> 'rejected' OR ("account_claims"."origin" = 'human_corrected' AND "account_claims"."supersedes_claim_id" IS NOT NULL)),
	CONSTRAINT "account_claims_correction_reason_iff_supersedes" CHECK (("account_claims"."supersedes_claim_id" IS NULL AND "account_claims"."correction_reason" IS NULL)
        OR ("account_claims"."supersedes_claim_id" IS NOT NULL AND "account_claims"."correction_reason" IS NOT NULL AND trim("account_claims"."correction_reason") <> '')),
	CONSTRAINT "account_claims_recorded_by_iff_human_origin" CHECK (("account_claims"."origin" IN ('human_confirmed', 'human_corrected') AND "account_claims"."recorded_by" IS NOT NULL AND trim("account_claims"."recorded_by") <> '')
        OR ("account_claims"."origin" NOT IN ('human_confirmed', 'human_corrected') AND "account_claims"."recorded_by" IS NULL)),
	CONSTRAINT "account_claims_generated_by_version_iff_derived" CHECK (("account_claims"."origin" = 'derived' AND "account_claims"."generated_by_version" IS NOT NULL AND trim("account_claims"."generated_by_version") <> '')
        OR ("account_claims"."origin" <> 'derived' AND "account_claims"."generated_by_version" IS NULL)),
	CONSTRAINT "account_claims_machine_origin_requires_evidence" CHECK ("account_claims"."origin" IN ('human_confirmed', 'human_corrected') OR jsonb_array_length("account_claims"."evidence_refs") >= 1),
	CONSTRAINT "account_claims_evidence_refs_is_array" CHECK (jsonb_typeof("account_claims"."evidence_refs") = 'array')
);
--> statement-breakpoint
CREATE TABLE "account_claim_current" (
	"account_id" uuid NOT NULL,
	"claim_key" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_claim_current_account_id_claim_key_pk" PRIMARY KEY("account_id","claim_key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_claims_id_account_key_uq" ON "account_claims" USING btree ("id","account_id","claim_key");--> statement-breakpoint
ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_supersedes_same_account_key_fk" FOREIGN KEY ("supersedes_claim_id","account_id","claim_key") REFERENCES "public"."account_claims"("id","account_id","claim_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_claim_current" ADD CONSTRAINT "account_claim_current_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_claim_current" ADD CONSTRAINT "account_claim_current_claim_same_account_key_fk" FOREIGN KEY ("claim_id","account_id","claim_key") REFERENCES "public"."account_claims"("id","account_id","claim_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_claims_supersedes_claim_id_uq" ON "account_claims" USING btree ("supersedes_claim_id");--> statement-breakpoint
CREATE INDEX "account_claims_account_key_created_idx" ON "account_claims" USING btree ("account_id","claim_key","created_at");--> statement-breakpoint
CREATE INDEX "account_claims_account_status_idx" ON "account_claims" USING btree ("account_id","status");