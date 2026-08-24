/**
 * Express wiring only. No `listen` here — keeping the app separate from the server is
 * what lets tests drive it with supertest without binding a port.
 *
 * Middleware order is deliberate and load-bearing:
 *   request id -> security headers -> CORS -> body parsing -> rate limits -> routes
 *   -> 404 -> error handler.
 */
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config/env";
import { ForbiddenError } from "./lib/errors";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { requestContext } from "./middleware/request-context";
import { healthRouter } from "./routes/health.routes";
import { apiRouter } from "./routes";

export function createApp(): Express {
  const app = express();

  /* Rate limiting keys on the client IP. Behind a proxy every request appears to come
   * from the load balancer, so the limit would apply to all users at once — but
   * trusting a proxy that is not there lets a client spoof its IP with
   * X-Forwarded-For. Hence a count, from config, defaulting to none. */
  app.set("trust proxy", config.trustProxyHops === 0 ? false : config.trustProxyHops);
  app.disable("x-powered-by");

  app.use(requestContext);

  app.use(
    helmet({
      // This service serves JSON to a separate frontend origin, never HTML, so the
      // browser-page protections are off and the transport ones stay on.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      /* An explicit allowlist. This matters more now than it did with bearer tokens:
       * `credentials: true` lets the browser attach the session cookie, so reflecting
       * any origin would let any site make authenticated requests as the signed-in
       * user. The allowlist is the thing standing between those two facts. */
      origin(origin, callback) {
        // No Origin header: same-origin, curl, or a server-side call. Not a browser
        // cross-origin request, so there is nothing for CORS to protect against.
        if (!origin) return callback(null, true);
        if (config.cors.origins.includes(origin)) return callback(null, true);
        return callback(new ForbiddenError(`Origin not allowed: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 86_400,
    }),
  );

  // Bounded: an unbounded body is a denial of service that needs no exploit.
  app.use(express.json({ limit: "100kb" }));

  // The session travels in an httpOnly cookie, so it has to be parsed before requireAuth.
  app.use(cookieParser());

  // Health checks sit above the rate limiter — throttling an orchestrator's probes is
  // how a busy service gets restarted for being busy.
  app.use(healthRouter);

  const readLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.maxReads,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  // Writes are cheaper to abuse and more expensive to absorb, so they get their own,
  // tighter budget on top of the read one.
  const writeLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.maxWrites,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  app.use("/api", readLimiter);
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    return writeLimiter(req, res, next);
  });

  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
