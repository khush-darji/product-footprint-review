import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { authRouter } from "./auth.routes";
import { footprintRouter } from "./footprint.routes";
import { userRouter } from "./user.routes";

/**
 * Versioned API surface. Mounting under `/api/v1` from day one means a future breaking
 * change is a new prefix rather than a coordinated frontend/backend deploy.
 */
export const apiRouter = Router();

/** Unauthenticated: describes the API without exposing any data. */
apiRouter.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "product-footprint-review-api",
    version: "v1",
    authentication: "POST /api/v1/auth/login sets an httpOnly session cookie",
    endpoints: {
      signIn: "POST /api/v1/auth/login",
      signOut: "POST /api/v1/auth/logout",
      me: "GET /api/v1/auth/me",
      listUsers: "GET /api/v1/users",
      listFootprints: "GET /api/v1/footprints",
      createFootprint: "POST /api/v1/footprints",
      footprintStats: "GET /api/v1/footprints/stats",
      getFootprint: "GET /api/v1/footprints/:id",
      updateFootprint: "PATCH /api/v1/footprints/:id",
      deleteFootprint: "DELETE /api/v1/footprints/:id",
      reviewFootprint: "POST /api/v1/footprints/:id/review",
      listReviewEvents: "GET /api/v1/footprints/:id/reviews",
      listShares: "GET /api/v1/footprints/:id/shares",
      grantShare: "POST /api/v1/footprints/:id/shares",
      revokeShare: "DELETE /api/v1/footprints/:id/shares/:userId",
    },
  });
});

/* Sign in and sign out must be reachable without a session. */
apiRouter.use("/auth", authRouter);

/*
 * Everything past this line requires a valid session cookie.
 *
 * Applying `requireAuth` to the router rather than to each handler means a new route
 * cannot be added unauthenticated by forgetting a middleware — the default is closed.
 */
apiRouter.use(requireAuth);

apiRouter.use("/", userRouter);
apiRouter.use("/footprints", footprintRouter);
