import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import {
  createEntry,
  deleteEntry,
  findNearestEvent,
  getEntry,
  listEntries,
  patchEntry,
} from "../services/journal.js";

const KindEnum = z.enum(["reflection", "quick_log"]);

const ListQ = z.object({
  eventId: z.string().optional(),
  kind: KindEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  unattached: z.enum(["true", "false"]).optional(),
});

const CreateBody = z.object({
  kind: KindEnum,
  eventId: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().optional(),
});

const PatchBody = z.object({
  eventId: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().optional(),
});

export async function journalRoutes(app: FastifyInstance) {
  app.get("/api/journal", async (req) => {
    const u = currentUser(req);
    const q = ListQ.parse(req.query);
    const eventId = q.unattached === "true" ? null : q.eventId;
    return listEntries(u.id, { eventId, kind: q.kind, from: q.from, to: q.to, limit: q.limit });
  });

  app.get("/api/journal/nearest-event", async (req) => {
    const u = currentUser(req);
    const q = z
      .object({ at: z.coerce.date().optional(), windowMinutes: z.coerce.number().int().positive().optional() })
      .parse(req.query);
    return findNearestEvent(u.id, q.at ?? new Date(), q.windowMinutes ?? 120);
  });

  app.post("/api/journal", async (req) => {
    const u = currentUser(req);
    const body = CreateBody.parse(req.body);
    return createEntry(u.id, body);
  });

  app.get("/api/journal/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const e = await getEntry(u.id, id);
    if (!e) return reply.code(404).send({ error: "not_found" });
    return e;
  });

  app.patch("/api/journal/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = PatchBody.parse(req.body);
    const e = await patchEntry(u.id, id, body);
    if (!e) return reply.code(404).send({ error: "not_found" });
    return e;
  });

  app.delete("/api/journal/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await deleteEntry(u.id, id);
    return { ok: true };
  });
}
