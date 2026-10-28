ALTER TYPE "public"."activity_action" ADD VALUE 'recommendation.updated';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'communication.approved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'intelligence_alert';--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"output" jsonb,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unsupported_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendation_id" uuid,
	"agent_run_id" uuid,
	"posted_message_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"triggered_by" uuid,
	"input_hash" text NOT NULL,
	"readiness" jsonb NOT NULL,
	"briefing" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"opened" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"closed" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_recommendation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_id" uuid,
	"automation_policy" text,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"rule_key" text NOT NULL,
	"category" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" text NOT NULL,
	"title" text NOT NULL,
	"observation" text NOT NULL,
	"risk" text NOT NULL,
	"recommended_action" text NOT NULL,
	"responsible_role" text NOT NULL,
	"assignee_id" uuid,
	"suggested_due_date" date,
	"due_rationale" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"stage_id" uuid,
	"evidence" jsonb NOT NULL,
	"impact" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_data" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"proposed_action" jsonb,
	"action_result" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"reevaluate_when" text NOT NULL,
	"expires_at" date,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	"dismiss_reason" text,
	"evaluation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "material_usage" ADD COLUMN "required_by" date;--> statement-breakpoint
ALTER TABLE "material_usage" ADD COLUMN "expected_delivery_date" date;--> statement-breakpoint
ALTER TABLE "material_usage" ADD COLUMN "delivery_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "material_usage" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "material_usage" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_drafts" ADD CONSTRAINT "communication_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_drafts" ADD CONSTRAINT "communication_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_drafts" ADD CONSTRAINT "communication_drafts_recommendation_id_intelligence_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."intelligence_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_drafts" ADD CONSTRAINT "communication_drafts_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_evaluations" ADD CONSTRAINT "intelligence_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_evaluations" ADD CONSTRAINT "intelligence_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_recommendation_events" ADD CONSTRAINT "intelligence_recommendation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_recommendation_events" ADD CONSTRAINT "intelligence_recommendation_events_recommendation_id_intelligence_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."intelligence_recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_recommendation_events" ADD CONSTRAINT "intelligence_recommendation_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_recommendations" ADD CONSTRAINT "intelligence_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_recommendations" ADD CONSTRAINT "intelligence_recommendations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_recommendations" ADD CONSTRAINT "intelligence_recommendations_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_recommendations" ADD CONSTRAINT "intelligence_recommendations_stage_id_project_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."project_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_organization_id_idempotency_key_index" ON "agent_runs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_runs_organization_id_started_at_index" ON "agent_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_project_id_kind_started_at_index" ON "agent_runs" USING btree ("project_id","kind","started_at");--> statement-breakpoint
CREATE INDEX "communication_drafts_project_id_status_created_at_index" ON "communication_drafts" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "intelligence_evaluations_project_id_created_at_index" ON "intelligence_evaluations" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "intelligence_evaluations_organization_id_created_at_index" ON "intelligence_evaluations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "intelligence_recommendation_events_recommendation_id_created_at_index" ON "intelligence_recommendation_events" USING btree ("recommendation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_recommendations_project_id_dedupe_key_index" ON "intelligence_recommendations" USING btree ("project_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "intelligence_recommendations_organization_id_status_severity_index" ON "intelligence_recommendations" USING btree ("organization_id","status","severity");--> statement-breakpoint
CREATE INDEX "intelligence_recommendations_project_id_status_index" ON "intelligence_recommendations" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "intelligence_recommendations_assignee_id_status_index" ON "intelligence_recommendations" USING btree ("assignee_id","status");--> statement-breakpoint
ALTER TABLE "material_usage" ADD CONSTRAINT "material_usage_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- New tables stay private to the API (see 0002_supabase_lockdown.sql).
ALTER TABLE "intelligence_recommendations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intelligence_recommendation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intelligence_evaluations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communication_drafts" ENABLE ROW LEVEL SECURITY;
