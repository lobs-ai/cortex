import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

type Row = typeof schema.notifications.$inferSelect;

const hydrate = (r: Row) => ({
  id: r.id,
  severity: r.severity,
  kind: r.kind,
  title: r.title,
  body: r.body,
  actions: r.actionsJson ? (JSON.parse(r.actionsJson) as string[]) : [],
  relatedType: r.relatedObjectType,
  relatedId: r.relatedObjectId,
  createdAt: r.createdAt,
  readAt: r.readAt,
  dismissedAt: r.dismissedAt,
});

export async function listActiveNotifications(userId: string) {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.dismissedAt)))
    .orderBy(desc(schema.notifications.createdAt));
  return rows.map(hydrate);
}

export async function dismissNotification(userId: string, id: string) {
  const now = new Date();
  await db
    .update(schema.notifications)
    .set({ dismissedAt: now })
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.id, id)));
}

export async function createNotification(
  userId: string,
  input: {
    severity: "high" | "med" | "low";
    kind: string;
    title: string;
    body: string;
    actions?: string[];
    category?: string;
    relatedObjectType?: string | null;
    relatedObjectId?: string | null;
  },
) {
  const id = newId("n");
  await db.insert(schema.notifications).values({
    id,
    userId,
    category: input.category ?? "proactive",
    severity: input.severity,
    kind: input.kind,
    title: input.title,
    body: input.body,
    actionsJson: JSON.stringify(input.actions ?? []),
    deliveryChannel: "web",
    relatedObjectType: input.relatedObjectType ?? null,
    relatedObjectId: input.relatedObjectId ?? null,
    createdAt: new Date(),
  });
  return id;
}
