/**
 * Request id + per-request child logger.
 *
 * One id threads through the access log line, every log line the handler writes, and the
 * error response body — so a user reporting "it failed, id abc123" is a two-second log
 * search rather than an afternoon.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestHandler } from "express";
import pinoHttp from "pino-http";
import { logger } from "../lib/logger";

export const REQUEST_ID_HEADER = "x-request-id";

/** Bounded and stripped: an inbound id is user input and ends up in every log line. */
function safeIncomingId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 64);
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

export const requestContext: RequestHandler = pinoHttp({
  logger,
  genReqId(req, res) {
    const id = safeIncomingId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
  /* Health probes are called every few seconds by the orchestrator; logging them at
   * info level buries everything else. */
  autoLogging: {
    ignore: (req) => req.url === "/healthz" || req.url === "/readyz",
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    // Never log the request body — it is where passwords and card numbers live — and
    // never log full headers, which carry credentials.
    req: (req: IncomingMessage & { id?: unknown }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
  },
});
