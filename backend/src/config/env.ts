/**
 * The single place `process.env` is read.
 *
 * One Joi schema, validated at boot, so a missing or malformed variable fails the process
 * start rather than the first request that happens to touch it. Import `config` anywhere
 * you need a setting; never reach for `process.env` elsewhere.
 *
 * **There are no defaults.** Every variable the app needs must be set, which is why an
 * environment file is required rather than optional — see `.env.example` for the full
 * list. A default is a value nobody chose and nobody can see, and the ones that used to
 * live here were silently wrong in any environment that forgot to set them: a rate limit
 * that never fires, a CORS list pointing at localhost, `RUN_MIGRATIONS_ON_BOOT` deciding
 * on its own to alter a production schema. The only optional variables are the two that
 * genuinely are: `DATABASE_URL` and `SEED_PASSWORD`.
 *
 * Two properties here are deliberate and easy to lose by accident:
 *
 *  - **No message contains the offending value.** Half these variables are credentials,
 *    and an invalid-config dump is how a password ends up in a crash log. Joi's built-in
 *    messages for the types used below name the variable and the expectation but never
 *    the value — `string.pattern.base` is the one that would, which is why nothing here
 *    validates with a regex. `errors.wrap` is off so the value is not quoted in either.
 *  - **`abortEarly: false`**, so a bad config reports every problem at once. Fixing one
 *    variable per restart is a miserable way to bring an environment up.
 */
import "dotenv/config";
import Joi from "joi";

const NODE_ENVS = ["development", "test", "production"] as const;
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const SAME_SITE = ["lax", "strict", "none"] as const;

interface Env {
  NODE_ENV: (typeof NODE_ENVS)[number];
  LOG_LEVEL: (typeof LOG_LEVELS)[number];
  PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_DB: string;
  DATABASE_URL?: string;
  DATABASE_SSL: boolean;
  DATABASE_LOGGING: boolean;
  DATABASE_POOL_SIZE: number;
  RUN_MIGRATIONS_ON_BOOT: boolean;
  CORS_ORIGINS: string[];
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_READS: number;
  RATE_LIMIT_MAX_WRITES: number;
  RATE_LIMIT_MAX_LOGINS: number;
  TRUST_PROXY_HOPS: number;
  SEED_PASSWORD?: string;
  COOKIE_SAME_SITE: (typeof SAME_SITE)[number];
}

const envSchema = Joi.object<Env>({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENVS)
    .required(),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .required(),
  PORT: Joi.number().integer().min(1).max(65_535).required(),

  /**
   * A full connection URL. Optional, and the one variable that changes what else is
   * required: supply it and the discrete parts below are redundant, omit it and they are
   * how the URL gets built. A hosted database usually hands you the URL and nothing else.
   */
  DATABASE_URL: Joi.string().uri(),

  POSTGRES_USER: Joi.string().when("DATABASE_URL", {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  POSTGRES_PASSWORD: Joi.string().when("DATABASE_URL", {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  POSTGRES_HOST: Joi.string().when("DATABASE_URL", {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  POSTGRES_PORT: Joi.number().integer().min(1).max(65_535).when("DATABASE_URL", {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  POSTGRES_DB: Joi.string().when("DATABASE_URL", {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),

  DATABASE_SSL: Joi.boolean().required(),
  DATABASE_LOGGING: Joi.boolean().required(),
  DATABASE_POOL_SIZE: Joi.number().integer().min(1).max(100).required(),
  /* Schema changes go through committed migrations; `synchronize` is never enabled. */
  RUN_MIGRATIONS_ON_BOOT: Joi.boolean().required(),

  /* An explicit allowlist. With `credentials: true` the browser attaches the session
   * cookie, so reflecting any origin would let any site act as the signed-in user. */
  CORS_ORIGINS: Joi.string()
    .custom((value: string) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .required(),

  RATE_LIMIT_WINDOW_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(24 * 60 * 60_000)
    .required(),
  RATE_LIMIT_MAX_READS: Joi.number().integer().min(1).max(100_000).required(),
  RATE_LIMIT_MAX_WRITES: Joi.number().integer().min(1).max(100_000).required(),
  /* Login is where brute force lives, so it gets a much tighter budget. */
  RATE_LIMIT_MAX_LOGINS: Joi.number().integer().min(1).max(100_000).required(),

  /** Number of proxies in front of the app. 0 disables `trust proxy`. */
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).required(),

  /**
   * Password given to the demo accounts by `npm run seed`. Optional because the seed is
   * the only thing that reads it: an unset value should fail the seed with a clear
   * message, not stop the whole process from booting.
   */
  SEED_PASSWORD: Joi.string(),

  COOKIE_SAME_SITE: Joi.string()
    .valid(...SAME_SITE)
    .required(),
})
  /**
   * `SameSite=none` is only honoured over HTTPS — a browser silently drops such a cookie
   * without `Secure`, which presents as "signing in does nothing". Catching it here turns
   * a baffling runtime symptom into a boot-time message.
   *
   * Checked at the object level so both keys are already validated when the rule runs,
   * rather than as a `.when()` that would depend on sibling resolution order.
   */
  .custom((value: Env, helpers) =>
    value.COOKIE_SAME_SITE === "none" && value.NODE_ENV !== "production"
      ? helpers.error("config.sameSite")
      : value,
  )
  .messages({
    "config.sameSite":
      'COOKIE_SAME_SITE: "none" requires HTTPS, so it only works with NODE_ENV=production',
  });

/**
 * A blank variable means "not set".
 *
 * `FOO=` in a `.env` file arrives as an empty string, and nobody means by that to
 * configure the empty string. Dropping blanks here means such a variable fails its
 * `required()` check with "is required" rather than passing as `""` and surfacing later
 * as an empty database name or an origin allowlist that matches nothing.
 */
const present: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value !== "string") continue;
  const trimmed = value.trim();
  if (trimmed !== "") present[key] = trimmed;
}

const result = envSchema.validate(present, {
  abortEarly: false,
  // `process.env` carries the whole shell environment; only the keys above are ours.
  stripUnknown: true,
  // Joi would otherwise quote the value into the message.
  errors: { wrap: { label: false } },
});

if (result.error) {
  // Every problem at once. The message already names the variable, so it is used as-is.
  const problems = result.error.details.map((detail) => `  - ${detail.message}`);
  throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
}

// Read after the error branch: `ValidationResult` is a union whose failure side types
// `value` as `any`, so destructuring both at once would pull that `any` through `config`
// and quietly cost every consumer its types.
const env = result.value;
const isProduction = env.NODE_ENV === "production";

/** Postgres connection URL, assembled from the discrete parts when not given directly. */
const databaseUrl =
  env.DATABASE_URL ??
  `postgres://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(
    env.POSTGRES_PASSWORD,
  )}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;

export const config = {
  env: env.NODE_ENV,
  isProduction,
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  logLevel: env.LOG_LEVEL,

  db: {
    url: databaseUrl,
    ssl: env.DATABASE_SSL,
    logging: env.DATABASE_LOGGING,
    poolSize: env.DATABASE_POOL_SIZE,
    runMigrationsOnBoot: env.RUN_MIGRATIONS_ON_BOOT,
  },

  cors: {
    origins: env.CORS_ORIGINS,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxReads: env.RATE_LIMIT_MAX_READS,
    maxWrites: env.RATE_LIMIT_MAX_WRITES,
    maxLogins: env.RATE_LIMIT_MAX_LOGINS,
  },

  trustProxyHops: env.TRUST_PROXY_HOPS,
  seedPassword: env.SEED_PASSWORD,
  cookieSameSite: env.COOKIE_SAME_SITE,
} as const;

export type AppConfig = typeof config;
