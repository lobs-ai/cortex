import { and, asc, eq, ne } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import type { TaskCreateInput, TaskPatchInput } from "../schemas/tasks.js";

type Row = typeof schema.tasks.$inferSelect;

const hydrate = (r: Row) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  due: r.dueDate,
  priority: r.priority,
  status: r.status,
  estMin: r.estimatedMinutes,
  actualMin: r.actualMinutes,
  project: r.projectId,
  energy: r.energyLevel,
  tags: r.tagsJson ? (JSON.parse(r.tagsJson) as string[]) : [],
  completedAt: r.completedAt,
  skipCount: r.skipCount,
  lastMissedAt: r.lastMissedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// Default: return everything, since the /api/tasks route and the UI still
// expect the full dataset. AI callers (proposer, insights, planner, chat)
// should prefer the narrower helpers below instead of pulling all rows.
export async function listTasks(userId: string, opts?: ListTasksOptions) {
  const conds = [eq(schema.tasks.userId, userId)];
  if (opts?.openOnly) conds.push(ne(schema.tasks.status, "done"));
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conds))
    .orderBy(asc(schema.tasks.dueDate));
  const all = rows.map(hydrate);
  if (opts?.includeDoneSince && !opts.openOnly) {
    return all.filter(
      (t) =>
        t.status !== "done" ||
        (t.completedAt && +t.completedAt >= +opts.includeDoneSince!),
    );
  }
  return all;
}

export type ListTasksOptions = {
  // Exclude done tasks entirely.
  openOnly?: boolean;
  // Keep open tasks plus done tasks completed on/after this timestamp.
  includeDoneSince?: Date;
};

// Compressed view of the user's task list for LLM contexts. Returns counts
// by project/priority and capped recent titles, so we don't ship hundreds of
// rows to the model when all it needs is "what's open and what was just
// completed". Callers should prefer this over `listTasks()` when the LLM is
// the consumer.
export async function summarizeTasks(
  userId: string,
  opts?: { openLimit?: number; recentDoneDays?: number; recentDoneLimit?: number },
) {
  const openLimit = opts?.openLimit ?? 25;
  const recentDoneDays = opts?.recentDoneDays ?? 14;
  const recentDoneLimit = opts?.recentDoneLimit ?? 10;
  const cutoff = new Date(Date.now() - recentDoneDays * 24 * 60 * 60 * 1000);

  const all = await listTasks(userId, { includeDoneSince: cutoff });
  const open = all.filter((t) => t.status !== "done");
  const recentDone = all
    .filter((t) => t.status === "done" && t.completedAt && +t.completedAt >= +cutoff)
    .sort((a, b) => (+(b.completedAt ?? 0)) - (+(a.completedAt ?? 0)));

  const byProject: Record<string, number> = {};
  const byPriority: Record<string, number> = { P0: 0, P1: 0, P2: 0 };
  let overdue = 0;
  let dueToday = 0;
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  for (const t of open) {
    const pid = t.project ?? "(none)";
    byProject[pid] = (byProject[pid] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    if (t.due) {
      const d = +t.due;
      if (d < now) overdue++;
      else if (d < in24h) dueToday++;
    }
  }

  return {
    totals: {
      open: open.length,
      recentlyDone: recentDone.length,
      overdue,
      dueWithin24h: dueToday,
    },
    openByProject: byProject,
    openByPriority: byPriority,
    topOpen: open.slice(0, openLimit).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due: t.due ? t.due.toISOString() : null,
      estMin: t.estMin,
      projectId: t.project,
      status: t.status,
    })),
    recentlyCompleted: recentDone.slice(0, recentDoneLimit).map((t) => ({
      title: t.title,
      completedAt: t.completedAt ? (t.completedAt as Date).toISOString() : null,
    })),
  };
}

export async function getTask(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));
  return row ? hydrate(row) : null;
}

export async function createTask(userId: string, input: TaskCreateInput) {
  const now = new Date();
  const id = newId("t");
  await db.insert(schema.tasks).values({
    id,
    userId,
    title: input.title,
    description: input.description ?? null,
    dueDate: input.dueDate ?? null,
    priority: input.priority,
    status: input.status,
    estimatedMinutes: input.estimatedMinutes ?? null,
    projectId: input.projectId ?? null,
    energyLevel: input.energyLevel,
    tagsJson: JSON.stringify(input.tags ?? []),
    createdAt: now,
    updatedAt: now,
  });
  return (await getTask(userId, id))!;
}

export async function patchTask(userId: string, id: string, input: TaskPatchInput) {
  const existing = await getTask(userId, id);
  if (!existing) return null;
  const now = new Date();
  const updates: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: now };
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.dueDate !== undefined) updates.dueDate = input.dueDate ?? null;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.status !== undefined) {
    updates.status = input.status;
    if (input.status === "done" && !existing.completedAt) updates.completedAt = now;
    if (input.status !== "done") updates.completedAt = null;
  }
  if (input.estimatedMinutes !== undefined) updates.estimatedMinutes = input.estimatedMinutes ?? null;
  if (input.projectId !== undefined) updates.projectId = input.projectId ?? null;
  if (input.energyLevel !== undefined) updates.energyLevel = input.energyLevel;
  if (input.tags !== undefined) updates.tagsJson = JSON.stringify(input.tags);

  await db
    .update(schema.tasks)
    .set(updates)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));

  return getTask(userId, id);
}

export async function deleteTask(userId: string, id: string) {
  await db
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));
}
