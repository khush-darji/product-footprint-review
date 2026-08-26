/**
 * Sign in, sign out, and "who am I".
 *
 * These are the only endpoints reachable without a session, which is why they are
 * mounted before `requireAuth` in routes/index.ts.
 */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config/env";
import {
  currentSessionToken,
  currentUser,
  requireAuth,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../middleware/auth";
import { parse } from "../lib/validation";
import { signInSchema } from "../schemas/auth.schema";
import { signIn, signOut } from "../services/auth.service";

export const authRouter = Router();

/**
 * Login is the one endpoint where brute force is the whole attack, so it gets its own
 * much tighter budget on top of the global write limiter.
 *
 * Keyed on IP, which is the honest limit of what is available here: a per-account limit
 * would also be worth having in production, keyed on the submitted email, to stop one
 * account being sprayed from many addresses.
 */
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.maxLogins,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Failed attempts are what matter; a user signing in successfully several times is
  // not an attack.
  skipSuccessfulRequests: true,
});

/** POST /api/v1/auth/login */
authRouter.post(
  "/login",
  loginLimiter,
  async (req: Request, res: Response) => {
    const body = parse(signInSchema, req.body);
    const result = await signIn(body.email, body.password);

    res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions());
    res.json({ user: result.user, expiresAt: result.expiresAt.toISOString() });
  },
);

/**
 * POST /api/v1/auth/logout
 *
 * Deliberately does not require a valid session: signing out with an already-expired
 * cookie should clear it and succeed, not fail with a 401 the user can do nothing about.
 */
authRouter.post("/logout", async (req: Request, res: Response) => {
  const token = currentSessionToken(req);
  if (token) await signOut(token);

  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).send();
});

/** GET /api/v1/auth/me — the signed-in user, or 401. Drives the frontend's session. */
authRouter.get("/me", requireAuth, (_req: Request, res: Response) => {
  res.json(currentUser(res));
});
