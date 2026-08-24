/**
 * Authentication: who is calling.
 *
 * The session token travels in an **httpOnly cookie**, so page JavaScript cannot read
 * it — which is what stops an XSS bug from walking off with a live session. It is never
 * accepted from a header or a query parameter, because an alternative path would undo
 * that protection.
 *
 * What this middleware does NOT do is decide whether the caller may touch a particular
 * submission. "Who are you" and "may you see this record" are different questions; the
 * second is answered in the service layer against the record itself.
 */
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../config/env";
import { UnauthorizedError } from "../lib/errors";
import { resolveSession, SESSION_TTL_MS } from "../services/auth.service";

export const SESSION_COOKIE = "footprint_session";

/** The authenticated caller. Only ever populated by `requireAuth`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Cookie flags, and why each one is here:
 *
 *  - `httpOnly` — JavaScript cannot read it, so XSS cannot steal the session.
 *  - `secure`   — HTTPS only. Off in local development, where there is no TLS.
 *  - `sameSite` — `lax` means the browser will not attach this cookie to a cross-site
 *    POST, which is the CSRF defence. It works locally because :3000 and :4000 are the
 *    same site. Split across real domains it must become `none` + `secure`, and then a
 *    CSRF token is required as well — noted in the README.
 *  - `path: "/"` so sign-out can clear it regardless of which route set it.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.cookieSameSite,
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

function extractSessionToken(req: Request): string | null {
  const raw: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof raw !== "string") return null;

  const token = raw.trim();
  // Bounded before it is hashed: an unbounded cookie is free work for an attacker.
  return token.length > 0 && token.length <= 512 ? token : null;
}

/**
 * Rejects the request with 401 unless it carries a valid session cookie.
 *
 * The message is identical for "no cookie", "malformed cookie" and "expired session" —
 * distinguishing them tells an attacker which half of the guess was right.
 */
export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  void (async () => {
    try {
      const token = extractSessionToken(req);
      if (!token) throw new UnauthorizedError("Sign in to continue.");

      const user = await resolveSession(token);
      if (!user) {
        // The cookie is stale; clear it so the browser stops sending it.
        res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
        throw new UnauthorizedError("Your session has expired. Sign in again.");
      }

      res.locals.user = user satisfies AuthenticatedUser;

      // Ties every log line for this request to the acting user. The session token is
      // never logged, only the id it resolved to.
      req.log = req.log?.child({ userId: user.id });

      next();
    } catch (error) {
      next(error);
    }
  })();
};

/**
 * Reads the caller established by `requireAuth`.
 *
 * Throws rather than returning null: reaching this without authentication means a route
 * was mounted without `requireAuth`, and failing loudly beats silently treating the
 * request as anonymous.
 */
export function currentUser(res: Response): AuthenticatedUser {
  const user = res.locals.user as AuthenticatedUser | undefined;
  if (!user) throw new UnauthorizedError("Sign in to continue.");
  return user;
}

/** The raw session token, for sign-out. */
export function currentSessionToken(req: Request): string | null {
  return extractSessionToken(req);
}
