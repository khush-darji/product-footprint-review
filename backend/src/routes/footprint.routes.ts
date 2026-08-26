/**
 * HTTP surface for footprint submissions.
 *
 * Handlers do three things and nothing else: read the validated input, call a service
 * with the authenticated user, and choose a status code. No `try/catch`, because
 * Express 5 forwards a rejected promise from an async handler to the error middleware.
 *
 * Every route below is mounted behind `requireAuth` (see routes/index.ts), and every
 * service call is passed the caller so authorization happens against the record.
 */
import { Router, type Request, type Response } from "express";
import { currentUser } from "../middleware/auth";
import { validate, validated } from "../middleware/validate";
import {
  bulkReviewSchema,
  createFootprintSchema,
  listFootprintsQuerySchema,
  listReviewsQuerySchema,
  reviewFootprintSchema,
  updateFootprintSchema,
  uuidParamSchema,
  type BulkReviewInput,
  type CreateFootprintInput,
  type ListFootprintsQuery,
  type ListReviewsQuery,
  type ReviewFootprintInput,
  type UpdateFootprintInput,
  type UuidParam,
} from "../schemas/footprint.schema";
import {
  grantShareSchema,
  shareParamsSchema,
  type GrantShareInput,
  type ShareParams,
} from "../schemas/share.schema";
import * as footprintService from "../services/footprint.service";
import * as shareService from "../services/share.service";

export const footprintRouter = Router();

/**
 * GET /api/v1/footprints
 * ?status=&q=&category=&supplier=&highRiskOnly=&scope=&sort=&order=&limit=&cursor=
 */
footprintRouter.get(
  "/",
  validate({ query: listFootprintsQuerySchema }),
  async (_req: Request, res: Response) => {
    const { query } = validated<{ query: ListFootprintsQuery }>(res);
    const result = await footprintService.listFootprints(currentUser(res), query);

    res.json({
      items: result.items,
      total: result.total,
      pageInfo: {
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        limit: query.limit,
        sort: query.sort,
        order: query.order,
      },
    });
  },
);

/** GET /api/v1/footprints/stats — declared before `/:id` so it is not read as an id. */
footprintRouter.get("/stats", async (_req: Request, res: Response) => {
  res.json(await footprintService.getStats(currentUser(res)));
});

/** POST /api/v1/footprints — the caller owns what they create. */
footprintRouter.post(
  "/",
  validate({ body: createFootprintSchema }),
  async (_req: Request, res: Response) => {
    const { body } = validated<{ body: CreateFootprintInput }>(res);
    const created = await footprintService.createFootprint(currentUser(res), body);
    res.status(201).location(`/api/v1/footprints/${created.id}`).json(created);
  },
);

/**
 * POST /api/v1/footprints/bulk-review — decide several submissions at once.
 *
 * Declared before `/:id/...` so the literal segment is matched as itself, for the same
 * reason `/stats` is above. 200 even when some ids failed: the response body reports
 * each one, because "twelve approved, two already decided" is not an error — it is the
 * answer. Only a request that is wrong as a whole (bad decision, non-UUID id, over the
 * cap) is a 400.
 */
footprintRouter.post(
  "/bulk-review",
  validate({ body: bulkReviewSchema }),
  async (_req: Request, res: Response) => {
    const { body } = validated<{ body: BulkReviewInput }>(res);
    res.json(await footprintService.bulkReview(currentUser(res), body));
  },
);

/** GET /api/v1/footprints/:id — 404 if not owned by or shared with the caller. */
footprintRouter.get(
  "/:id",
  validate({ params: uuidParamSchema }),
  async (_req: Request, res: Response) => {
    const { params } = validated<{ params: UuidParam }>(res);
    res.json(await footprintService.getFootprint(currentUser(res), params.id));
  },
);

/** PATCH /api/v1/footprints/:id — owner or editor, while still pending. */
footprintRouter.patch(
  "/:id",
  validate({ params: uuidParamSchema, body: updateFootprintSchema }),
  async (_req: Request, res: Response) => {
    const { params, body } = validated<{ body: UpdateFootprintInput; params: UuidParam }>(res);
    res.json(await footprintService.updateFootprint(currentUser(res), params.id, body));
  },
);

/** DELETE /api/v1/footprints/:id — owner only. 204, cascades to shares and timeline. */
footprintRouter.delete(
  "/:id",
  validate({ params: uuidParamSchema }),
  async (_req: Request, res: Response) => {
    const { params } = validated<{ params: UuidParam }>(res);
    await footprintService.deleteFootprint(currentUser(res), params.id);
    res.status(204).send();
  },
);

/** POST /api/v1/footprints/:id/review — owner or editor. Viewers get 403. */
footprintRouter.post(
  "/:id/review",
  validate({ params: uuidParamSchema, body: reviewFootprintSchema }),
  async (_req: Request, res: Response) => {
    const { params, body } = validated<{ body: ReviewFootprintInput; params: UuidParam }>(res);
    res.json(await footprintService.reviewFootprint(currentUser(res), params.id, body));
  },
);

/** GET /api/v1/footprints/:id/reviews — the decision timeline. Any role may read it. */
footprintRouter.get(
  "/:id/reviews",
  validate({ params: uuidParamSchema, query: listReviewsQuerySchema }),
  async (_req: Request, res: Response) => {
    const { params, query } = validated<{ query: ListReviewsQuery; params: UuidParam }>(res);
    res.json({
      items: await footprintService.listReviewEvents(currentUser(res), params.id, query),
    });
  },
);

/* --- Sharing. All three are owner-only; see domain/access.ts for the full model. --- */

/** GET /api/v1/footprints/:id/shares — who this submission is shared with. */
footprintRouter.get(
  "/:id/shares",
  validate({ params: uuidParamSchema }),
  async (_req: Request, res: Response) => {
    const { params } = validated<{ params: UuidParam }>(res);
    res.json({ items: await shareService.listShares(currentUser(res), params.id) });
  },
);

/** POST /api/v1/footprints/:id/shares — grant, or change an existing grant's role. */
footprintRouter.post(
  "/:id/shares",
  validate({ params: uuidParamSchema, body: grantShareSchema }),
  async (_req: Request, res: Response) => {
    const { params, body } = validated<{ body: GrantShareInput; params: UuidParam }>(res);
    const share = await shareService.grantShare(currentUser(res), params.id, body);
    res.status(201).json(share);
  },
);

/** DELETE /api/v1/footprints/:id/shares/:userId — revoke one person's access. */
footprintRouter.delete(
  "/:id/shares/:userId",
  validate({ params: shareParamsSchema }),
  async (_req: Request, res: Response) => {
    const { params } = validated<{ params: ShareParams }>(res);
    await shareService.revokeShare(currentUser(res), params.id, params.userId);
    res.status(204).send();
  },
);
