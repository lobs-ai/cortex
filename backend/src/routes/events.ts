import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { EventCreate, EventPatch } from "../schemas/events.js";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  patchEvent,
} from "../services/events.js";

const RangeQ = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function eventRoutes(app: FastifyInstance) {
  app.get("/api/events", async (req) => {
    const u = currentUser(req);
    const q = RangeQ.parse(req.query);
    return listEvents(u.id, q);
  });

  app.get("/api/events/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const e = await getEvent(u.id, id);
    if (!e) return reply.code(404).send({ error: "not_found" });
    return e;
  });

  app.post("/api/events", async (req) => {
    const u = currentUser(req);
    const body = EventCreate.parse(req.body);
    return createEvent(u.id, body);
  });

  app.patch("/api/events/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = EventPatch.parse(req.body);
    const e = await patchEvent(u.id, id, body);
    if (!e) return reply.code(404).send({ error: "not_found" });
    return e;
  });

  app.delete("/api/events/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await deleteEvent(u.id, id);
    return { ok: true };
  });

  app.post("/api/calendar/sync", async () => {
    // Google Calendar sync lands in phase 2. The stub simply reports "ok"
    // so the UI's Sync button doesn't fail.
    return { ok: true, synced: 0, stub: true };
  });
}
