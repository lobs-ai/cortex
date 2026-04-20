import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getAuthedClient, isFeatureEnabled } from "./googleAuth.js";

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
  attendees?: { email?: string | null }[] | null;
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
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 500,
    showDeleted: true,
  });

  const items: GEvent[] = (res.data.items as GEvent[] | undefined) ?? [];

  let inserted = 0;
  let updated = 0;
  let cancelled = 0;
  const now = new Date();

  for (const g of items) {
    if (!g.id) continue;
    const start = parseWhen(g.start);
    const end = parseWhen(g.end) ?? start;
    if (!start || !end) continue;

    const [existing] = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.userId, userId),
          eq(schema.events.provider, GOOGLE_CALENDAR_PROVIDER),
          eq(schema.events.externalId, g.id),
        ),
      );

    const status = g.status === "cancelled" ? "cancelled" : g.status ?? "confirmed";
    const attendeesJson = g.attendees?.length
      ? JSON.stringify({ count: g.attendees.length })
      : null;
    const tz = g.start?.timeZone ?? "America/Detroit";

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
          status,
          updatedAt: now,
        })
        .where(eq(schema.events.id, existing.id));
    } else {
      // Skip inserting brand-new cancelled events — nothing to show.
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
        important: false,
        status,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Stamp lastSyncedAt on BOTH the master (for freshness tracking) and the
  // google_calendar feature row (what the UI displays per-feature).
  await db
    .update(schema.integrations)
    .set({ lastSyncedAt: now })
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.id, authed.masterId),
      ),
    );
  await db
    .update(schema.integrations)
    .set({ lastSyncedAt: now })
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.provider, GOOGLE_CALENDAR_PROVIDER),
      ),
    );

  return {
    synced: inserted + updated + cancelled,
    inserted,
    updated,
    cancelled,
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}
