/**
 * Validation at the HTTP boundary — the only place Joi runs.
 *
 * A route names a Joi schema per request part; this runs them and puts the results on
 * `res.locals.validated`. That is the whole job, and it exists so three things are true
 * everywhere rather than per handler:
 *
 *  1. **Validation happens before the handler.** A handler is only ever reached with
 *     input that already passed, so it has no failure path of its own to get wrong.
 *  2. **The handler reads the validated value, not the raw one.** The result is stored
 *     beside the request rather than written over `req.body`, so a handler that reaches
 *     for `req.body` out of habit gets the raw, unchecked value and the mistake shows up
 *     in the types instead of silently working.
 *  3. **Every rejection looks the same.** The `ValidationError` goes to `next()`, so the
 *     400 envelope is identical no matter which route or which field refused.
 *
 * The options are the interesting part, because each one is a property the API depends on:
 *
 *  - **`stripUnknown`** is what prevents mass assignment. A key no schema names is
 *    removed before the value reaches a service, so a client cannot approve its own
 *    submission by posting `{ status: "approved" }` to the create endpoint. Note it
 *    *drops* unknown keys rather than rejecting them, so a client still sending a field
 *    the API has retired keeps working — and that field still cannot reach the database.
 *  - **`abortEarly: false`** reports every problem at once, so a client fixes its request
 *    in one round trip rather than one field per attempt.
 *  - **`convert`** (Joi's default) is what lets a query string — where everything arrives
 *    as text — yield a real number and a real boolean.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
// Type-only: the schemas are built in `src/schemas/`, and validating one is a method on
// the schema itself, so nothing here needs the Joi runtime.
import type Joi from "joi";
import { ValidationError } from "../lib/errors";

const OPTIONS: Joi.ValidationOptions = {
  abortEarly: false,
  stripUnknown: true,
  convert: true,
  // Joi quotes labels as "value" by default; the schemas write messages as whole
  // sentences naming the field, so the quoting only gets in the way.
  errors: { wrap: { label: false } },
};

/**
 * Joi reports a path as segments — `["ids", 1]` — but the error envelope carries a
 * string, and a client needs to know *which* element of an array was wrong. Numbers
 * become `[1]` and names are dot-joined, so `ids[1]` and `page.size` read the way a
 * developer would write them.
 */
function formatPath(segments: readonly (string | number)[]): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc.length > 0 ? `${acc}.${segment}` : segment;
  }, "");
}

/** One Joi schema against one part of the request. Throws on the first bad part. */
function check(schema: Joi.Schema, input: unknown): unknown {
  // `ValidationResult` is a union whose failure branch types `value` as `any`, so the
  // error is checked before `value` is touched.
  const result = schema.validate(input, OPTIONS);
  if (result.error) {
    throw new ValidationError(
      "Invalid request",
      result.error.details.map((detail) => ({
        path: formatPath(detail.path),
        message: detail.message,
      })),
    );
  }
  return result.value;
}

/** The validated request, as the handler sees it. */
export interface Validated<TBody = unknown, TQuery = unknown, TParams = unknown> {
  body: TBody;
  query: TQuery;
  params: TParams;
}

/**
 * Reads what `validate()` put on the response.
 *
 * The generic names only the parts a handler actually uses, so a route that validates a
 * body writes `validated<{ body: CreateFootprintInput }>(res)` rather than counting
 * positional type arguments it does not care about.
 */
export function validated<T extends Partial<Validated>>(res: Response): T {
  return res.locals.validated as T;
}

interface Schemas {
  body?: Joi.Schema;
  query?: Joi.Schema;
  params?: Joi.Schema;
}

export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const current = (res.locals.validated ?? {}) as Record<string, unknown>;

      if (schemas.params) current.params = check(schemas.params, req.params);
      // Express 5 makes `req.query` a getter-only property, so the parsed copy is kept
      // on res.locals rather than assigned back.
      if (schemas.query) current.query = check(schemas.query, req.query);
      if (schemas.body) current.body = check(schemas.body, req.body);

      res.locals.validated = current;
      next();
    } catch (error) {
      next(error);
    }
  };
}
