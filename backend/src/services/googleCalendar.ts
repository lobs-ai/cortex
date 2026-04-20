import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getAuthedClient, isFeatureEnabled } from "./googleAuth.js";
import { getConfigField } from "./integrationConfigs.js";

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

type SyncStats = { inserted: number; updated: number; cancelled: number };

async function syncOneCalendar(
  userId: string,
  calendarId: string,
  cal: ReturnType<typeof google.calendar>,
  from: Date,
  to: Date,
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

    if (existing) {
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
    }
  }

  return { inserted, updated, cancelled };
}

export async function syncCalendar(userId: string): Promise<{
  synced: number;
  inserted: number;
  updated: number;
  cancelled: number;
  range: { from: string; to: string };
}> {
  const authed = await getAuthedClient(userId);
  if (!authed) throw new Error("not_connected");
  if (!(await isFeatureEnabled(userId, "google_calendar"))) {
    throw new Error("feature_disabled");
  }

  const from = new Date(Date.now() - WINDOW_PAST_MS);
  const to = new Date(Date.now() + WINDOW_FUTURE_MS);
  const cal = google.calendar({ version: "v3", auth: authed.client });

  const primary = await syncOneCalendar(userId, "primary", cal, from, to);

  // Also sync the write calendar if it's configured and not the primary
  let extra: SyncStats = { inserted: 0, updated: 0, cancelled: 0 };
  const writeCalId = await getConfigField(userId, "google_calendar", "write_calendar_id");
  if (writeCalId && writeCalId !== "primary") {
    try {
      extra = await syncOneCalendar(userId, writeCalId, cal, from, to);
    } catch {
      // Don't fail the overall sync if the write calendar sync fails
    }
  }

  const inserted = primary.inserted + extra.inserted;
  const updated = primary.updated + extra.updated;
  const cancelled = primary.cancelled + extra.cancelled;
  const now = new Date();

  await db
    .update(schema.integrations)
    .set({ lastSyncedAt: now })
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.id, authed.masterId)));
  await db
    .update(schema.integrations)
    .set({ lastSyncedAt: now })
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, GOOGLE_CALENDAR_PROVIDER)));

  return {
    synced: inserted + updated + cancelled,
    inserted,
    updated,
    cancelled,
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}

export async function listCalendars(
  userId: string,
): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const authed = await getAuthedClient(userId);
  if (!authed) throw new Error("not_connected");

  const cal = google.calendar({ version: "v3", auth: authed.client });
  const res = await cal.calendarList.list({ maxResults: 100 });
  const items = (res.data.items ?? []) as Array<{
    id?: string | null;
    summary?: string | null;
    primary?: boolean | null;
  }>;
  return items
    .filter((c): c is typeof c & { id: string } => !!c.id)
    .map((c) => ({ id: c.id, summary: c.summary ?? c.id, primary: !!c.primary }));
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
