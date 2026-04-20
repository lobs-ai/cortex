import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { TaskCreate, TaskPatch } from "../schemas/tasks.js";
import { createTask, deleteTask, getTask, listTasks, patchTask } from "../services/tasks.js";

export async function taskRoutes(app: FastifyInstance) {
  app.get("/api/tasks", async (req) => {
    const u = currentUser(req);
    return listTasks(u.id);
  });

  app.get("/api/tasks/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const t = await getTask(u.id, id);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks", async (req) => {
    const u = currentUser(req);
    const body = TaskCreate.parse(req.body);
    return createTask(u.id, body);
  });

  app.patch("/api/tasks/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = TaskPatch.parse(req.body);
    const t = await patchTask(u.id, id, body);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.delete("/api/tasks/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await deleteTask(u.id, id);
    return { ok: true };
  });
}
