-- Custom migration: keep application data private on Supabase.
--
-- Supabase exposes the `public` schema through its Data API (REST/GraphQL)
-- to the `anon` and `authenticated` roles, whose keys are public. Pool PM
-- never uses that API: every request goes through our own API, which
-- connects as the table owner. So:
--   1. Row Level Security is enabled on every table with no policies, which
--      denies all rows to any non-owner role. The owner (our API) bypasses
--      RLS because it is not FORCE'd.
--   2. On Supabase, all privileges are revoked from anon/authenticated, now
--      and for future objects, so tables are not even discoverable via
--      GraphQL introspection.
-- On plain Postgres (local, CI) step 2 is skipped because those roles don't
-- exist. New tables must enable RLS in their migration; a database test
-- fails if one doesn't.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;
