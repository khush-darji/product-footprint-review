/**
 * Validation at the HTTP boundary.
 *
 * A `Parser<T>` is just a function from `unknown` to a typed value that throws a
 * `ValidationError` when the input is wrong — the parsers in `src/schemas/` are all
 * plain functions, so there is no schema object to interpret here.
 *
 * The parsed result is stored on `res.locals`, not written back over `req.body`. A
 * handler that reads `req.body` instead of the validated payload therefore gets the raw,
 * unchecked value, and the mistake shows up in the types rather than silently working.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Throws `ValidationError` on bad input; returns the typed value otherwise. */
export type Parser<T> = (input: unknown) => T;

export interface ValidatedData<TBody = unknown, TQuery = unknown, TParams = unknown> {
  body: TBody;
  query: TQuery;
  params: TParams;
}

/** Reads the validated payload a `validate()` middleware put on the response. */
export function validated<TBody = unknown, TQuery = unknown, TParams = unknown>(
  res: Response,
): ValidatedData<TBody, TQuery, TParams> {
  return res.locals.validated as ValidatedData<TBody, TQuery, TParams>;
}

interface Parsers {
  body?: Parser<unknown>;
  query?: Parser<unknown>;
  params?: Parser<unknown>;
}

/**
 * Runs the given parsers over body/query/params. A thrown `ValidationError` is handed to
 * `next`, so the failure envelope is identical no matter which route rejected.
 */
export function validate(parsers: Parsers): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const current = (res.locals.validated ?? {}) as Record<string, unknown>;

      if (parsers.params) current.params = parsers.params(req.params);
      // Express 5 makes `req.query` a getter-only property, so the parsed copy is kept
      // on res.locals rather than assigned back.
      if (parsers.query) current.query = parsers.query(req.query);
      if (parsers.body) current.body = parsers.body(req.body);

      res.locals.validated = current;
      next();
    } catch (error) {
      next(error);
    }
  };
}
