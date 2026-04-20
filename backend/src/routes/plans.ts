import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { getLatestPlan } from "../services/plans.js";
import { generateDailyPlan } from "../ai/planner.js";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { findFreeBlocks, createScheduledBlock } from "../services/scheduling.js";

export async function planRoutes(app: FastifyInstance) {
  app.get("/api/plans/today", async (req) => {
    const u = currentUser(req);
    const plan = await getLatestPlan(u.id, "daily");
    if (plan) return plan;
    const fresh = await generateDailyPlan(u.id, new Date());
    return persist(u.id, "daily", fresh);
  });

  app.get("/api/plans/week", async (req, reply) => {
    const u = currentUser(req);
    const plan = await getLatestPlan(u.id, "weekly");
    if (!plan) return reply.code(204).send();
    return plan;
  });

  app.post("/api/plans/generate", async (req) => {
    const u = currentUser(req);
    const { date } = z.object({ date: z.coerce.date().optional() }).parse(req.body ?? {});
    const d = date ?? new Date();
    const fresh = await generateDailyPlan(u.id, d);
    return persist(u.id, "daily", fresh);
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

async function persist(userId: string, type: "daily" | "weekly", fresh: Awaited<ReturnType<typeof generateDailyPlan>>) {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  const id = newId("plan");
  await db.insert(schema.plans).values({
    id,
    userId,
    planType: type,
    periodStart: today,
    periodEnd: end,
    contentJson: JSON.stringify({ ...fresh, generatedAt: now.toISOString() }),
    generatedBy: fresh.generatedBy,
    createdAt: now,
  });
  return {
    id,
    type,
    periodStart: today,
    periodEnd: end,
    content: { ...fresh, generatedAt: now.toISOString() },
    generatedBy: fresh.generatedBy,
    createdAt: now,
  };
}
