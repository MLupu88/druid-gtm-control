CREATE TYPE "public"."observation_class" AS ENUM('identity', 'firmographic_fact', 'crm_state', 'behavioral_signal', 'research_intelligence');--> statement-breakpoint
CREATE TYPE "public"."observation_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"source_record_id" text NOT NULL,
	"observation_class" "observation_class" NOT NULL,
	"semantic_key" text NOT NULL,
	"identity_subject_type" text,
	"identity_value" text,
	"raw_value" jsonb,
	"normalized_value" jsonb,
	"observed_at" timestamp with time zone,
	"imported_at" timestamp with time zone NOT NULL,
	"confidence" "observation_confidence",
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_metadata" jsonb,
	CONSTRAINT "observations_provider_not_blank" CHECK (trim("observations"."provider") <> ''),
	CONSTRAINT "observations_provider_is_canonical_form" CHECK ("observations"."provider" = lower(trim("observations"."provider"))),
	CONSTRAINT "observations_source_record_id_not_blank" CHECK (trim("observations"."source_record_id") <> ''),
	CONSTRAINT "observations_semantic_key_not_blank" CHECK (trim("observations"."semantic_key") <> ''),
	CONSTRAINT "observations_semantic_key_allowed_for_class" CHECK (
        ("observations"."observation_class" = 'identity' AND "observations"."semantic_key" IN ('domain', 'external_id'))
        OR ("observations"."observation_class" = 'firmographic_fact' AND "observations"."semantic_key" IN (
          'company.industry', 'company.country', 'company.region',
          'company.employeeRange', 'company.revenueRange'
        ))
        OR ("observations"."observation_class" = 'crm_state' AND "observations"."semantic_key" IN (
          'crm.owner', 'crm.lifecycleStage', 'crm.openOpportunity',
          'crm.existingCustomer', 'crm.competitorFlag', 'crm.partnerFlag'
        ))
        OR ("observations"."observation_class" IN ('behavioral_signal', 'research_intelligence'))
      ),
	CONSTRAINT "observations_identity_subject_type_allowed" CHECK ("observations"."identity_subject_type" IS NULL OR "observations"."identity_subject_type" IN ('account', 'person')),
	CONSTRAINT "observations_identity_payload_shape" CHECK (
        ("observations"."observation_class" = 'identity'
          AND "observations"."identity_subject_type" IS NOT NULL
          AND "observations"."identity_value" IS NOT NULL AND trim("observations"."identity_value") <> ''
          AND "observations"."raw_value" IS NULL
          AND "observations"."normalized_value" IS NULL)
        OR
        ("observations"."observation_class" <> 'identity'
          AND "observations"."identity_subject_type" IS NULL
          AND "observations"."identity_value" IS NULL
          AND "observations"."raw_value" IS NOT NULL)
      ),
	CONSTRAINT "observations_evidence_refs_is_array" CHECK (jsonb_typeof("observations"."evidence_refs") = 'array'),
	CONSTRAINT "observations_provider_metadata_is_object" CHECK ("observations"."provider_metadata" IS NULL OR jsonb_typeof("observations"."provider_metadata") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "observations_occurrence_uq" ON "observations" USING btree ("provider","observation_class","source_record_id","semantic_key","imported_at");--> statement-breakpoint
CREATE INDEX "observations_provider_source_record_id_idx" ON "observations" USING btree ("provider","source_record_id");