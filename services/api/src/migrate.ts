/**
 * Production migration entry (bundled to dist/migrate.js). Deploys run it as a
 * one-off step before rolling out new API/worker containers:
 *   node dist/migrate.js
 */
import "@pool/database/migrate-cli";
