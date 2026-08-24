/**
 * Creates the scratch database if it does not exist and runs the real migrations
 * against it, once per test run.
 *
 * Running the actual migrations rather than `synchronize: true` is deliberate: it means
 * the suite exercises the same schema the application deploys, so a migration that is
 * wrong fails the tests instead of passing them against a schema nobody will ever have.
 */
// Must be first: globalSetup runs in the main process, which does not get the
// `setupFiles` entry the workers do — and `data-source` below pulls in the config
// module, which reads process.env at import time. Import order is the load order here,
// so nothing may be moved above this line.
import "./load-env";
import { Client } from "pg";
import { AppDataSource } from "../../db/data-source";

export default async function globalSetup(): Promise<void> {
  const database = process.env.POSTGRES_DB ?? "footprint_review_test";

  // Connect to the maintenance database to create the test one; CREATE DATABASE cannot
  // run inside a transaction or against the database being created.
  const admin = new Client({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "footprint",
    password: process.env.POSTGRES_PASSWORD ?? "footprint",
    database: "postgres",
  });

  await admin.connect();
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
    database,
  ]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${database}"`);
  }
  await admin.end();

  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
}
