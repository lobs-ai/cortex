import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import type { ProjectCreateInput } from "../schemas/projects.js";

type Row = typeof schema.projects.$inferSelect;

const hydrate = (r: Row) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  color: r.color,
  status: r.status,
  targetDate: r.targetDate,
  health: r.health,
  tasksOpen: r.tasksOpen,
  tasksDone: r.tasksDone,
  lastActivity: r.lastActivity,
});

export async function listProjects(userId: string) {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId));
  return rows.map(hydrate);
}

export async function getProject(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, id)));
  return row ? hydrate(row) : null;
}

export async function createProject(userId: string, input: ProjectCreateInput) {
  const now = new Date();
  const id = newId("p");
  await db.insert(schema.projects).values({
    id,
    userId,
    name: input.name,
    description: input.description ?? null,
    color: input.color,
    status: input.status,
    targetDate: input.targetDate ?? null,
    lastActivity: now,
    createdAt: now,
    updatedAt: now,
  });
  return (await getProject(userId, id))!;
}

export async function patchProject(userId: string, id: string, input: Partial<ProjectCreateInput>) {
  const existing = await getProject(userId, id);
  if (!existing) return null;
  const now = new Date();
  await db
    .update(schema.projects)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate ?? null } : {}),
      updatedAt: now,
    })
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, id)));
  return getProject(userId, id);
}
