/**
 * Loads `.env.test` before anything reads `process.env`.
 *
 * This must run first: `config/env.ts` calls `dotenv/config` at module scope, and
 * dotenv does not overwrite variables that are already set — so by getting in ahead of
 * it with `override: true`, the test database name wins over whatever `.env` says.
 *
 * Registered both as a Jest `setupFiles` entry (each worker is its own process) and
 * from `global-setup.ts` (which runs in the main process). Missing either one leaves a
 * suite pointed at the development database.
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(__dirname, "../../../.env.test"),
  override: true,
  // Keeps the loader from printing a banner into every test run's output.
  quiet: true,
});
