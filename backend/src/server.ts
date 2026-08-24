/**
 * Process entry point: connect the database, listen, and shut down cleanly.
 */
import "reflect-metadata";
import type { Server } from "node:http";
import { createApp } from "./app";
import { config } from "./config/env";
import { closeDatabase, initializeDatabase } from "./db/data-source";
import { logger } from "./lib/logger";

/** How long in-flight requests get to finish before the process is killed anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  await initializeDatabase();
  logger.info({ event: "database.connected" }, "database ready");

  const app = createApp();
  const server: Server = app.listen(config.port, () => {
    logger.info(
      { event: "server.listening", port: config.port, env: config.env },
      `listening on http://localhost:${config.port}`,
    );
  });

  // Without this, a slow client can hold a connection open indefinitely.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  // Must exceed the load balancer's idle timeout, or the balancer reuses a connection
  // Node is in the middle of closing and the client sees a sporadic 502.
  server.keepAliveTimeout = 65_000;

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: "server.shutdown", signal }, "shutting down");

    // Kill the process even if a connection refuses to close — a shutdown that hangs is
    // a container that never terminates. `unref` so the timer itself cannot hold the
    // loop open once everything else is done.
    const forceExit = setTimeout(() => {
      logger.error({ event: "server.shutdown.forced" }, "forced exit after grace period");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await closeDatabase();
      logger.info({ event: "server.shutdown.complete" }, "shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error({ event: "server.shutdown.failed", err: error }, "shutdown failed");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // After an uncaught exception the process is in an unknown state; the only safe move
  // is to log it and let the supervisor restart cleanly. Swallowing it keeps a
  // corrupted process serving traffic.
  process.on("uncaughtException", (err) => {
    logger.fatal({ event: "process.uncaughtException", err }, "uncaught exception");
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ event: "process.unhandledRejection", err: reason }, "unhandled rejection");
    void shutdown("unhandledRejection");
  });
}

main().catch((error: unknown) => {
  logger.fatal({ event: "server.startup.failed", err: error }, "failed to start");
  process.exit(1);
});
