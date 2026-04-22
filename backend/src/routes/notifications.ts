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
import {
  SKIP_CATEGORIES,
  addNote as addCommitNote,
  markDoing,
  markDone,
  markSkipped,
  markUnblocked,
  markWaiting,
  rescheduleCommitment,
  type SkipCategory,
} from "../services/commitments.js";
import {
  abandonTask,
  findSemanticDuplicate,
  mergeTask,
  snoozeTask,
  unblockTask,
} from "../services/tasks.js";
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
  "commit.note",
  "commit.wait",
  "commit.unblock",
  "commit.reschedule",
  // Task state-machine ops — emitted from gardener proposal cards. The
  // handler looks up the related task via relatedObjectId and dispatches
  // into the tasks service.
  "task.unblock",
  "task.abandon_open",
  "task.keep",
  "task.snooze_1w",
  "task.merge_into_canonical",
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
      } else if (op.startsWith("commit.")) {
        if (existing.relatedObjectType !== "commitment" || !existing.relatedObjectId) {
          effect = { kind: "handler_failed", reason: "no_commitment_link" };
        } else {
          const cid = existing.relatedObjectId;
          const artifact = typeof payload?.artifact === "string" ? payload.artifact : undefined;
          const reason = typeof payload?.reason === "string" ? payload.reason : "";
          const category = (
            typeof payload?.category === "string" &&
            (SKIP_CATEGORIES as readonly string[]).includes(payload.category)
              ? payload.category
              : "other"
          ) as SkipCategory;
          const text = typeof payload?.text === "string" ? payload.text : "";
          const waitingOn = typeof payload?.waitingOn === "string" ? payload.waitingOn : "";
          const until = typeof payload?.until === "string" ? new Date(payload.until) : null;
          const startTime =
            typeof payload?.startTime === "string" ? new Date(payload.startTime) : null;
          const durationMin =
            typeof payload?.durationMin === "number" ? payload.durationMin : undefined;

          if (op === "commit.ack") {
            const row = await markDoing(u.id, cid);
            effect = { kind: "commit_doing", commitmentId: cid, state: row?.state ?? "unknown" };
          } else if (op === "commit.done") {
            const row = await markDone(u.id, cid, artifact);
            effect = { kind: "commit_done", commitmentId: cid, state: row?.state ?? "unknown" };
          } else if (op === "commit.skip") {
            const row = await markSkipped(u.id, cid, reason, category);
            effect = { kind: "commit_skipped", commitmentId: cid, state: row?.state ?? "unknown" };
          } else if (op === "commit.note") {
            const row = await addCommitNote(u.id, cid, text);
            effect = { kind: "commit_noted", commitmentId: cid, state: row?.state ?? "unknown" };
          } else if (op === "commit.wait") {
            const row = await markWaiting(u.id, cid, waitingOn || "external", until);
            effect = { kind: "commit_waiting", commitmentId: cid, state: row?.state ?? "unknown" };
          } else if (op === "commit.unblock") {
            const row = await markUnblocked(u.id, cid);
            effect = { kind: "commit_unblocked", commitmentId: cid, state: row?.state ?? "unknown" };
          } else if (op === "commit.reschedule") {
            if (!startTime) {
              effect = { kind: "handler_failed", reason: "missing_startTime" };
            } else {
              const row = await rescheduleCommitment(u.id, cid, startTime, durationMin);
              effect = {
                kind: "commit_rescheduled",
                commitmentId: cid,
                newCommitmentId: row?.id ?? null,
                state: row?.state ?? "unknown",
              };
            }
          }
          // Notes and waits shouldn't clear the ack requirement — the user
          // may still need to respond to the original prompt. All other
          // commit.* ops close the nag.
          if (op !== "commit.note" && op !== "commit.wait") {
            await clearRequiresAck(u.id, id);
          }
        }
      } else if (op.startsWith("task.")) {
        if (existing.relatedObjectType !== "task" || !existing.relatedObjectId) {
          effect = { kind: "handler_failed", reason: "no_task_link" };
        } else {
          const tid = existing.relatedObjectId;
          const reason = typeof payload?.reason === "string" ? payload.reason : "";
          if (op === "task.unblock") {
            const t = await unblockTask(u.id, tid);
            effect = { kind: "task_unblocked", taskId: tid, state: t?.status ?? "unknown" };
          } else if (op === "task.keep") {
            // "Keep it" on a stale/dup card: surface it back for the user
            // to triage manually. No automatic state change beyond clearing
            // the stale flag so the gardener doesn't re-propose tomorrow.
            // The tasks route's revive endpoint handles that cleanly.
            effect = { kind: "task_kept", taskId: tid };
          } else if (op === "task.snooze_1w") {
            const until = new Date(Date.now() + 7 * 86400 * 1000);
            const t = await snoozeTask(u.id, tid, until);
            effect = { kind: "task_snoozed", taskId: tid, state: t?.status ?? "unknown" };
          } else if (op === "task.abandon_open") {
            // Open the abandon sheet in the UI — the frontend will prompt
            // for a reason and then POST /api/tasks/:id/abandon directly.
            effect = { kind: "navigate_abandon", taskId: tid };
          } else if (op === "task.merge_into_canonical") {
            // Look the canonical up fresh rather than trusting a stashed
            // pointer; the world may have moved on between proposal and
            // acceptance.
            const [existingTask] = await db
              .select()
              .from(schema.tasks)
              .where(
                and(
                  eq(schema.tasks.userId, u.id),
                  eq(schema.tasks.id, tid),
                ),
              );
            if (!existingTask) {
              effect = { kind: "handler_failed", reason: "task_gone" };
            } else {
              const match = await findSemanticDuplicate(u.id, existingTask.title, { ignoreId: tid });
              if (!match) {
                effect = { kind: "handler_failed", reason: "no_current_duplicate" };
              } else {
                const t = await mergeTask(u.id, tid, match.id);
                effect = {
                  kind: "task_merged",
                  taskId: tid,
                  canonicalId: match.id,
                  state: t?.status ?? "unknown",
                  reason,
                };
              }
            }
          }
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
