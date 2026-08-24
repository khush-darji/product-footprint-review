/**
 * The single place `process.env` is read.
 *
 * Every value is read and checked here at boot, so a missing or malformed variable fails
 * the process start rather than the first request that happens to touch it. Import
 * `config` anywhere you need a setting; never reach for `process.env` elsewhere.
 *
 * The readers below are plain functions over `process.env` — no schema library. Config is
 * a fixed, known list of about twenty values read exactly once at startup, which is the
 * case where a validator earns least and costs a dependency.
 */
import "dotenv/config";

/** Collected so a bad config reports every problem at once, not one per restart. */
const problems: string[] = [];

function fail(name: string, expected: string, actual: string | undefined): void {
  // The name and the expectation, never the value: an invalid-config dump is how
  // passwords end up in a crash log.
  problems.push(`  - ${name}: expected ${expected}${actual === undefined ? " (not set)" : ""}`);
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

function optionalStr(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  // `Number("")` is 0 and `Number("12abc")` is NaN, so the integer check and the range
  // check are both needed — neither catches everything on its own.
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(name, `an integer between ${min} and ${max}`, raw);
    return fallback;
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;

  fail(name, '"true" or "false"', raw);
  return fallback;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = raw.trim() as T;
  if (!allowed.includes(value)) {
    fail(name, `one of ${allowed.map((option) => `"${option}"`).join(", ")}`, raw);
    return fallback;
  }
  return value;
}

/** Comma-separated list -> string[], with blanks dropped. */
function list(name: string, fallback: string): string[] {
  return str(name, fallback)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function url(name: string): string | undefined {
  const raw = optionalStr(name);
  if (raw === undefined) return undefined;

  // `URL.canParse` (Node 18.17+) rejects what a string check would let through, such as
  // "localhost:5432" with no scheme.
  if (!URL.canParse(raw)) {
    fail(name, "a valid URL", raw);
    return undefined;
  }
  return raw;
}

/* --- read everything ------------------------------------------------------------- */

const NODE_ENV = oneOf(
  "NODE_ENV",
  ["development", "test", "production"] as const,
  "development",
);
const isProduction = NODE_ENV === "production";

const POSTGRES_USER = str("POSTGRES_USER", "footprint");
const POSTGRES_PASSWORD = str("POSTGRES_PASSWORD", "footprint");
const POSTGRES_HOST = str("POSTGRES_HOST", "localhost");
const POSTGRES_PORT = int("POSTGRES_PORT", 5432, 1, 65_535);
const POSTGRES_DB = str("POSTGRES_DB", "footprint_review");

/** A full URL wins when supplied; otherwise the discrete parts above are assembled. */
const DATABASE_URL = url("DATABASE_URL");

/**
 * `SameSite=none` is only honoured over HTTPS — a browser silently drops such a cookie
 * without `Secure`, which presents as "signing in does nothing". Catching it here turns a
 * baffling runtime symptom into a boot-time message.
 */
const COOKIE_SAME_SITE = oneOf(
  "COOKIE_SAME_SITE",
  ["lax", "strict", "none"] as const,
  "lax",
);
if (COOKIE_SAME_SITE === "none" && !isProduction) {
  problems.push(
    '  - COOKIE_SAME_SITE: "none" requires HTTPS, so it only works with NODE_ENV=production',
  );
}

/** Postgres connection URL, assembled from the discrete parts when not given directly. */
const databaseUrl =
  DATABASE_URL ??
  `postgres://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(
    POSTGRES_PASSWORD,
  )}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;

export const config = {
  env: NODE_ENV,
  isProduction,
  isTest: NODE_ENV === "test",
  port: int("PORT", 4000, 1, 65_535),
  logLevel: oneOf(
    "LOG_LEVEL",
    ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const,
    "info",
  ),

  db: {
    url: databaseUrl,
    ssl: bool("DATABASE_SSL", false),
    logging: bool("DATABASE_LOGGING", false),
    poolSize: int("DATABASE_POOL_SIZE", 10, 1, 100),
    /* Schema changes go through committed migrations; `synchronize` is never enabled. */
    runMigrationsOnBoot: bool("RUN_MIGRATIONS_ON_BOOT", true),
  },

  cors: {
    /* An explicit allowlist. With `credentials: true` the browser attaches the session
     * cookie, so reflecting any origin would let any site act as the signed-in user. */
    origins: list("CORS_ORIGINS", "http://localhost:3000"),
  },

  rateLimit: {
    windowMs: int("RATE_LIMIT_WINDOW_MS", 15 * 60_000, 1_000, 24 * 60 * 60_000),
    maxReads: int("RATE_LIMIT_MAX_READS", 300, 1, 100_000),
    maxWrites: int("RATE_LIMIT_MAX_WRITES", 60, 1, 100_000),
    /* Login is where brute force lives, so it gets a much tighter budget. */
    maxLogins: int("RATE_LIMIT_MAX_LOGINS", 20, 1, 100_000),
  },

  /** Number of proxies in front of the app. 0 disables `trust proxy`. */
  trustProxyHops: int("TRUST_PROXY_HOPS", 0, 0, 10),

  /**
   * Password given to the demo accounts by `npm run seed`. Optional, and deliberately
   * without a fallback: the seed is the only thing that reads it, so an unset value
   * should fail the seed with a clear message rather than the whole process at boot.
   */
  seedPassword: optionalStr("SEED_PASSWORD"),

  cookieSameSite: COOKIE_SAME_SITE,
} as const;

// Thrown after `config` is built so the message lists every problem at once rather than
// stopping at the first.
if (problems.length > 0) {
  throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
}

export type AppConfig = typeof config;
