import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
runMigrations(url)
  .then(() => console.log("Migrations applied"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
