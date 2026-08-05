CREATE TYPE "public"."identity_alias_normalization_strategy" AS ENUM('domain', 'case_insensitive', 'exact');--> statement-breakpoint
CREATE TYPE "public"."identity_match_action" AS ENUM('matched', 'created');--> statement-breakpoint
CREATE TYPE "public"."identity_resolution_outcome" AS ENUM('unresolved', 'account_resolved', 'person_resolved');--> statement-breakpoint
CREATE TABLE "account_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"alias_type" text NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"normalization_strategy" "identity_alias_normalization_strategy" NOT NULL,
	"is_strong" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_aliases_alias_type_not_blank" CHECK (trim("account_aliases"."alias_type") <> ''),
	CONSTRAINT "account_aliases_raw_value_not_blank" CHECK (trim("account_aliases"."raw_value") <> ''),
	CONSTRAINT "account_aliases_normalized_value_not_blank" CHECK (trim("account_aliases"."normalized_value") <> ''),
	CONSTRAINT "account_aliases_source_not_blank" CHECK (trim("account_aliases"."source") <> ''),
	CONSTRAINT "account_aliases_normalized_value_matches_strategy" CHECK (
        ("account_aliases"."normalization_strategy" = 'exact' AND "account_aliases"."normalized_value" = trim("account_aliases"."normalized_value"))
        OR (
          "account_aliases"."normalization_strategy" = 'case_insensitive'
          AND "account_aliases"."normalized_value" = lower(trim("account_aliases"."normalized_value"))
        )
        OR (
          "account_aliases"."normalization_strategy" = 'domain'
          AND "account_aliases"."normalized_value" = lower(trim("account_aliases"."normalized_value"))
          AND "account_aliases"."normalized_value" !~ '://'
          AND "account_aliases"."normalized_value" !~ '[/?#]'
          AND "account_aliases"."normalized_value" NOT LIKE 'www.%'
        )
      )
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text,
	"work_email" text,
	"linkedin_url" text,
	"external_id" text,
	"external_id_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_full_name_not_blank" CHECK ("people"."full_name" IS NULL OR trim("people"."full_name") <> ''),
	CONSTRAINT "people_work_email_not_blank" CHECK ("people"."work_email" IS NULL OR trim("people"."work_email") <> ''),
	CONSTRAINT "people_work_email_is_canonical_form" CHECK ("people"."work_email" IS NULL OR "people"."work_email" = lower(trim("people"."work_email"))),
	CONSTRAINT "people_linkedin_url_not_blank" CHECK ("people"."linkedin_url" IS NULL OR trim("people"."linkedin_url") <> ''),
	CONSTRAINT "people_external_id_iff_source" CHECK (("people"."external_id" IS NULL AND "people"."external_id_source" IS NULL)
        OR ("people"."external_id" IS NOT NULL AND "people"."external_id_source" IS NOT NULL AND trim("people"."external_id_source") <> '')),
	CONSTRAINT "people_has_identity_attribute" CHECK ("people"."full_name" IS NOT NULL OR "people"."work_email" IS NOT NULL OR "people"."linkedin_url" IS NOT NULL OR "people"."external_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "account_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text,
	"relationship_type" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "account_people_title_not_blank" CHECK ("account_people"."title" IS NULL OR trim("account_people"."title") <> ''),
	CONSTRAINT "account_people_relationship_type_not_blank" CHECK ("account_people"."relationship_type" IS NULL OR trim("account_people"."relationship_type") <> ''),
	CONSTRAINT "account_people_source_not_blank" CHECK (trim("account_people"."source") <> ''),
	CONSTRAINT "account_people_last_seen_after_first_seen" CHECK ("account_people"."last_seen_at" >= "account_people"."first_seen_at")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"signal_type" text NOT NULL,
	"observed_resolution_level" "identity_resolution_level" NOT NULL,
	"company_domain" text,
	"company_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"schema_version" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_source_not_blank" CHECK (trim("signals"."source") <> ''),
	CONSTRAINT "signals_source_is_canonical_form" CHECK ("signals"."source" = lower(trim("signals"."source"))),
	CONSTRAINT "signals_source_event_id_not_blank" CHECK (trim("signals"."source_event_id") <> ''),
	CONSTRAINT "signals_signal_type_not_blank" CHECK (trim("signals"."signal_type") <> ''),
	CONSTRAINT "signals_schema_version_not_blank" CHECK (trim("signals"."schema_version") <> ''),
	CONSTRAINT "signals_raw_payload_is_object" CHECK (jsonb_typeof("signals"."raw_payload") = 'object'),
	CONSTRAINT "signals_normalized_payload_is_object" CHECK (jsonb_typeof("signals"."normalized_payload") = 'object'),
	CONSTRAINT "signals_company_domain_is_normalized_domain_shape" CHECK (
        "signals"."company_domain" IS NULL
        OR (
          "signals"."company_domain" = lower(trim("signals"."company_domain"))
          AND "signals"."company_domain" !~ '://'
          AND "signals"."company_domain" !~ '[/?#]'
          AND "signals"."company_domain" NOT LIKE 'www.%'
        )
      )
);
--> statement-breakpoint
CREATE TABLE "identity_resolution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"outcome" "identity_resolution_outcome" NOT NULL,
	"resolution_level" "identity_resolution_level" NOT NULL,
	"resolution_method" text NOT NULL,
	"confidence" "identity_confidence" NOT NULL,
	"resolver_version" text NOT NULL,
	"candidate_matches" jsonb,
	"account_id" uuid,
	"account_match_action" "identity_match_action",
	"person_id" uuid,
	"person_match_action" "identity_match_action",
	"matched_alias_type" text,
	"matched_alias_value" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_resolution_events_resolution_method_not_blank" CHECK (trim("identity_resolution_events"."resolution_method") <> ''),
	CONSTRAINT "identity_resolution_events_resolver_version_not_blank" CHECK (trim("identity_resolution_events"."resolver_version") <> ''),
	CONSTRAINT "identity_resolution_events_matched_alias_type_not_blank" CHECK ("identity_resolution_events"."matched_alias_type" IS NULL OR trim("identity_resolution_events"."matched_alias_type") <> ''),
	CONSTRAINT "identity_resolution_events_matched_alias_value_not_blank" CHECK ("identity_resolution_events"."matched_alias_value" IS NULL OR trim("identity_resolution_events"."matched_alias_value") <> ''),
	CONSTRAINT "identity_resolution_events_reason_not_blank" CHECK ("identity_resolution_events"."reason" IS NULL OR trim("identity_resolution_events"."reason") <> ''),
	CONSTRAINT "identity_resolution_events_candidate_matches_is_array" CHECK ("identity_resolution_events"."candidate_matches" IS NULL OR jsonb_typeof("identity_resolution_events"."candidate_matches") = 'array'),
	CONSTRAINT "identity_resolution_events_account_id_matches_outcome" CHECK (("identity_resolution_events"."outcome" = 'unresolved' AND "identity_resolution_events"."account_id" IS NULL)
        OR ("identity_resolution_events"."outcome" <> 'unresolved' AND "identity_resolution_events"."account_id" IS NOT NULL)),
	CONSTRAINT "identity_resolution_events_person_id_matches_outcome" CHECK (("identity_resolution_events"."outcome" = 'person_resolved' AND "identity_resolution_events"."person_id" IS NOT NULL)
        OR ("identity_resolution_events"."outcome" <> 'person_resolved' AND "identity_resolution_events"."person_id" IS NULL)),
	CONSTRAINT "identity_resolution_events_account_match_action_matches_outcome" CHECK (("identity_resolution_events"."outcome" = 'unresolved' AND "identity_resolution_events"."account_match_action" IS NULL)
        OR ("identity_resolution_events"."outcome" <> 'unresolved' AND "identity_resolution_events"."account_match_action" IS NOT NULL)),
	CONSTRAINT "identity_resolution_events_person_match_action_matches_outcome" CHECK (("identity_resolution_events"."outcome" = 'person_resolved' AND "identity_resolution_events"."person_match_action" IS NOT NULL)
        OR ("identity_resolution_events"."outcome" <> 'person_resolved' AND "identity_resolution_events"."person_match_action" IS NULL)),
	CONSTRAINT "identity_resolution_events_person_requires_contact_level" CHECK ("identity_resolution_events"."person_id" IS NULL OR "identity_resolution_events"."resolution_level" IN ('contact', 'known_crm_contact')),
	CONSTRAINT "identity_resolution_events_resolution_level_matches_outcome" CHECK (
        ("identity_resolution_events"."outcome" = 'unresolved' AND "identity_resolution_events"."resolution_level" = 'anonymous')
        OR ("identity_resolution_events"."outcome" = 'account_resolved' AND "identity_resolution_events"."resolution_level" = 'company')
        OR ("identity_resolution_events"."outcome" = 'person_resolved' AND "identity_resolution_events"."resolution_level" IN ('contact', 'known_crm_contact'))
      )
);
--> statement-breakpoint
ALTER TABLE "account_aliases" ADD CONSTRAINT "account_aliases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_people" ADD CONSTRAINT "account_people_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_people" ADD CONSTRAINT "account_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_resolution_events" ADD CONSTRAINT "identity_resolution_events_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_resolution_events" ADD CONSTRAINT "identity_resolution_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_resolution_events" ADD CONSTRAINT "identity_resolution_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_aliases_strong_type_normalized_value_uq" ON "account_aliases" USING btree ("alias_type","normalized_value") WHERE "account_aliases"."is_strong" = true;--> statement-breakpoint
CREATE INDEX "account_aliases_account_id_idx" ON "account_aliases" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_work_email_uq" ON "people" USING btree ("work_email") WHERE "people"."work_email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "people_external_id_source_id_uq" ON "people" USING btree ("external_id_source","external_id") WHERE "people"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_people_account_id_person_id_uq" ON "account_people" USING btree ("account_id","person_id");--> statement-breakpoint
CREATE INDEX "account_people_person_id_idx" ON "account_people" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_source_source_event_id_uq" ON "signals" USING btree ("source","source_event_id");--> statement-breakpoint
CREATE INDEX "signals_company_domain_occurred_at_idx" ON "signals" USING btree ("company_domain","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_resolution_events_signal_id_created_at_id_idx" ON "identity_resolution_events" USING btree ("signal_id","created_at","id");--> statement-breakpoint
CREATE INDEX "identity_resolution_events_account_id_idx" ON "identity_resolution_events" USING btree ("account_id");