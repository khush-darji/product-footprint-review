import type { Config } from "jest";

/**
 * Tests run against a REAL Postgres database, not mocks.
 *
 * The risk in this codebase is concentrated in two places — the access-scoped SQL and
 * the row-locked review transaction — and neither survives being mocked: a mocked
 * repository would happily "prove" that a viewer cannot approve while the actual WHERE
 * clause leaked every row. So the suite points at a scratch database, runs the real
 * migrations against it, and truncates between tests.
 *
 * `maxWorkers: 1` because the suites share that one database; parallel workers would
 * truncate each other's fixtures mid-test.
 */
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testMatch: ["**/__tests__/**/*.test.ts"],

  // 5s is routinely too short once a migration run is in play.
  testTimeout: 30_000,

  // Runs in every worker process, before the framework and before any import that
  // reads process.env.
  setupFiles: ["<rootDir>/__tests__/helpers/load-env.ts"],
  globalSetup: "<rootDir>/__tests__/helpers/global-setup.ts",
  setupFilesAfterEnv: ["<rootDir>/__tests__/helpers/setup-after-env.ts"],

  maxWorkers: 1,
  clearMocks: true,
  restoreMocks: true,

  // Surfaces a connection left open rather than letting the run hang silently.
  detectOpenHandles: true,
  forceExit: false,
};

export default config;
