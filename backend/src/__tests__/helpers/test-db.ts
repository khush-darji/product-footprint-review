/**
 * Test database wiring.
 *
 * Points the app's DataSource at a scratch database (`<POSTGRES_DB>_test` by default)
 * so a test run can never truncate development data. The connection settings come from
 * the same validated config as the app, with the database name swapped.
 */
import { AppDataSource } from "../../db/data-source";

export async function connect(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

export async function disconnect(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

/**
 * Empties every table between tests.
 *
 * TRUNCATE ... CASCADE rather than deleting per table in dependency order: it is one
 * statement, it resets nothing we depend on, and adding a table later cannot silently
 * leave stale rows behind.
 */
export async function truncateAll(): Promise<void> {
  await AppDataSource.query(
    `TRUNCATE TABLE "footprint_shares", "review_events", "product_footprints", "sessions", "users" CASCADE`,
  );
}
