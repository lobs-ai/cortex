import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { logTaskEvent, touchTaskActivity } from "./tasks.js";

// The commitment state machine. Every row transitions through at most:
//   pending → prompted → doing → done
//            prompted → missed
//            doing    → skipped | missed
// markDone / markSkipped / markMissed are idempotent: calling them on a
// row that is already terminal is a no-op (returns the current row).

export type CommitmentState =
  | "pending"
  | "prompted"
  | "doing"
  | "waiting"
  | "done"
  | "skipped"
  | "missed"
  | "rescheduled";

export type SkipCategory =
  | "wrong_time"
  | "too_tired"
  | "blocked"
  | "unclear"
  | "not_priority"
  | "other";

export const SKIP_CATEGORIES: SkipCategory[] = [
  "wrong_time",
  "too_tired",
  "blocked",
  "unclear",
  "not_priority",
  "other",
];

export type CommitmentRow = typeof schema.commitments.$inferSelect;

const TERMINAL: CommitmentState[] = ["done", "skipped", "missed", "rescheduled"];

type CreateInput = {
  taskId?: string | null;
  parentCommitmentId?: string | null;
  title: string;
  verifyCriterion?: string | null;
  startTime: Date;
  durationMin: number;
  source?: "user" | "planner" | "replan";
};

export async function createCommitment(userId: string, input: CreateInput): Promise<CommitmentRow> {
  const id = newId("cm");
  const now = new Date();
  await db.insert(schema.commitments).values({
    id,
    userId,
    taskId: input.taskId ?? null,
    parentCommitmentId: input.parentCommitmentId ?? null,
    title: input.title,
    verifyCriterion: input.verifyCriterion ?? null,
    startTime: input.startTime,
    durationMin: Math.max(5, Math.min(90, Math.round(input.durationMin))),
    state: "pending",
    source: input.source ?? "user",
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .select()
    .from(schema.commitments)
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  return row!;
}

export async function getCommitment(userId: string, id: string): Promise<CommitmentRow | null> {
  const [row] = await db
    .select()
    .from(schema.commitments)
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  return row ?? null;
}

export async function listCommitmentsInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<CommitmentRow[]> {
  return db
    .select()
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        gte(schema.commitments.startTime, from),
        lte(schema.commitments.startTime, to),
      ),
    )
    .orderBy(asc(schema.commitments.startTime));
}

// "Live" = not yet resolved (pending/prompted/doing/waiting). Used by the
// monitor to scan for state transitions and by the frontend Now card.
// Waiting rows are live but the monitor treats them specially (no nag).
export async function listLiveCommitments(userId: string): Promise<CommitmentRow[]> {
  return db
    .select()
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        inArray(schema.commitments.state, ["pending", "prompted", "doing", "waiting"]),
      ),
    )
    .orderBy(asc(schema.commitments.startTime));
}

export async function currentCommitment(userId: string): Promise<CommitmentRow | null> {
  const live = await listLiveCommitments(userId);
  const now = Date.now();
  // Prefer doing > prompted > waiting > pending; within a state, earliest
  // start first. Waiting rows still surface as current because the UI needs
  // to show "you're blocked on X" prominently.
  const rank = (s: string) =>
    s === "doing" ? 0 : s === "prompted" ? 1 : s === "waiting" ? 2 : 3;
  const started = live
    .filter((c) => +c.startTime <= now + 60_000 || c.state === "waiting" || c.state === "doing")
    .sort((a, b) => rank(a.state) - rank(b.state) || +a.startTime - +b.startTime);
  return started[0] ?? null;
}

export async function upcomingCommitments(userId: string, limit = 5): Promise<CommitmentRow[]> {
  const live = await listLiveCommitments(userId);
  const now = Date.now();
  return live.filter((c) => +c.startTime > now).slice(0, limit);
}

export async function logEvent(
  userId: string,
  commitmentId: string,
  kind: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.commitmentEvents).values({
    id: newId("ce"),
    userId,
    commitmentId,
    kind,
    at: new Date(),
    payloadJson: payload ? JSON.stringify(payload) : null,
  });
}

function isTerminal(state: string): boolean {
  return TERMINAL.includes(state as CommitmentState);
}

// Move pending → prompted. Called by the commitment monitor when startTime
// is reached; records the notification id so the user's reply can find the
// right row back. Idempotent.
export async function markPrompted(
  userId: string,
  id: string,
  notificationId: string,
  escalationLevel = 0,
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state) || row.state === "doing" || row.state === "waiting") return row;
  const now = new Date();
  await db
    .update(schema.commitments)
    .set({
      state: "prompted",
      promptedAt: row.promptedAt ?? now,
      notificationId,
      escalationLevel,
      updatedAt: now,
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "prompt_sent", { escalationLevel, notificationId });
  return (await getCommitment(userId, id))!;
}

export async function markDoing(userId: string, id: string): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state) || row.state === "doing") return row;
  const now = new Date();
  await db
    .update(schema.commitments)
    .set({ state: "doing", ackedAt: now, updatedAt: now })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "ack");
  if (row.taskId) await touchTaskActivity(userId, row.taskId);
  return (await getCommitment(userId, id))!;
}

export async function markDone(
  userId: string,
  id: string,
  artifact?: string,
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state)) return row;
  const now = new Date();
  await db
    .update(schema.commitments)
    .set({
      state: "done",
      completedAt: now,
      artifact: artifact ?? null,
      ackedAt: row.ackedAt ?? now,
      updatedAt: now,
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "done", artifact ? { artifact } : undefined);
  // Mark the linked task complete only if the caller explicitly wants that.
  // The planner usually emits multiple commitments per task, so a single
  // "done" is not enough to close the parent task — the UI can offer that
  // as a separate action. We just bump lastActivityAt so the gardener
  // doesn't stale a task the user is clearly working on, and log a
  // task-events row so its timeline shows the commitment resolution.
  if (row.taskId) {
    try {
      await touchTaskActivity(userId, row.taskId);
      await logTaskEvent(userId, row.taskId, "note", {
        via: "commitment",
        commitmentId: id,
        artifact: artifact ?? null,
      });
    } catch {
      // task row may be gone — not fatal
    }
  }
  return (await getCommitment(userId, id))!;
}

export async function markSkipped(
  userId: string,
  id: string,
  reason: string,
  category: SkipCategory = "other",
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state)) return row;
  const now = new Date();
  const cat = SKIP_CATEGORIES.includes(category) ? category : "other";
  await db
    .update(schema.commitments)
    .set({
      state: "skipped",
      skipReason: reason,
      skipCategory: cat,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "skipped", { reason, category: cat });
  if (row.taskId) {
    await bumpTaskSkip(userId, row.taskId);
  }
  return (await getCommitment(userId, id))!;
}

// Freeform update — records a note event without changing state. Useful when
// the user wants to log progress ("20 min in, going well") or context
// ("waiting on Sarah's reply") without committing to a done/skip.
export async function addNote(
  userId: string,
  id: string,
  text: string,
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) return row;
  await logEvent(userId, id, "note", { text: trimmed });
  // Touch updatedAt so the Now card re-sorts / re-renders.
  await db
    .update(schema.commitments)
    .set({ updatedAt: new Date() })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  return (await getCommitment(userId, id))!;
}

// Enter waiting state — commitment paused pending an external unblock.
// Monitor will not nag while waiting. If `until` is provided, monitor will
// auto-surface an "unblocked?" prompt when it passes.
export async function markWaiting(
  userId: string,
  id: string,
  waitingOn: string,
  until?: Date | null,
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state)) return row;
  const now = new Date();
  await db
    .update(schema.commitments)
    .set({
      state: "waiting",
      waitingOn: waitingOn.slice(0, 300),
      waitingUntil: until ?? null,
      updatedAt: now,
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "waiting", {
    waitingOn,
    until: until ? until.toISOString() : null,
  });
  return (await getCommitment(userId, id))!;
}

// Leave waiting state. Returns to pending so the monitor picks it up on the
// next tick — which will re-prompt immediately if startTime has passed.
export async function markUnblocked(
  userId: string,
  id: string,
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (row.state !== "waiting") return row;
  const now = new Date();
  await db
    .update(schema.commitments)
    .set({
      state: "pending",
      waitingOn: null,
      waitingUntil: null,
      promptedAt: null,
      escalationLevel: 0,
      updatedAt: now,
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "unblocked");
  return (await getCommitment(userId, id))!;
}

// Move this commitment to a new slot. Current row goes to `rescheduled`
// (terminal, does NOT bump skipCount), and a new row is created carrying
// the same task/verify/duration (or an override). Returns the replacement.
export async function rescheduleCommitment(
  userId: string,
  id: string,
  newStart: Date,
  newDurationMin?: number,
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state)) return null;
  const now = new Date();
  const duration = Math.max(5, Math.min(180, Math.round(newDurationMin ?? row.durationMin)));

  const replacement = await createCommitment(userId, {
    taskId: row.taskId,
    parentCommitmentId: row.parentCommitmentId,
    title: row.title,
    verifyCriterion: row.verifyCriterion,
    startTime: newStart,
    durationMin: duration,
    source: "replan",
  });
  await db
    .update(schema.commitments)
    .set({ replacesCommitmentId: row.id, updatedAt: now })
    .where(and(eq(schema.commitments.id, replacement.id), eq(schema.commitments.userId, userId)));

  await db
    .update(schema.commitments)
    .set({
      state: "rescheduled",
      replacedByCommitmentId: replacement.id,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "rescheduled", {
    to: newStart.toISOString(),
    durationMin: duration,
    replacementId: replacement.id,
  });
  return (await getCommitment(userId, replacement.id))!;
}

export async function listCommitmentEvents(
  userId: string,
  commitmentId: string,
): Promise<Array<typeof schema.commitmentEvents.$inferSelect>> {
  return db
    .select()
    .from(schema.commitmentEvents)
    .where(
      and(
        eq(schema.commitmentEvents.userId, userId),
        eq(schema.commitmentEvents.commitmentId, commitmentId),
      ),
    )
    .orderBy(asc(schema.commitmentEvents.at));
}

export async function markMissed(userId: string, id: string): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state)) return row;
  const now = new Date();
  await db
    .update(schema.commitments)
    .set({ state: "missed", completedAt: now, updatedAt: now })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "missed");
  if (row.taskId) {
    await bumpTaskSkip(userId, row.taskId, { markMissed: true });
  }
  return (await getCommitment(userId, id))!;
}

async function bumpTaskSkip(
  userId: string,
  taskId: string,
  opts: { markMissed?: boolean } = {},
): Promise<void> {
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
  if (!task) return;
  const now = new Date();
  await db
    .update(schema.tasks)
    .set({
      skipCount: (task.skipCount ?? 0) + 1,
      lastMissedAt: opts.markMissed ? now : task.lastMissedAt,
      updatedAt: now,
    })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
}

// Daily rollup for streak/skip display. Hits = `done` today; misses =
// `missed`+`skipped` today. Does not count future-pending rows.
export async function dailyRollup(userId: string, from: Date, to: Date) {
  const rows = await db
    .select()
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        gte(schema.commitments.startTime, from),
        lte(schema.commitments.startTime, to),
      ),
    );
  let done = 0;
  let skipped = 0;
  let missed = 0;
  for (const r of rows) {
    if (r.state === "done") done++;
    else if (r.state === "skipped") skipped++;
    else if (r.state === "missed") missed++;
  }
  return { done, skipped, missed, total: rows.length };
}

export async function recentCommitmentEvents(
  userId: string,
  since: Date,
): Promise<Array<typeof schema.commitmentEvents.$inferSelect>> {
  return db
    .select()
    .from(schema.commitmentEvents)
    .where(
      and(
        eq(schema.commitmentEvents.userId, userId),
        gte(schema.commitmentEvents.at, since),
      ),
    )
    .orderBy(desc(schema.commitmentEvents.at));
}
