import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

type Row = typeof schema.recurringTasks.$inferSelect;

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function hydrate(r: Row) {
  const now = new Date();
  const completedToday = r.lastCompletedAt ? isSameLocalDay(r.lastCompletedAt, now) : false;
  return {
    id: r.id,
    title: r.title,
    project: r.projectId,
    cadence: r.cadence,
    cadenceDetail: r.cadenceDetail,
    time: r.timeOfDay,
    estMin: r.estimatedMinutes,
    priority: r.priority,
    energy: r.energyLevel,
    streak: r.streak,
    weeklyRate: r.weeklyRate,
    completedToday,
    lastCompletedAt: r.lastCompletedAt,
    paused: !!r.paused,
    managedByAi: !!r.managedByAi,
    suggestedBy: r.suggestedBy,
    note: r.note,
  };
}

export async function listRecurring(userId: string) {
  const rows = await db
    .select()
    .from(schema.recurringTasks)
    .where(eq(schema.recurringTasks.userId, userId))
    .orderBy(asc(schema.recurringTasks.timeOfDay));
  return rows.map(hydrate);
}

export async function createRecurring(
  userId: string,
  input: {
    title: string;
    projectId?: string | null;
    cadence: string;
    cadenceDetail?: string | null;
    time?: string | null;
    estMin?: number | null;
    priority?: "P0" | "P1" | "P2";
    energy?: "low" | "med" | "high";
    managedByAi?: boolean;
    suggestedBy?: string | null;
    note?: string | null;
  },
) {
  const id = newId("r");
  const now = new Date();
  await db.insert(schema.recurringTasks).values({
    id,
    userId,
    title: input.title,
    projectId: input.projectId ?? null,
    cadence: input.cadence,
    cadenceDetail: input.cadenceDetail ?? null,
    timeOfDay: input.time ?? null,
    estimatedMinutes: input.estMin ?? null,
    priority: input.priority ?? "P2",
    energyLevel: input.energy ?? "med",
    managedByAi: input.managedByAi ?? false,
    suggestedBy: input.suggestedBy ?? null,
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .select()
    .from(schema.recurringTasks)
    .where(and(eq(schema.recurringTasks.userId, userId), eq(schema.recurringTasks.id, id)));
  return hydrate(row!);
}

export async function patchRecurring(
  userId: string,
  id: string,
  input: Partial<{
    title: string;
    cadence: string;
    cadenceDetail: string | null;
    time: string | null;
    estMin: number | null;
    paused: boolean;
    priority: "P0" | "P1" | "P2";
    energy: "low" | "med" | "high";
    note: string | null;
  }>,
) {
  const updates: Partial<typeof schema.recurringTasks.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) updates.title = input.title;
  if (input.cadence !== undefined) updates.cadence = input.cadence;
  if (input.cadenceDetail !== undefined) updates.cadenceDetail = input.cadenceDetail;
  if (input.time !== undefined) updates.timeOfDay = input.time;
  if (input.estMin !== undefined) updates.estimatedMinutes = input.estMin;
  if (input.paused !== undefined) updates.paused = input.paused;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.energy !== undefined) updates.energyLevel = input.energy;
  if (input.note !== undefined) updates.note = input.note;
  await db
    .update(schema.recurringTasks)
    .set(updates)
    .where(and(eq(schema.recurringTasks.userId, userId), eq(schema.recurringTasks.id, id)));
  const [row] = await db
    .select()
    .from(schema.recurringTasks)
    .where(and(eq(schema.recurringTasks.userId, userId), eq(schema.recurringTasks.id, id)));
  return row ? hydrate(row) : null;
}

export async function deleteRecurring(userId: string, id: string) {
  await db
    .delete(schema.recurringTasks)
    .where(and(eq(schema.recurringTasks.userId, userId), eq(schema.recurringTasks.id, id)));
}

export async function toggleCompleteToday(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.recurringTasks)
    .where(and(eq(schema.recurringTasks.userId, userId), eq(schema.recurringTasks.id, id)));
  if (!row) return null;

  const now = new Date();
  const wasDoneToday = row.lastCompletedAt ? isSameLocalDay(row.lastCompletedAt, now) : false;

  const updates: Partial<typeof schema.recurringTasks.$inferInsert> = { updatedAt: now };
  if (wasDoneToday) {
    // Un-complete: bump streak down by 1 (floor 0), clear the timestamp.
    updates.streak = Math.max(0, row.streak - 1);
    updates.lastCompletedAt = null;
  } else {
    // Complete: if last completion was yesterday the streak extends, otherwise resets to 1.
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const extends_ =
      row.lastCompletedAt && isSameLocalDay(row.lastCompletedAt, yesterday);
    updates.streak = extends_ ? row.streak + 1 : 1;
    updates.lastCompletedAt = now;
  }
  await db
    .update(schema.recurringTasks)
    .set(updates)
    .where(and(eq(schema.recurringTasks.userId, userId), eq(schema.recurringTasks.id, id)));

  const [fresh] = await db
    .select()
    .from(schema.recurringTasks)
    .where(and(eq(schema.recurringTasks.userId, userId), eq(schema.recurringTasks.id, id)));
  return hydrate(fresh!);
}

export async function listSuggestions(userId: string) {
  const rows = await db
    .select()
    .from(schema.recurringSuggestions)
    .where(
      and(
        eq(schema.recurringSuggestions.userId, userId),
        isNull(schema.recurringSuggestions.dismissedAt),
      ),
    )
    .orderBy(desc(schema.recurringSuggestions.confidence));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    title: r.title,
    body: r.body,
    cadence: r.cadence,
    confidence: r.confidence,
    evidence: r.evidence,
    relatedRecurringId: r.relatedRecurringId,
  }));
}

export async function dismissSuggestion(userId: string, id: string) {
  await db
    .update(schema.recurringSuggestions)
    .set({ dismissedAt: new Date() })
    .where(and(eq(schema.recurringSuggestions.userId, userId), eq(schema.recurringSuggestions.id, id)));
}
