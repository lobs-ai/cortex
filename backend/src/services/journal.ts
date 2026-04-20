import { and, asc, desc, eq, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

type Row = typeof schema.journalEntries.$inferSelect;

export type JournalKind = "reflection" | "quick_log";

const hydrate = (r: Row) => ({
  id: r.id,
  eventId: r.eventId,
  kind: r.kind as JournalKind,
  rating: r.rating,
  note: r.note,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export type JournalEntry = ReturnType<typeof hydrate>;

export async function listEntries(
  userId: string,
  filters?: { eventId?: string | null; kind?: JournalKind; from?: Date; to?: Date; limit?: number },
) {
  const conds = [eq(schema.journalEntries.userId, userId)];
  if (filters?.eventId === null) conds.push(isNull(schema.journalEntries.eventId));
  else if (typeof filters?.eventId === "string") conds.push(eq(schema.journalEntries.eventId, filters.eventId));
  if (filters?.kind) conds.push(eq(schema.journalEntries.kind, filters.kind));
  if (filters?.from) conds.push(gte(schema.journalEntries.createdAt, filters.from));
  if (filters?.to) conds.push(lte(schema.journalEntries.createdAt, filters.to));

  const q = db
    .select()
    .from(schema.journalEntries)
    .where(and(...conds))
    .orderBy(desc(schema.journalEntries.createdAt));
  const rows = filters?.limit ? await q.limit(filters.limit) : await q;
  return rows.map(hydrate);
}

export async function getEntry(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.userId, userId), eq(schema.journalEntries.id, id)));
  return row ? hydrate(row) : null;
}

export async function createEntry(
  userId: string,
  input: { kind: JournalKind; eventId?: string | null; rating?: number | null; note?: string },
) {
  const now = new Date();
  const id = newId("j");
  const rating = input.rating == null ? null : clampRating(input.rating);
  await db.insert(schema.journalEntries).values({
    id,
    userId,
    eventId: input.eventId ?? null,
    kind: input.kind,
    rating,
    note: (input.note ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  });
  return (await getEntry(userId, id))!;
}

export async function patchEntry(
  userId: string,
  id: string,
  input: { eventId?: string | null; rating?: number | null; note?: string },
) {
  const existing = await getEntry(userId, id);
  if (!existing) return null;
  const updates: Partial<typeof schema.journalEntries.$inferInsert> = { updatedAt: new Date() };
  if (input.eventId !== undefined) updates.eventId = input.eventId;
  if (input.rating !== undefined) updates.rating = input.rating == null ? null : clampRating(input.rating);
  if (input.note !== undefined) updates.note = input.note.trim();
  await db
    .update(schema.journalEntries)
    .set(updates)
    .where(and(eq(schema.journalEntries.userId, userId), eq(schema.journalEntries.id, id)));
  return getEntry(userId, id);
}

export async function deleteEntry(userId: string, id: string) {
  await db
    .delete(schema.journalEntries)
    .where(and(eq(schema.journalEntries.userId, userId), eq(schema.journalEntries.id, id)));
}

// Find the event most likely to be what a quick-log is "about" for a given timestamp.
// Preference order: currently-happening event > most-recently-ended event within window > nearest upcoming.
export async function findNearestEvent(
  userId: string,
  at: Date,
  windowMinutes = 120,
) {
  const windowMs = windowMinutes * 60_000;
  const lo = new Date(+at - windowMs);
  const hi = new Date(+at + windowMs);

  const candidates = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.userId, userId),
        gte(schema.events.startTime, lo),
        lte(schema.events.startTime, hi),
      ),
    )
    .orderBy(asc(schema.events.startTime));

  if (candidates.length === 0) return null;

  // Currently-happening: start <= at < end
  const happening = candidates.find((e) => e.startTime <= at && e.endTime > at);
  if (happening) return { id: happening.id, title: happening.title, start: happening.startTime, end: happening.endTime, match: "happening" as const };

  // Most recently ended before `at`
  const ended = candidates
    .filter((e) => e.endTime <= at)
    .sort((a, b) => +b.endTime - +a.endTime)[0];
  if (ended) return { id: ended.id, title: ended.title, start: ended.startTime, end: ended.endTime, match: "recent" as const };

  // Otherwise nearest upcoming
  const upcoming = candidates
    .filter((e) => e.startTime > at)
    .sort((a, b) => +a.startTime - +b.startTime)[0];
  if (upcoming) return { id: upcoming.id, title: upcoming.title, start: upcoming.startTime, end: upcoming.endTime, match: "upcoming" as const };

  return null;
}

// Events that have ended and don't yet have a reflection attached.
// Used by the UI and AI context to nudge the user to journal.
export async function listEventsAwaitingReflection(userId: string, since: Date, now: Date = new Date()) {
  const endedRows = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.userId, userId),
        gte(schema.events.startTime, since),
        lte(schema.events.endTime, now),
      ),
    )
    .orderBy(desc(schema.events.endTime));

  if (endedRows.length === 0) return [];

  const reflectionRows = await db
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.userId, userId),
        eq(schema.journalEntries.kind, "reflection"),
        isNotNull(schema.journalEntries.eventId),
      ),
    );
  const withReflection = new Set(reflectionRows.map((r) => r.eventId).filter((x): x is string => !!x));

  return endedRows
    .filter((e) => !withReflection.has(e.id))
    .map((e) => ({ id: e.id, title: e.title, start: e.startTime, end: e.endTime, kind: e.kind }));
}

function clampRating(n: number) {
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
}
