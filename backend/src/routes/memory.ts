import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import {
  deleteMemoryItem,
  listPreferences,
  listTendencies,
  patchTendency,
} from "../services/memory.js";

export async function memoryRoutes(app: FastifyInstance) {
  app.get("/api/memory/preferences", async (req) => {
    const u = currentUser(req);
    return listPreferences(u.id);
  });

  app.get("/api/memory/tendencies", async (req) => {
    const u = currentUser(req);
    return listTendencies(u.id);
  });

  app.patch("/api/memory/tendencies/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ status: z.string().optional(), text: z.string().optional() })
      .parse(req.body);
    await patchTendency(u.id, id, body);
    return { ok: true };
  });

  app.delete("/api/memory/items/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await deleteMemoryItem(u.id, id);
    return { ok: true };
  });

}
