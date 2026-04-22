import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import {
  createCommitment,
  currentCommitment,
  dailyRollup,
  getCommitment,
  listCommitmentsInRange,
  markDoing,
  markDone,
  markSkipped,
  upcomingCommitments,
} from "../services/commitments.js";
import { startOfDayInTz, endOfDayInTz } from "../lib/time.js";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

const serialize = (r: {
  id: string;
  taskId: string | null;
  parentCommitmentId: string | null;
  title: string;
  verifyCriterion: string | null;
  startTime: Date;
  durationMin: number;
  state: string;
  source: string;
  escalationLevel: number;
  promptedAt: Date | null;
  ackedAt: Date | null;
  completedAt: Date | null;
  artifact: string | null;
  skipReason: string | null;
  notificationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: r.id,
  taskId: r.taskId,
  parentCommitmentId: r.parentCommitmentId,
  title: r.title,
  verifyCriterion: r.verifyCriterion,
  startTime: r.startTime.toISOString(),
  durationMin: r.durationMin,
  state: r.state,
  source: r.source,
  escalationLevel: r.escalationLevel,
  promptedAt: r.promptedAt ? r.promptedAt.toISOString() : null,
  ackedAt: r.ackedAt ? r.ackedAt.toISOString() : null,
  completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  artifact: r.artifact,
  skipReason: r.skipReason,
  notificationId: r.notificationId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function commitmentRoutes(app: FastifyInstance) {
  // Dashboard payload: the one active commitment (if any), the next few
  // upcoming ones, and a today-rollup for streak/skip display.
  app.get("/api/commitments/now", async (req) => {
    const u = currentUser(req);
    const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    const tz = userRow?.timezone ?? "America/Detroit";
    const [current, upcoming, today] = await Promise.all([
      currentCommitment(u.id),
      upcomingCommitments(u.id, 6),
      dailyRollup(u.id, startOfDayInTz(new Date(), tz), endOfDayInTz(new Date(), tz)),
    ]);
    return {
      current: current ? serialize(current) : null,
      upcoming: upcoming.map(serialize),
      today,
    };
  });

  app.get("/api/commitments", async (req) => {
    const u = currentUser(req);
    const q = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query ?? {});
    const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    const tz = userRow?.timezone ?? "America/Detroit";
    const now = new Date();
    const from = q.from ? new Date(q.from) : startOfDayInTz(now, tz);
    const to = q.to ? new Date(q.to) : new Date(+endOfDayInTz(now, tz) + 7 * 24 * 60 * 60 * 1000);
    const rows = await listCommitmentsInRange(u.id, from, to);
    return rows.map(serialize);
  });

  app.post("/api/commitments", async (req) => {
    const u = currentUser(req);
    const body = z
      .object({
        taskId: z.string().nullable().optional(),
        parentCommitmentId: z.string().nullable().optional(),
        title: z.string().min(1).max(200),
        verifyCriterion: z.string().max(300).nullable().optional(),
        startTime: z.string(),
        durationMin: z.number().int().min(5).max(180),
      })
      .parse(req.body);
    const row = await createCommitment(u.id, {
      taskId: body.taskId ?? null,
      parentCommitmentId: body.parentCommitmentId ?? null,
      title: body.title,
      verifyCriterion: body.verifyCriterion ?? null,
      startTime: new Date(body.startTime),
      durationMin: body.durationMin,
      source: "user",
    });
    return serialize(row);
  });

  app.post("/api/commitments/:id/ack", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const row = await markDoing(u.id, id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return serialize(row);
  });

  app.post("/api/commitments/:id/done", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ artifact: z.string().max(500).optional() })
      .parse(req.body ?? {});
    const row = await markDone(u.id, id, body.artifact);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return serialize(row);
  });

  app.post("/api/commitments/:id/skip", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ reason: z.string().max(300).default("") })
      .parse(req.body ?? {});
    const row = await markSkipped(u.id, id, body.reason);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return serialize(row);
  });

  app.get("/api/commitments/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const row = await getCommitment(u.id, id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return serialize(row);
  });
}
