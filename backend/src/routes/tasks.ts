import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { TaskCreate, TaskPatch } from "../schemas/tasks.js";
import {
  abandonTask,
  addTaskNote,
  blockTask,
  completeTask,
  createTask,
  deleteTask,
  findSemanticDuplicate,
  getTask,
  listTaskEvents,
  listTasks,
  mergeTask,
  patchTask,
  reviveTask,
  snoozeTask,
  triageTask,
  unblockTask,
} from "../services/tasks.js";

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

  // Create with automatic dedup awareness. The client can pass
  // { skipDedup: true } to force creation (e.g. "yes, I know it looks like
  // the other one, they're different"). Otherwise, if a near-duplicate
  // exists, we return 409 with the canonical row so the UI can offer
  // "open the existing one" / "create anyway."
  app.post("/api/tasks", async (req, reply) => {
    const u = currentUser(req);
    const body = TaskCreate.extend({ skipDedup: z.boolean().optional() }).parse(req.body);
    if (!body.skipDedup) {
      const existing = await findSemanticDuplicate(u.id, body.title);
      if (existing) {
        return reply.code(409).send({
          error: "duplicate",
          duplicate: existing,
        });
      }
    }
    // Zod default fills these, but TypeScript needs the runtime guarantee.
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

  // --------------- State-machine transitions ---------------

  app.post("/api/tasks/:id/triage", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ to: z.enum(["today", "doing", "inbox"]) }).parse(req.body ?? {});
    const t = await triageTask(u.id, id, body.to);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks/:id/snooze", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ until: z.string().datetime() }).parse(req.body ?? {});
    const t = await snoozeTask(u.id, id, new Date(body.until));
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks/:id/block", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        reason: z.string().min(1).max(300),
        until: z.string().datetime().nullable().optional(),
      })
      .parse(req.body ?? {});
    const t = await blockTask(
      u.id,
      id,
      body.reason,
      body.until ? new Date(body.until) : null,
    );
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks/:id/unblock", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const t = await unblockTask(u.id, id);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks/:id/abandon", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(300) }).parse(req.body ?? {});
    const t = await abandonTask(u.id, id, body.reason);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks/:id/complete", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ outcome: z.string().max(500).optional() }).parse(req.body ?? {});
    const t = await completeTask(u.id, id, body.outcome);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks/:id/merge", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ canonicalId: z.string() }).parse(req.body ?? {});
    const t = await mergeTask(u.id, id, body.canonicalId);
    if (!t) return reply.code(404).send({ error: "not_found_or_self_merge" });
    return t;
  });

  app.post("/api/tasks/:id/revive", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const t = await reviveTask(u.id, id);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post("/api/tasks/:id/note", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ text: z.string().min(1).max(500) }).parse(req.body ?? {});
    const t = await addTaskNote(u.id, id, body.text);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.get("/api/tasks/:id/events", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const t = await getTask(u.id, id);
    if (!t) return reply.code(404).send({ error: "not_found" });
    const rows = await listTaskEvents(u.id, id);
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      kind: r.kind,
      at: r.at.toISOString(),
      payload: r.payloadJson ? JSON.parse(r.payloadJson) : null,
    }));
  });

  // Dedup check (used by the UI before submitting a new-task form).
  app.get("/api/tasks/dedup-check", async (req) => {
    const u = currentUser(req);
    const q = z.object({ title: z.string().min(1) }).parse(req.query ?? {});
    const match = await findSemanticDuplicate(u.id, q.title);
    return { match };
  });
}
