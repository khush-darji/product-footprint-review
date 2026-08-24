import { Router, type Request, type Response } from "express";
import { toUserDto } from "../mappers/footprint.mapper";
import * as userRepo from "../repositories/user.repository";

export const userRouter = Router();

/**
 * GET /api/v1/users — the directory behind the "share with…" picker.
 *
 * Readable by any authenticated user, which is appropriate for a small internal tool
 * where everyone is a colleague. In a multi-tenant product this would have to be scoped
 * to the caller's organisation — called out in the README's access-control section.
 * Note it returns DTOs: the token hash is `select: false` and the mapper never copies it.
 */
userRouter.get("/users", async (_req: Request, res: Response) => {
  const users = await userRepo.listAll();
  res.json({ items: users.map(toUserDto) });
});
