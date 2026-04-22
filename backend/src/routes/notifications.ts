import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import {
  clearRequiresAck,
  dismissNotification,
  listActiveNotifications,
  recordAction,
} from "../services/notifications.js";
import { regenerateDailyPlan } from "../services/plans.js";
import { patchTask } from "../services/tasks.js";
import { runMonitor } from "../ai/monitor.js";
import { markDoing, markDone, markSkipped } from "../services/commitments.js";
import { db, schema } from "../db/client.js";
import { and, eq } from "drizzle-orm";

// Known action ops emitted by the monitor. Ops not in this list are still
// recorded on the notification row (so the LLM can learn from the user's
// choice later) but have no side-effect handler.
const KNOWN_OPS = new Set([
  "dismiss",
  "snooze_1h",
  "snooze_3h",
  "snooze_rest_of_day",
  "snooze_tomorrow",
  "triage_overdue",
  "reserve_prep",
  "regenerate_plan",
  "reschedule_block",
  "schedule_block",
  "show_plan",
  "view_tasks",
  // Commitment loop — the "doing/done/skip" buttons on a commitment.prompt
  // card feed these back through the same notification action path so the
  // frontend and Discord pathways share wiring.
  "commit.ack",
  "commit.done",
  "commit.skip",
]);

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/api/notifications", async (req) => {
    const u = currentUser(req);
    return listActiveNotifications(u.id);
  });

  app.post("/api/notifications/:id/dismiss", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await dismissNotification(u.id, id);
    return { ok: true };
  });

  // Unified action endpoint. Records which button the user clicked on the
  // notification row (actedAt + actionOp), then dispatches side-effects for
  // known ops. Unknown ops are recorded but otherwise no-op so the frontend
  // can start emitting new ops before the backend dispatcher catches up.
  app.post("/api/notifications/:id/act", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { op, payload } = z
      .object({
        op: z.string().min(1).max(64),
        payload: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});

    const [existing] = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, u.id), eq(schema.notifications.id, id)));
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const result = await recordAction(u.id, id, op);

    // Side-effect dispatch. Keep these cheap — anything expensive should go
    // through the worker. The response echoes whatever the handler produced
    // so the frontend can route (e.g. navigate to /tasks) if needed.
    let effect: Record<string, unknown> = {};
    try {
      if (op === "regenerate_plan") {
        await regenerateDailyPlan(u.id);
        effect = { kind: "plan_regenerated" };
      } else if (op === "view_tasks") {
        effect = { kind: "navigate", to: "/tasks" };
      } else if (op === "show_plan") {
        effect = { kind: "navigate", to: "/today" };
      } else if (op === "triage_overdue") {
        effect = { kind: "navigate", to: "/tasks?filter=overdue" };
      } else if (op === "schedule_block" && existing.relatedObjectType === "task" && existing.relatedObjectId) {
        // Bump the task to "today" so the planner picks it up on next regen.
        await patchTask(u.id, existing.relatedObjectId, { status: "today" });
        await regenerateDailyPlan(u.id);
        effect = { kind: "task_queued_for_today", taskId: existing.relatedObjectId };
      } else if (op === "reserve_prep") {
        // Stub until the prep-block scheduler lands — we still log the
        // intent so the proposer can learn "user wants prep blocks".
        effect = { kind: "prep_reservation_queued" };
      } else if (op === "reschedule_block") {
        await regenerateDailyPlan(u.id);
        effect = { kind: "plan_regenerated" };
      } else if (op === "commit.ack" || op === "commit.done" || op === "commit.skip") {
        if (existing.relatedObjectType !== "commitment" || !existing.relatedObjectId) {
          effect = { kind: "handler_failed", reason: "no_commitment_link" };
        } else {
          const cid = existing.relatedObjectId;
          const artifact = typeof payload?.artifact === "string" ? payload.artifact : undefined;
          const reason = typeof payload?.reason === "string" ? payload.reason : "";
          if (op === "commit.ack") {
            const row = await markDoing(u.id, cid);
            effect = { kind: "commit_doing", commitmentId: cid, state: row?.state ?? "unknown" };
          } else if (op === "commit.done") {
            const row = await markDone(u.id, cid, artifact);
            effect = { kind: "commit_done", commitmentId: cid, state: row?.state ?? "unknown" };
          } else {
            const row = await markSkipped(u.id, cid, reason);
            effect = { kind: "commit_skipped", commitmentId: cid, state: row?.state ?? "unknown" };
            // Reslotting on skip runs out-of-band (planner) so the HTTP
            // response stays cheap. Worker picks it up on next tick.
          }
          await clearRequiresAck(u.id, id);
        }
      } else if (!KNOWN_OPS.has(op)) {
        effect = { kind: "recorded_only", reason: "unknown_op" };
      }
    } catch (err) {
      console.error(`notification action '${op}' handler failed:`, err);
      effect = { kind: "handler_failed" };
    }

    return {
      ok: true,
      op,
      snoozedUntil: result.snoozedUntil ? result.snoozedUntil.toISOString() : null,
      dismissed: result.dismissed,
      effect,
    };
  });

  app.post("/api/notifications/scan", async (req) => {
    const u = currentUser(req);
    const result = await runMonitor(u.id);
    return {
      created: result.notifications.length,
      tasksCreated: result.tasksCreated.length,
    };
  });

  app.post("/api/notifications/test-discord", async () => {
    // Discord bot integration lands in phase 2. This endpoint exists so the
    // memory/integrations panel can exercise the route without crashing.
    return { ok: true, delivered: false, reason: "discord_stub" };
  });
}
