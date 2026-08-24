import type { RequestHandler } from "express";
import { NotFoundError } from "../lib/errors";

/**
 * Catch-all for unmatched paths, registered after the routers and before the error
 * handler, so an unknown URL produces the same JSON error envelope as everything else
 * instead of Express's HTML default.
 *
 * Mounted with `app.use(...)` rather than `app.all("*", ...)`: Express 5 uses
 * path-to-regexp v8, where a bare `*` is no longer a valid path pattern.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
};
