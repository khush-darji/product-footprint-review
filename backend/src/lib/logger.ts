/**
 * Structured logging. One JSON object per line in every environment except local
 * development, where pino-pretty makes it readable.
 *
 * The `redact` list is not optional — cookies and authorization headers in a log line
 * are credentials in a log line, and logs get shipped elsewhere. `req.headers.cookie`
 * matters more than it looks: that is where the session token lives.
 */
import pino from "pino";
import { config } from "../config/env";

/**
 * pino-pretty is a devDependency, so it is pruned out of the production image. Running
 * that image with NODE_ENV=development — which is exactly what seeding a container
 * needs — would otherwise crash on a missing module before printing anything. Falling
 * back to JSON keeps the process alive and loses nothing but colour.
 */
function prettyTransport(): pino.LoggerOptions["transport"] | undefined {
  if (config.isProduction) return undefined;
  try {
    require.resolve("pino-pretty");
  } catch {
    return undefined;
  }
  return {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
  };
}

export const logger = pino({
  level: config.isTest ? "silent" : config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.tokenHash",
      "*.secret",
    ],
    censor: "[redacted]",
  },
  base: { service: "footprint-review-api" },
  transport: prettyTransport(),
});

export type Logger = typeof logger;
