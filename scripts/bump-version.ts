/**
 * Bumps the Pool PM version everywhere it appears (root, every workspace,
 * apps/mobile/app.json) and refreshes package-lock.json.
 *
 *   npm run version:bump            # next version (0.0.9 → 0.1.0)
 *   npm run version:bump -- 0.0.3   # set an explicit version
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextVersion } from "../packages/config/src/version";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string; workspaces: string[] };
const target = process.argv[2] ?? nextVersion(rootPkg.version);
if (process.argv[2]) nextVersion(target); // validates the explicit version's shape

const files = [
  "package.json",
  "apps/mobile/package.json",
  "e2e/package.json",
  ...["api-client", "config", "core", "database", "sync", "types", "ui", "validation"].map((p) => `packages/${p}/package.json`),
  ...["api", "worker"].map((s) => `services/${s}/package.json`),
];
for (const f of files) {
  const file = path.join(root, f);
  const json = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
  json.version = target;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
const appFile = path.join(root, "apps/mobile/app.json");
const app = JSON.parse(readFileSync(appFile, "utf8")) as { expo: { version: string } };
app.expo.version = target;
writeFileSync(appFile, `${JSON.stringify(app, null, 2)}\n`);

const versionFile = path.join(root, "packages/config/src/version.ts");
writeFileSync(versionFile, readFileSync(versionFile, "utf8").replace(/export const APP_VERSION = "[^"]*";/, `export const APP_VERSION = "${target}";`));

execSync("npm install --package-lock-only --ignore-scripts --no-audit --no-fund", { cwd: root, stdio: "ignore" });
console.log(`${rootPkg.version} → ${target}`);
