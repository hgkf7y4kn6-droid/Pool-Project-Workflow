import { tlsFromEnv } from "./index";
import { runMigrations } from "./migrate";

// Migrations need a direct or session-mode connection (on Supabase: the
// "Direct connection" or "Session pooler" string), so MIGRATION_DATABASE_URL
// can differ from the URL the API uses.
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (or MIGRATION_DATABASE_URL) is required");
  process.exit(1);
}

runMigrations(url, tlsFromEnv())
  .then(() => console.log("Migrations applied"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
