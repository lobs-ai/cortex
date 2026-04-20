import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import {
  createRecurring,
  deleteRecurring,
  dismissSuggestion,
  listRecurring,
  listSuggestions,
  patchRecurring,
  toggleCompleteToday,
} from "../services/recurring.js";

const CreateBody = z.object({
  title: z.string().min(1),
  projectId: z.string().nullable().optional(),
  cadence: z.string().min(1),
  cadenceDetail: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  estMin: z.number().int().positive().nullable().optional(),
  priority: z.enum(["P0", "P1", "P2"]).optional(),
  energy: z.enum(["low", "med", "high"]).optional(),
  managedByAi: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

const PatchBody = CreateBody.partial().extend({ paused: z.boolean().optional() });

export async function recurringRoutes(app: FastifyInstance) {
  app.get("/api/recurring", async (req) => {
    const u = currentUser(req);
    return listRecurring(u.id);
  });

  app.post("/api/recurring", async (req) => {
    const u = currentUser(req);
    const body = CreateBody.parse(req.body);
    return createRecurring(u.id, body);
  });

  app.patch("/api/recurring/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = PatchBody.parse(req.body);
    const row = await patchRecurring(u.id, id, body);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.delete("/api/recurring/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await deleteRecurring(u.id, id);
    return { ok: true };
  });

  app.post("/api/recurring/:id/toggle", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const row = await toggleCompleteToday(u.id, id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.get("/api/recurring/suggestions", async (req) => {
    const u = currentUser(req);
    return listSuggestions(u.id);
  });

  app.post("/api/recurring/suggestions/:id/dismiss", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await dismissSuggestion(u.id, id);
    return { ok: true };
  });
}
