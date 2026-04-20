import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { db, rawDb, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import type { EventCreateInput, EventPatchInput } from "../schemas/events.js";
import { getConfigField } from "./integrationConfigs.js";
import { isFeatureEnabled } from "./googleAuth.js";
import { pushEventToGoogle, deleteGoogleEvent, respondToGoogleEvent } from "./googleCalendar.js";

try { rawDb.exec("ALTER TABLE events ADD COLUMN rsvp_status TEXT"); } catch { /* column exists */ }

type Row = typeof schema.events.$inferSelect;

const hydrate = (r: Row) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  location: r.location,
  start: r.startTime,
  end: r.endTime,
  kind: r.kind,
  project: r.projectId,
  attendees: r.attendeesJson ? (JSON.parse(r.attendeesJson) as { count?: number }).count ?? null : null,
  rsvpStatus: r.rsvpStatus as "needsAction" | "accepted" | "declined" | "tentative" | null,
  important: !!r.important,
  status: r.status,
});

export async function listEvents(
  userId: string,
  range?: { from?: Date; to?: Date },
) {
  const conds = [eq(schema.events.userId, userId), ne(schema.events.status, "cancelled")];
  if (range?.from) conds.push(gte(schema.events.startTime, range.from));
  if (range?.to) conds.push(lte(schema.events.startTime, range.to));
  const rows = await db
    .select()
    .from(schema.events)
    .where(and(...conds))
    .orderBy(asc(schema.events.startTime));
  return rows.map(hydrate);
}

export async function getEvent(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), eq(schema.events.id, id)));
  return row ? hydrate(row) : null;
}

export async function createEvent(userId: string, input: EventCreateInput) {
  const now = new Date();
  const id = newId("e");
  await db.insert(schema.events).values({
    id,
    userId,
    title: input.title,
    description: input.description ?? null,
    location: input.location ?? null,
    startTime: input.startTime,
    endTime: input.endTime,
    kind: input.kind,
    projectId: input.projectId ?? null,
    important: input.important,
    createdAt: now,
    updatedAt: now,
  });

  try {
    const writeCalId = await getConfigField(userId, "google_calendar", "write_calendar_id");
    if (writeCalId && (await isFeatureEnabled(userId, "google_calendar"))) {
      const googleId = await pushEventToGoogle(userId, writeCalId, {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
      });
      if (googleId) {
        await db
          .update(schema.events)
          .set({ externalId: googleId })
          .where(eq(schema.events.id, id));
      }
    }
  } catch {
    // Never fail event creation due to Google sync issues
  }

  return (await getEvent(userId, id))!;
}

export async function patchEvent(userId: string, id: string, input: EventPatchInput) {
  const existing = await getEvent(userId, id);
  if (!existing) return null;
  const now = new Date();
  const updates: Partial<typeof schema.events.$inferInsert> = { updatedAt: now };
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.location !== undefined) updates.location = input.location;
  if (input.startTime !== undefined) updates.startTime = input.startTime;
  if (input.endTime !== undefined) updates.endTime = input.endTime;
  if (input.kind !== undefined) updates.kind = input.kind;
  if (input.projectId !== undefined) updates.projectId = input.projectId ?? null;
  if (input.important !== undefined) updates.important = input.important;

  await db
    .update(schema.events)
    .set(updates)
    .where(and(eq(schema.events.userId, userId), eq(schema.events.id, id)));

  return getEvent(userId, id);
}

export async function rsvpEvent(
  userId: string,
  id: string,
  response: "accepted" | "declined" | "tentative",
  proposedTime?: { start: Date; end: Date },
) {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), eq(schema.events.id, id)));
  if (!row) return null;

  await db
    .update(schema.events)
    .set({ rsvpStatus: response, updatedAt: new Date() })
    .where(eq(schema.events.id, id));

  if (row.externalId) {
    try {
      await respondToGoogleEvent(userId, row.externalId, response, proposedTime);
    } catch {
      // Local update succeeded; Google sync best-effort
    }
  }

  return getEvent(userId, id);
}

export async function deleteEvent(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), eq(schema.events.id, id)));

  await db
    .delete(schema.events)
    .where(and(eq(schema.events.userId, userId), eq(schema.events.id, id)));

  if (row?.externalId && !row.provider) {
    try {
      const writeCalId = await getConfigField(userId, "google_calendar", "write_calendar_id");
      if (writeCalId) await deleteGoogleEvent(userId, writeCalId, row.externalId);
    } catch {
      // Don't fail if Google delete fails
    }
  }
}
