import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

type Row = typeof schema.notifications.$inferSelect;

// Structured action — labels are what the user sees, ops are what the
// backend dispatches when the user clicks. Keeping ops string-typed (not
// a union) lets monitor/insights emit new ops without touching the union.
export type NotificationAction = {
  label: string;
  op: string;
};

// Legacy actions were plain strings. We coerce them to {label, op:"dismiss"}
// at read time so older rows still render and behave.
function parseActions(raw: string | null | undefined): NotificationAction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a): NotificationAction | null => {
        if (typeof a === "string") return { label: a, op: "dismiss" };
        if (a && typeof a === "object" && typeof a.label === "string") {
          return { label: a.label, op: typeof a.op === "string" ? a.op : "dismiss" };
        }
        return null;
      })
      .filter((a): a is NotificationAction => a !== null);
  } catch {
    return [];
  }
}

const hydrate = (r: Row) => ({
  id: r.id,
  severity: r.severity,
  kind: r.kind,
  title: r.title,
  body: r.body,
  actions: parseActions(r.actionsJson),
  relatedType: r.relatedObjectType,
  relatedId: r.relatedObjectId,
  createdAt: r.createdAt,
  readAt: r.readAt,
  dismissedAt: r.dismissedAt,
  actedAt: r.actedAt,
  actionOp: r.actionOp,
  snoozedUntil: r.snoozedUntil,
  requiresAck: !!r.requiresAck,
});

// "Active" = not dismissed, not snoozed past now. Rows with snoozedUntil in
// the future are hidden from the UI and from dedup-against-active logic.
export async function listActiveNotifications(userId: string) {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.dismissedAt),
        or(
          isNull(schema.notifications.snoozedUntil),
          lte(schema.notifications.snoozedUntil, now),
        ),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt));
  return rows.map(hydrate);
}

// All notifications (active, dismissed, acted-on, snoozed) within a window.
// Used by the monitor to suppress re-firing the same kind/relatedId that the
// user already saw recently, even after dismissal.
export async function listRecentNotifications(userId: string, since: Date) {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        gte(schema.notifications.createdAt, since),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt));
  return rows.map(hydrate);
}

export async function dismissNotification(userId: string, id: string) {
  const now = new Date();
  await db
    .update(schema.notifications)
    .set({ dismissedAt: now, actedAt: now, actionOp: "dismiss" })
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.id, id)));
}

// Record the user's action on a notification. Snooze ops set snoozedUntil
// so the row reappears later. All other ops mark the notification as acted
// on (actedAt + actionOp), which callers can further dispatch on.
export async function recordAction(
  userId: string,
  id: string,
  op: string,
): Promise<{ snoozedUntil: Date | null; dismissed: boolean }> {
  const now = new Date();
  let snoozedUntil: Date | null = null;
  let dismissed = false;

  if (op === "snooze_1h") snoozedUntil = new Date(+now + 60 * 60 * 1000);
  else if (op === "snooze_3h") snoozedUntil = new Date(+now + 3 * 60 * 60 * 1000);
  else if (op === "snooze_rest_of_day") snoozedUntil = endOfLocalDay(now);
  else if (op === "snooze_tomorrow") snoozedUntil = startOfLocalDay(new Date(+now + 24 * 60 * 60 * 1000));
  else dismissed = true; // every non-snooze op also closes the card

  const patch: Partial<typeof schema.notifications.$inferInsert> = {
    actedAt: now,
    actionOp: op,
  };
  if (snoozedUntil) patch.snoozedUntil = snoozedUntil;
  if (dismissed) patch.dismissedAt = now;

  await db
    .update(schema.notifications)
    .set(patch)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.id, id)));

  return { snoozedUntil, dismissed };
}

export async function createNotification(
  userId: string,
  input: {
    severity: "high" | "med" | "low";
    kind: string;
    title: string;
    body: string;
    actions?: NotificationAction[] | string[];
    category?: string;
    requiresAck?: boolean;
    relatedObjectType?: string | null;
    relatedObjectId?: string | null;
  },
) {
  const id = newId("n");
  const normalized: NotificationAction[] = (input.actions ?? []).map((a) =>
    typeof a === "string" ? { label: a, op: "dismiss" } : a,
  );
  await db.insert(schema.notifications).values({
    id,
    userId,
    category: input.category ?? "proactive",
    severity: input.severity,
    kind: input.kind,
    title: input.title,
    body: input.body,
    actionsJson: JSON.stringify(normalized),
    deliveryChannel: "web",
    requiresAck: !!input.requiresAck,
    relatedObjectType: input.relatedObjectType ?? null,
    relatedObjectId: input.relatedObjectId ?? null,
    createdAt: new Date(),
  });
  return id;
}

// Flip requires_ack off (e.g. once the user has acted on the commitment,
// so the nag row stops being "sticky"). Separate from dismiss — the row
// stays visible but can now be dismissed normally.
export async function clearRequiresAck(userId: string, id: string) {
  await db
    .update(schema.notifications)
    .set({ requiresAck: false })
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.id, id)));
}

function startOfLocalDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfLocalDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}
