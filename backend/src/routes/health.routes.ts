/**
 * Liveness and readiness, which answer different questions.
 *
 * `/healthz` says the process is alive and is deliberately dependency-free: if it
 * touched the database, a brief Postgres blip would make the orchestrator kill
 * perfectly healthy processes and turn a small problem into an outage.
 *
 * `/readyz` says the process can actually serve traffic, so it does check the database
 * and returns 503 when it cannot.
 */
import { Router, type Request, type Response } from "express";
import { pingDatabase } from "../db/data-source";

export const healthRouter = Router();

healthRouter.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

healthRouter.get("/readyz", async (req: Request, res: Response) => {
  try {
    await pingDatabase();
    res.json({ status: "ok", database: "up" });
  } catch (error) {
    req.log?.error({ err: error }, "readiness check failed");
    res.status(503).json({ status: "unavailable", database: "down" });
  }
});
