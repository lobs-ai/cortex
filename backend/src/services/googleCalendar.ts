import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getAllAuthedClients, getAuthedClient, isFeatureEnabled } from "./googleAuth.js";
import { getConfigField, setConfig } from "./integrationConfigs.js";

const GOOGLE_CALENDAR_PROVIDER = "google_calendar";

// Pull the user's primary calendar and upsert into the events table. The
// `events` table already has (externalId, provider) for exactly this use.

const WINDOW_PAST_MS = 24 * 60 * 60 * 1000;        // 1 day back
const WINDOW_FUTURE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days ahead

type GEvent = {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
  attendees?: { email?: string | null; self?: boolean | null; responseStatus?: string | null }[] | null;
};

function parseWhen(
  side: { dateTime?: string | null; date?: string | null } | null | undefined,
): Date | null {
  if (!side) return null;
  if (side.dateTime) return new Date(side.dateTime);
  // All-day events come as YYYY-MM-DD; treat as local midnight.
  if (side.date) return new Date(`${side.date}T00:00:00`);
  return null;
}

type SyncStats = { inserted: number; updated: number; cancelled: number; todayTouched: boolean };

function inRange(d: Date | null | undefined, from: Date, to: Date): boolean {
  if (!d) return false;
  const t = +d;
  return t >= +from && t < +to;
}

async function syncOneCalendar(
  userId: string,
  calendarId: string,
  cal: ReturnType<typeof google.calendar>,
  from: Date,
  to: Date,
  todayStart: Date,
  todayEnd: Date,
): Promise<SyncStats> {
  const res = await cal.events.list({
    calendarId,
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 500,
    showDeleted: true,
  });

  const items: GEvent[] = (res.data.items as GEvent[] | undefined) ?? [];
  let inserted = 0, updated = 0, cancelled = 0;
  let todayTouched = false;
  const now = new Date();

  for (const g of items) {
    if (!g.id) continue;
    const start = parseWhen(g.start);
    const end = parseWhen(g.end) ?? start;
    if (!start || !end) continue;

    // Match by externalId regardless of provider — covers both Google-synced
    // and Cortex-created events that were pushed to Google.
    const [existing] = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.userId, userId), eq(schema.events.externalId, g.id)));

    // Skip Cortex-created events (provider=null) — they already live in Cortex.
    if (existing && !existing.provider) continue;

    const status = g.status === "cancelled" ? "cancelled" : (g.status ?? "confirmed");
    const attendeesJson = g.attendees?.length
      ? JSON.stringify({ count: g.attendees.length })
      : null;
    const tz = g.start?.timeZone ?? "America/Detroit";
    const selfAttendee = g.attendees?.find((a) => a.self);
    const rsvpStatus = selfAttendee?.responseStatus ?? null;
    // A change "touches today" if either the old or the new start sits inside today.
    const affectsToday =
      inRange(existing?.startTime, todayStart, todayEnd) || inRange(start, todayStart, todayEnd);

    if (existing) {
      const changed =
        existing.title !== (g.summary ?? "(no title)") ||
        +existing.startTime !== +start ||
        +existing.endTime !== +end ||
        existing.status !== status ||
        existing.rsvpStatus !== rsvpStatus ||
        existing.location !== (g.location ?? null);
      if (g.status === "cancelled") cancelled++;
      else updated++;
      await db
        .update(schema.events)
        .set({
          title: g.summary ?? "(no title)",
          description: g.description ?? null,
          location: g.location ?? null,
          startTime: start,
          endTime: end,
          timezone: tz,
          attendeesJson,
          rsvpStatus,
          status,
          updatedAt: now,
        })
        .where(eq(schema.events.id, existing.id));
      if (changed && affectsToday) todayTouched = true;
    } else {
      if (g.status === "cancelled") continue;
      inserted++;
      await db.insert(schema.events).values({
        id: newId("e"),
        userId,
        externalId: g.id,
        provider: GOOGLE_CALENDAR_PROVIDER,
        title: g.summary ?? "(no title)",
        description: g.description ?? null,
        location: g.location ?? null,
        startTime: start,
        endTime: end,
        timezone: tz,
        kind: "meeting",
        attendeesJson,
        rsvpStatus,
        important: false,
        status,
        createdAt: now,
        updatedAt: now,
      });
      if (affectsToday) todayTouched = true;
    }
  }

  return { inserted, updated, cancelled, todayTouched };
}

type ReadSelection = { calendarId: string; masterId: string };

export async function getReadSelections(userId: string): Promise<ReadSelection[]> {
  const raw = await getConfigField(userId, "google_calendar", "read_calendar_ids");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ReadSelection[];
  } catch {
    return [];
  }
}

export async function setReadSelections(userId: string, selections: ReadSelection[]): Promise<void> {
  await setConfig(userId, "google_calendar", {
    read_calendar_ids: selections.length > 0 ? JSON.stringify(selections) : null,
  });
}

export async function syncCalendar(userId: string): Promise<{
  synced: number;
  inserted: number;
  updated: number;
  cancelled: number;
  todayTouched: boolean;
  range: { from: string; to: string };
}> {
  const allAuthed = await getAllAuthedClients(userId);
  if (allAuthed.length === 0) throw new Error("not_connected");
  if (!(await isFeatureEnabled(userId, "google_calendar"))) {
    throw new Error("feature_disabled");
  }

  const from = new Date(Date.now() - WINDOW_PAST_MS);
  const to = new Date(Date.now() + WINDOW_FUTURE_MS);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const clientMap = new Map(allAuthed.map((a) => [a.masterId, a.client]));

  // Use saved selections; fall back to syncing primary for every account.
  let readSelections = await getReadSelections(userId);
  if (readSelections.length === 0) {
    readSelections = allAuthed.map((a) => ({ calendarId: "primary", masterId: a.masterId }));
  }

  let inserted = 0, updated = 0, cancelled = 0;
  let todayTouched = false;
  const now = new Date();

  for (const sel of readSelections) {
    const client = clientMap.get(sel.masterId);
    if (!client) continue;
    const cal = google.calendar({ version: "v3", auth: client });
    try {
      const stats = await syncOneCalendar(userId, sel.calendarId, cal, from, to, todayStart, todayEnd);
      inserted += stats.inserted;
      updated += stats.updated;
      cancelled += stats.cancelled;
      if (stats.todayTouched) todayTouched = true;
    } catch {
      // skip calendars that error (revoked access, deleted calendar, etc.)
    }
  }

  // Sync write calendar too if it isn't already in the read selections.
  const writeCalId = await getConfigField(userId, "google_calendar", "write_calendar_id");
  if (writeCalId) {
    const alreadySynced = readSelections.some((s) => s.calendarId === writeCalId);
    if (!alreadySynced) {
      for (const authed of allAuthed) {
        const cal = google.calendar({ version: "v3", auth: authed.client });
        try {
          const extra = await syncOneCalendar(userId, writeCalId, cal, from, to, todayStart, todayEnd);
          inserted += extra.inserted;
          updated += extra.updated;
          cancelled += extra.cancelled;
          if (extra.todayTouched) todayTouched = true;
          break;
        } catch {
          // try next account
        }
      }
    }
  }

  for (const authed of allAuthed) {
    await db
      .update(schema.integrations)
      .set({ lastSyncedAt: now })
      .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.id, authed.masterId)));
  }
  await db
    .update(schema.integrations)
    .set({ lastSyncedAt: now })
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, GOOGLE_CALENDAR_PROVIDER)));

  return {
    synced: inserted + updated + cancelled,
    inserted,
    updated,
    cancelled,
    todayTouched,
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}

export async function listCalendars(
  userId: string,
): Promise<{ id: string; summary: string; primary: boolean; masterId: string; accountEmail: string }[]> {
  const allAuthed = await getAllAuthedClients(userId);
  if (allAuthed.length === 0) throw new Error("not_connected");

  const results: { id: string; summary: string; primary: boolean; masterId: string; accountEmail: string }[] = [];
  for (const authed of allAuthed) {
    const cal = google.calendar({ version: "v3", auth: authed.client });
    try {
      const res = await cal.calendarList.list({ maxResults: 100 });
      const items = (res.data.items ?? []) as Array<{
        id?: string | null;
        summary?: string | null;
        primary?: boolean | null;
      }>;
      for (const c of items) {
        if (!c.id) continue;
        results.push({
          id: c.id,
          summary: c.summary ?? c.id,
          primary: !!c.primary,
          masterId: authed.masterId,
          accountEmail: authed.email,
        });
      }
    } catch {
      // skip accounts that can't list calendars
    }
  }
  return results;
}

export async function pushEventToGoogle(
  userId: string,
  calendarId: string,
  event: { title: string; description?: string | null; startTime: Date; endTime: Date },
): Promise<string | null> {
  const authed = await getAuthedClient(userId);
  if (!authed) return null;

  const cal = google.calendar({ version: "v3", auth: authed.client });
  try {
    const res = await cal.events.insert({
      calendarId,
      requestBody: {
        summary: event.title,
        description: event.description ?? undefined,
        start: { dateTime: event.startTime.toISOString() },
        end: { dateTime: event.endTime.toISOString() },
      },
    });
    return res.data.id ?? null;
  } catch {
    return null;
  }
}

export async function respondToGoogleEvent(
  userId: string,
  googleEventId: string,
  response: "accepted" | "declined" | "tentative",
  proposedTime?: { start: Date; end: Date },
): Promise<void> {
  const authed = await getAuthedClient(userId);
  if (!authed) return;

  const cal = google.calendar({ version: "v3", auth: authed.client });

  // Fetch the current event to get the full attendees list
  let existing;
  try {
    existing = await cal.events.get({ calendarId: "primary", eventId: googleEventId });
  } catch {
    return; // event not on primary calendar; skip
  }

  const updatedAttendees = (existing.data.attendees ?? []).map((a) => {
    if (!a.self) return a;
    const entry: Record<string, unknown> = { ...a, responseStatus: response };
    if (proposedTime) {
      entry.proposedNewStartTime = { dateTime: proposedTime.start.toISOString() };
      entry.proposedNewEndTime = { dateTime: proposedTime.end.toISOString() };
    }
    return entry;
  });

  await (cal.events.patch as Function)({
    calendarId: "primary",
    eventId: googleEventId,
    sendUpdates: "all",
    requestBody: { attendees: updatedAttendees },
  });
}

export async function deleteGoogleEvent(
  userId: string,
  calendarId: string,
  googleEventId: string,
): Promise<void> {
  const authed = await getAuthedClient(userId);
  if (!authed) return;

  const cal = google.calendar({ version: "v3", auth: authed.client });
  try {
    await cal.events.delete({ calendarId, eventId: googleEventId });
  } catch {
    // Ignore — event may already be deleted on Google's side
  }
}
