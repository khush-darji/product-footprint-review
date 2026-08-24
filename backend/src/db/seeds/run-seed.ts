/**
 * CLI wrapper for the seed: `npm run seed` (or `npm run seed -- --force` to wipe first).
 */
import "reflect-metadata";
import { closeDatabase, initializeDatabase } from "../data-source";
import { logger } from "../../lib/logger";
import { seedFootprints } from "./footprint.seed";
import { SEED_USERS, seedPassword } from "./users.seed";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const dataSource = await initializeDatabase();

  try {
    const result = await seedFootprints(dataSource, { force });
    if (result.skipped) {
      logger.info(
        { event: "seed.skipped" },
        "database already contains submissions - nothing seeded (use --force to reset)",
      );
    } else {
      logger.info(
        { event: "seed.complete", inserted: result.inserted, shares: result.shares },
        "seed complete",
      );
      // Printed so anyone trying the app locally has credentials to sign in with. Local
      // fixtures only — see users.seed.ts. The password comes from SEED_PASSWORD, so it
      // is echoed here rather than left for the reader to go and look up.
      const password = seedPassword();
      for (const user of SEED_USERS) {
        logger.info(
          { event: "seed.user", email: user.email },
          `${user.displayName} — ${user.email} / ${password}`,
        );
      }
    }
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  logger.fatal({ event: "seed.failed", err: error }, "seed failed");
  process.exit(1);
});
