import { createDb } from "./index";
import { seed } from "./seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if ((process.env.APP_ENV ?? process.env.NODE_ENV) === "production" && !process.argv.includes("--allow-production")) {
  console.error("Refusing to seed demo data into production (pass --allow-production to override).");
  process.exit(1);
}
const { db, pool } = createDb({ connectionString: url, max: 1 });
try {
  await seed(db, { force: process.argv.includes("--force"), log: console.log });
} finally {
  await pool.end();
}
