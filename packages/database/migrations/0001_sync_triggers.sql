-- Custom migration: change tracking for offline sync.
--
-- Every write to a synced table takes a *shared* transaction-level advisory
-- lock and then draws a fresh change_seq. The /sync/pull endpoint briefly
-- takes the *exclusive* lock to read a high-water mark: once it holds the
-- lock no writer is mid-transaction, so every change_seq <= the mark is
-- committed and visible. This prevents a slow transaction from committing a
-- lower change_seq after a device already advanced its cursor past it.

CREATE OR REPLACE FUNCTION sync_bump_change_seq() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(727001);
  NEW.change_seq := nextval('change_seq');
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
      NEW.version := OLD.version + 1;
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_bump_change_seq_append_only() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(727001);
  NEW.change_seq := nextval('change_seq');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION touch_versioned_row() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_high_water_mark() RETURNS bigint AS $$
DECLARE mark bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(727001);
  SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO mark FROM change_seq;
  RETURN mark;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER clients_change_seq BEFORE INSERT OR UPDATE ON "clients" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER properties_change_seq BEFORE INSERT OR UPDATE ON "properties" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER projects_change_seq BEFORE INSERT OR UPDATE ON "projects" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER project_stages_change_seq BEFORE INSERT OR UPDATE ON "project_stages" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER tasks_change_seq BEFORE INSERT OR UPDATE ON "tasks" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER task_dependencies_change_seq BEFORE INSERT OR UPDATE ON "task_dependencies" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER checklist_items_change_seq BEFORE INSERT OR UPDATE ON "checklist_items" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER task_notes_change_seq BEFORE INSERT OR UPDATE ON "task_notes" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER expenses_change_seq BEFORE INSERT OR UPDATE ON "expenses" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER labor_entries_change_seq BEFORE INSERT OR UPDATE ON "labor_entries" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER change_orders_change_seq BEFORE INSERT OR UPDATE ON "change_orders" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER photos_change_seq BEFORE INSERT OR UPDATE ON "photos" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER documents_change_seq BEFORE INSERT OR UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER measurements_change_seq BEFORE INSERT OR UPDATE ON "measurements" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER inspections_change_seq BEFORE INSERT OR UPDATE ON "inspections" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER messages_change_seq BEFORE INSERT OR UPDATE ON "messages" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq();
--> statement-breakpoint
CREATE TRIGGER activity_logs_change_seq BEFORE INSERT ON "activity_logs" FOR EACH ROW EXECUTE FUNCTION sync_bump_change_seq_append_only();
--> statement-breakpoint
CREATE TRIGGER budgets_touch BEFORE UPDATE ON "budgets" FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
--> statement-breakpoint
CREATE TRIGGER budget_items_touch BEFORE UPDATE ON "budget_items" FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
--> statement-breakpoint
CREATE TRIGGER material_usage_touch BEFORE UPDATE ON "material_usage" FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
--> statement-breakpoint
CREATE TRIGGER payments_touch BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
--> statement-breakpoint
CREATE TRIGGER approvals_touch BEFORE UPDATE ON "approvals" FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
--> statement-breakpoint
CREATE TRIGGER organizations_touch BEFORE UPDATE ON "organizations" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_touch BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER teams_touch BEFORE UPDATE ON "teams" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER stage_templates_touch BEFORE UPDATE ON "stage_templates" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER vendors_touch BEFORE UPDATE ON "vendors" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER materials_touch BEFORE UPDATE ON "materials" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER inspection_templates_touch BEFORE UPDATE ON "inspection_templates" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER design_projects_touch BEFORE UPDATE ON "design_projects" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER integrations_touch BEFORE UPDATE ON "integrations" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER role_permission_overrides_touch BEFORE UPDATE ON "role_permission_overrides" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
