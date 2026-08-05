CREATE TYPE "public"."attention_item_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."attention_source" AS ENUM('manual', 'identity_resolution', 'evaluation', 'enrichment', 'client_radar', 'action');--> statement-breakpoint
CREATE TABLE "attention_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"reason_detail" text,
	"source" "attention_source" NOT NULL,
	"source_ref" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "attention_item_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_reason" text,
	CONSTRAINT "attention_items_reason_code_not_blank" CHECK (trim("attention_items"."reason_code") <> ''),
	CONSTRAINT "attention_items_reason_code_is_canonical_form" CHECK ("attention_items"."reason_code" = lower(trim("attention_items"."reason_code"))),
	CONSTRAINT "attention_items_reason_detail_not_blank_if_present" CHECK ("attention_items"."reason_detail" IS NULL OR trim("attention_items"."reason_detail") <> ''),
	CONSTRAINT "attention_items_source_ref_not_blank_if_present" CHECK ("attention_items"."source_ref" IS NULL OR trim("attention_items"."source_ref") <> ''),
	CONSTRAINT "attention_items_created_by_not_blank" CHECK (trim("attention_items"."created_by") <> ''),
	CONSTRAINT "attention_items_context_is_object" CHECK (jsonb_typeof("attention_items"."context") = 'object'),
	CONSTRAINT "attention_items_resolution_fields_iff_resolved" CHECK (
        ("attention_items"."status" = 'open'
          AND "attention_items"."resolved_at" IS NULL
          AND "attention_items"."resolved_by" IS NULL
          AND "attention_items"."resolution_reason" IS NULL)
        OR ("attention_items"."status" = 'resolved'
          AND "attention_items"."resolved_at" IS NOT NULL
          AND "attention_items"."resolved_by" IS NOT NULL AND trim("attention_items"."resolved_by") <> ''
          AND "attention_items"."resolution_reason" IS NOT NULL AND trim("attention_items"."resolution_reason") <> '')
      ),
	CONSTRAINT "attention_items_resolved_at_after_created_at" CHECK ("attention_items"."resolved_at" IS NULL OR "attention_items"."resolved_at" >= "attention_items"."created_at")
);
--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_items_open_dedup_with_ref_uq" ON "attention_items" USING btree ("account_id","reason_code","source","source_ref") WHERE "attention_items"."status" = 'open' AND "attention_items"."source_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_items_open_dedup_without_ref_uq" ON "attention_items" USING btree ("account_id","reason_code","source") WHERE "attention_items"."status" = 'open' AND "attention_items"."source_ref" IS NULL;--> statement-breakpoint
CREATE INDEX "attention_items_account_id_created_at_idx" ON "attention_items" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "attention_items_open_account_idx" ON "attention_items" USING btree ("account_id") WHERE "attention_items"."status" = 'open';--> statement-breakpoint
CREATE INDEX "attention_items_status_created_at_idx" ON "attention_items" USING btree ("status","created_at");