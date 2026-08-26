/**
 * HTTP surface for footprint submissions.
 *
 * Handlers do three things and nothing else: parse the request against a schema, call a
 * service with the authenticated user, and choose a status code. No `try/catch` — `parse`
 * throws on bad input and Express 5 forwards a rejected async handler to the error
 * middleware, so every rejection comes back in the same 400 envelope.
 *
 * Parsing is the first statement in every handler, and the parsed value is what the rest
 * of the handler uses. `req.body` and `req.query` are the raw, unchecked input and are
 * deliberately never read past that line.
 *
 * Every route below is mounted behind `requireAuth` (see routes/index.ts), and every
 * service call is passed the caller so authorization happens against the record.
 */
import { Router, type Request, type Response } from "express";
import { parse } from "../lib/validation";
import { currentUser } from "../middleware/auth";
import {
  bulkReviewSchema,
  createFootprintSchema,
  listFootprintsQuerySchema,
  listReviewsQuerySchema,
  reviewFootprintSchema,
  updateFootprintSchema,
  uuidParamSchema,
} from "../schemas/footprint.schema";
import { grantShareSchema, shareParamsSchema } from "../schemas/share.schema";
import * as footprintService from "../services/footprint.service";
import * as shareService from "../services/share.service";

export const footprintRouter = Router();

/**
 * GET /api/v1/footprints
 * ?status=&q=&category=&supplier=&highRiskOnly=&scope=&sort=&order=&limit=&cursor=
 */
footprintRouter.get("/", async (req: Request, res: Response) => {
  const query = parse(listFootprintsQuerySchema, req.query);
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
});

/** GET /api/v1/footprints/stats — declared before `/:id` so it is not read as an id. */
footprintRouter.get("/stats", async (_req: Request, res: Response) => {
  res.json(await footprintService.getStats(currentUser(res)));
});

/** POST /api/v1/footprints — the caller owns what they create. */
footprintRouter.post("/", async (req: Request, res: Response) => {
  const body = parse(createFootprintSchema, req.body);
  const created = await footprintService.createFootprint(currentUser(res), body);
  res.status(201).location(`/api/v1/footprints/${created.id}`).json(created);
});

/**
 * POST /api/v1/footprints/bulk-review — decide several submissions at once.
 *
 * Declared before `/:id/...` so the literal segment is matched as itself, for the same
 * reason `/stats` is above. 200 even when some ids failed: the response body reports
 * each one, because "twelve approved, two already decided" is not an error — it is the
 * answer. Only a request that is wrong as a whole (bad decision, non-UUID id, over the
 * cap) is a 400.
 */
footprintRouter.post("/bulk-review", async (req: Request, res: Response) => {
  const body = parse(bulkReviewSchema, req.body);
  res.json(await footprintService.bulkReview(currentUser(res), body));
});

/** GET /api/v1/footprints/:id — 404 if not owned by or shared with the caller. */
footprintRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json(await footprintService.getFootprint(currentUser(res), id));
});

/** PATCH /api/v1/footprints/:id — owner or editor, while still pending. */
footprintRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = parse(uuidParamSchema, req.params);
  const body = parse(updateFootprintSchema, req.body);
  res.json(await footprintService.updateFootprint(currentUser(res), id, body));
});

/** DELETE /api/v1/footprints/:id — owner only. 204, cascades to shares and timeline. */
footprintRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = parse(uuidParamSchema, req.params);
  await footprintService.deleteFootprint(currentUser(res), id);
  res.status(204).send();
});

/** POST /api/v1/footprints/:id/review — owner or editor. Viewers get 403. */
footprintRouter.post("/:id/review", async (req: Request, res: Response) => {
  const { id } = parse(uuidParamSchema, req.params);
  const body = parse(reviewFootprintSchema, req.body);
  res.json(await footprintService.reviewFootprint(currentUser(res), id, body));
});

/** GET /api/v1/footprints/:id/reviews — the decision timeline. Any role may read it. */
footprintRouter.get("/:id/reviews", async (req: Request, res: Response) => {
  const { id } = parse(uuidParamSchema, req.params);
  const query = parse(listReviewsQuerySchema, req.query);
  res.json({
    items: await footprintService.listReviewEvents(currentUser(res), id, query),
  });
});

/* --- Sharing. All three are owner-only; see domain/access.ts for the full model. --- */

/** GET /api/v1/footprints/:id/shares — who this submission is shared with. */
footprintRouter.get("/:id/shares", async (req: Request, res: Response) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ items: await shareService.listShares(currentUser(res), id) });
});

/** POST /api/v1/footprints/:id/shares — grant, or change an existing grant's role. */
footprintRouter.post("/:id/shares", async (req: Request, res: Response) => {
  const { id } = parse(uuidParamSchema, req.params);
  const body = parse(grantShareSchema, req.body);
  const share = await shareService.grantShare(currentUser(res), id, body);
  res.status(201).json(share);
});

/** DELETE /api/v1/footprints/:id/shares/:userId — revoke one person's access. */
footprintRouter.delete("/:id/shares/:userId", async (req: Request, res: Response) => {
  const { id, userId } = parse(shareParamsSchema, req.params);
  await shareService.revokeShare(currentUser(res), id, userId);
  res.status(204).send();
});
