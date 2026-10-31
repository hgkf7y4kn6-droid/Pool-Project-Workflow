CREATE TYPE "public"."permit_status" AS ENUM('draft', 'submitted', 'revisions_requested', 'issued', 'finaled', 'rejected', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'permit.recorded' BEFORE 'change_order.created';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'permit.status_changed' BEFORE 'change_order.created';--> statement-breakpoint
CREATE TABLE "permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid,
	"permit_type" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"permit_number" text,
	"status" "permit_status" DEFAULT 'draft' NOT NULL,
	"submitted_on" date,
	"issued_on" date,
	"expires_on" date,
	"finaled_on" date,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"change_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_stage_id_project_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."project_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permits_project_id_index" ON "permits" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "permits_expires_on_index" ON "permits" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "permits_change_seq_index" ON "permits" USING btree ("change_seq");--> statement-breakpoint
ALTER TABLE "permits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER permits_change_seq BEFORE INSERT OR UPDATE ON "permits" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
