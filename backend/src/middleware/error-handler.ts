/**
 * The one place an error becomes a status code.
 *
 * Registered last, after every route. Anything that is not a recognised application
 * error is a bug: it gets logged in full and reported to the client as a generic 500
 * with the request id. Returning `err.message` to the client would leak table names,
 * file paths and driver internals, which is how an attacker maps a schema.
 */
import type { NextFunction, Request, Response } from "express";
import { QueryFailedError } from "typeorm";
import { config } from "../config/env";
import { AppError } from "../lib/errors";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Postgres SQLSTATEs worth translating into something a client can act on. */
const PG_ERROR_STATUS: Record<string, { status: number; code: string; message: string }> = {
  "23505": { status: 409, code: "conflict", message: "That record already exists" },
  "23503": {
    status: 409,
    code: "conflict",
    message: "That record is referenced by something else",
  },
  "23514": { status: 400, code: "validation_failed", message: "Value out of allowed range" },
  "22001": { status: 400, code: "validation_failed", message: "A value is too long" },
};

/**
 * `express.json()` rejects unparseable or oversized bodies by throwing an error that
 * carries its own status and an `expose` flag meaning "this message is safe to show".
 * Without this check a client sending `{not json` gets a 500 and no idea what it did
 * wrong, when the request never reached a route at all.
 */
interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

function asBodyParserError(err: unknown): BodyParserError | null {
  if (!(err instanceof Error)) return null;
  const candidate = err as BodyParserError;
  const status = candidate.status ?? candidate.statusCode;
  const isParserError =
    typeof candidate.type === "string" && candidate.type.startsWith("entity.");
  return isParserError && typeof status === "number" ? candidate : null;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express cannot change a response whose headers are already sent; handing it back
  // lets the default handler destroy the socket rather than throwing on top of a throw.
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = typeof req.id === "string" ? req.id : undefined;
  const log = req.log ?? console;

  /* Covers ValidationError too, which carries `code: "validation_failed"` and the
   * field-level issue list. Field detail is safe to return: it describes the client's
   * own input and says nothing about the server. */
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
        requestId,
      },
    };
    // 5xx application errors are still worth a stack trace in the logs.
    if (err.status >= 500) log.error({ err }, "application error");
    res.status(err.status).json(body);
    return;
  }

  const parserError = asBodyParserError(err);
  if (parserError) {
    const status = parserError.status ?? parserError.statusCode ?? 400;
    const tooLarge = parserError.type === "entity.too.large";
    const body: ErrorBody = {
      error: {
        code: tooLarge ? "payload_too_large" : "invalid_body",
        message: tooLarge
          ? "Request body is too large"
          : "Request body must be valid JSON",
        requestId,
      },
    };
    res.status(status).json(body);
    return;
  }

  if (err instanceof QueryFailedError) {
    const sqlState = (err as QueryFailedError & { code?: string }).code;
    const mapped = sqlState ? PG_ERROR_STATUS[sqlState] : undefined;

    // The driver message names columns and constraints, so it goes to the log only.
    log.error({ err, sqlState }, "database query failed");

    const body: ErrorBody = {
      error: {
        code: mapped?.code ?? "internal",
        message: mapped?.message ?? "Something went wrong",
        requestId,
      },
    };
    res.status(mapped?.status ?? 500).json(body);
    return;
  }

  log.error({ err }, "unhandled error");

  const body: ErrorBody = {
    error: {
      code: "internal",
      message: "Something went wrong",
      // Outside production, surface the real message — it saves a log dive in dev and
      // there is no attacker to help.
      ...(config.isProduction || !(err instanceof Error) ? {} : { details: err.message }),
      requestId,
    },
  };
  res.status(500).json(body);
}
