import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { getLatestPlan, regenerateDailyPlan } from "../services/plans.js";
import { findFreeBlocks, createScheduledBlock } from "../services/scheduling.js";

export async function planRoutes(app: FastifyInstance) {
  app.get("/api/plans/today", async (req) => {
    const u = currentUser(req);
    const plan = await getLatestPlan(u.id, "daily");
    if (plan) return plan;
    return regenerateDailyPlan(u.id);
  });

  app.get("/api/plans/week", async (req, reply) => {
    const u = currentUser(req);
    const plan = await getLatestPlan(u.id, "weekly");
    if (!plan) return reply.code(204).send();
    return plan;
  });

  app.post("/api/plans/generate", async (req) => {
    const u = currentUser(req);
    const { date, guidance } = z
      .object({
        date: z.coerce.date().optional(),
        guidance: z.string().trim().max(500).optional(),
      })
      .parse(req.body ?? {});
    return regenerateDailyPlan(u.id, date ?? new Date(), { guidance });
  });

  app.post("/api/schedule/suggest", async (req) => {
    const u = currentUser(req);
    const body = z
      .object({
        date: z.coerce.date().optional(),
        minMinutes: z.number().int().positive().default(30),
      })
      .parse(req.body ?? {});
    const free = await findFreeBlocks(u.id, body.date ?? new Date(), { minMinutes: body.minMinutes });
    return free.map((b) => ({ start: b.start, end: b.end, minutes: Math.round((+b.end - +b.start) / 60000) }));
  });

  app.post("/api/schedule/apply", async (req) => {
    const u = currentUser(req);
    const body = z
      .object({
        taskId: z.string().optional(),
        eventId: z.string().optional(),
        title: z.string(),
        start: z.coerce.date(),
        end: z.coerce.date(),
        source: z.string().default("user"),
      })
      .parse(req.body);
    const id = await createScheduledBlock(u.id, body);
    return { id };
  });
}
