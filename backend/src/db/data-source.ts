/**
 * The one TypeORM DataSource for the process.
 *
 * A DataSource per request would exhaust the connection pool at around the tenth
 * concurrent user, so this module is imported, never re-instantiated. It is also the
 * file the TypeORM CLI loads for migrations, which is why it exports the DataSource as
 * the default and does nothing on import beyond constructing it.
 */
import "reflect-metadata";
import { DataSource } from "typeorm";
import { config } from "../config/env";
import { FootprintShare } from "../entities/footprint-share.entity";
import { ProductFootprint } from "../entities/product-footprint.entity";
import { ReviewEvent } from "../entities/review-event.entity";
import { Session } from "../entities/session.entity";
import { User } from "../entities/user.entity";
import { InitFootprintSchema1724500000000 } from "./migrations/1724500000000-InitFootprintSchema";
import { AddUsersAndSharing1724700000000 } from "./migrations/1724700000000-AddUsersAndSharing";
import { AddPasswordAuthAndSessions1724800000000 } from "./migrations/1724800000000-AddPasswordAuthAndSessions";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,

  /* Entities and migrations are imported explicitly rather than glob-loaded. Globs
   * resolve differently under tsx, ts-jest and compiled dist/, and the failure mode is
   * "no metadata for X" at runtime in exactly one of those three. */
  entities: [User, Session, ProductFootprint, ReviewEvent, FootprintShare],
  migrations: [
    InitFootprintSchema1724500000000,
    AddUsersAndSharing1724700000000,
    AddPasswordAuthAndSessions1724800000000,
  ],

  /* Never true. Auto-sync silently rewrites production schemas; every change here is a
   * committed, reversible migration instead. */
  synchronize: false,
  migrationsRun: false,
  logging: config.db.logging ? ["query", "error", "warn"] : ["error", "warn"],

  poolSize: config.db.poolSize,
  extra: {
    /* Without these a single stuck query holds a connection indefinitely and the pool
     * drains behind it. */
    statement_timeout: 10_000,
    query_timeout: 10_000,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  },
});

/** Opens the pool and, unless disabled, applies pending migrations. Idempotent. */
export async function initializeDatabase(): Promise<DataSource> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  if (config.db.runMigrationsOnBoot) {
    await AppDataSource.runMigrations();
  }
  return AppDataSource;
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

/** Readiness probe: cheapest possible round trip that proves the pool works. */
export async function pingDatabase(): Promise<void> {
  await AppDataSource.query("SELECT 1");
}
