import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

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
  | "done"
  | "skipped"
  | "missed";

export type CommitmentRow = typeof schema.commitments.$inferSelect;

const TERMINAL: CommitmentState[] = ["done", "skipped", "missed"];

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

// "Live" = not yet resolved (pending/prompted/doing). Used by the monitor
// to scan for state transitions and by the frontend Now card.
export async function listLiveCommitments(userId: string): Promise<CommitmentRow[]> {
  return db
    .select()
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        inArray(schema.commitments.state, ["pending", "prompted", "doing"]),
      ),
    )
    .orderBy(asc(schema.commitments.startTime));
}

export async function currentCommitment(userId: string): Promise<CommitmentRow | null> {
  const live = await listLiveCommitments(userId);
  const now = Date.now();
  // Prefer "doing" over "prompted" over "pending"; within a state, earliest first.
  const rank = (s: string) => (s === "doing" ? 0 : s === "prompted" ? 1 : 2);
  const started = live
    .filter((c) => +c.startTime <= now + 60_000) // include imminent (<=1min out)
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
  if (isTerminal(row.state) || row.state === "doing") return row;
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
  // as a separate action. We just bump actualMinutes.
  if (row.taskId) {
    try {
      await db
        .update(schema.tasks)
        .set({ updatedAt: now })
        .where(and(eq(schema.tasks.id, row.taskId), eq(schema.tasks.userId, userId)));
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
): Promise<CommitmentRow | null> {
  const row = await getCommitment(userId, id);
  if (!row) return null;
  if (isTerminal(row.state)) return row;
  const now = new Date();
  await db
    .update(schema.commitments)
    .set({ state: "skipped", skipReason: reason, completedAt: now, updatedAt: now })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
  await logEvent(userId, id, "skipped", { reason });
  if (row.taskId) {
    await bumpTaskSkip(userId, row.taskId);
  }
  return (await getCommitment(userId, id))!;
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
