import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

type Block = { start: Date; end: Date };

// Simple "free block" computation over a single day window.
// Working window defaults to 09:00–19:00 local.
export async function findFreeBlocks(
  userId: string,
  date: Date,
  opts: { workStart?: number; workEnd?: number; minMinutes?: number } = {},
): Promise<Block[]> {
  const workStart = opts.workStart ?? 9;
  const workEnd = opts.workEnd ?? 19;
  const minMinutes = opts.minMinutes ?? 30;

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const events = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.userId, userId),
        gte(schema.events.startTime, dayStart),
        lte(schema.events.startTime, dayEnd),
      ),
    )
    .orderBy(asc(schema.events.startTime));

  const boundsStart = new Date(dayStart);
  boundsStart.setHours(workStart, 0, 0, 0);
  const boundsEnd = new Date(dayStart);
  boundsEnd.setHours(workEnd, 0, 0, 0);

  const busy = events
    .filter((e) => e.kind !== "deadline")
    .map((e) => ({
      start: e.startTime < boundsStart ? boundsStart : e.startTime,
      end: e.endTime > boundsEnd ? boundsEnd : e.endTime,
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => +a.start - +b.start);

  const free: Block[] = [];
  let cursor = boundsStart;
  for (const b of busy) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < boundsEnd) free.push({ start: cursor, end: boundsEnd });

  return free.filter((b) => (+b.end - +b.start) / 60000 >= minMinutes);
}

export async function listScheduledBlocks(userId: string, from: Date, to: Date) {
  const rows = await db
    .select()
    .from(schema.scheduledBlocks)
    .where(
      and(
        eq(schema.scheduledBlocks.userId, userId),
        gte(schema.scheduledBlocks.startTime, from),
        lte(schema.scheduledBlocks.startTime, to),
      ),
    )
    .orderBy(asc(schema.scheduledBlocks.startTime));
  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    eventId: r.eventId,
    title: r.title,
    start: r.startTime,
    end: r.endTime,
    status: r.status,
    source: r.source,
  }));
}

export async function createScheduledBlock(
  userId: string,
  input: { taskId?: string | null; eventId?: string | null; title: string; start: Date; end: Date; source?: string; status?: string },
) {
  const id = newId("sb");
  await db.insert(schema.scheduledBlocks).values({
    id,
    userId,
    taskId: input.taskId ?? null,
    eventId: input.eventId ?? null,
    title: input.title,
    startTime: input.start,
    endTime: input.end,
    status: input.status ?? "proposed",
    source: input.source ?? "user",
    createdAt: new Date(),
  });
  return id;
}
