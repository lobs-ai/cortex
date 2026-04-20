import { and, asc, eq } from "drizzle-orm";
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
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export async function listTasks(userId: string) {
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.userId, userId))
    .orderBy(asc(schema.tasks.dueDate));
  return rows.map(hydrate);
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
