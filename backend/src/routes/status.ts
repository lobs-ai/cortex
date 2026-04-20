import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import {
  CALENDAR_INTERVAL_MS,
  MONITOR_INTERVAL_MS,
} from "../lib/schedules.js";

const GOOGLE_CALENDAR_PROVIDER = "google_calendar";

export async function statusRoutes(app: FastifyInstance) {
  app.get("/api/status", async (req) => {
    const u = currentUser(req);

    const [latestMonitor] = await db
      .select({ startedAt: schema.assistantRuns.startedAt })
      .from(schema.assistantRuns)
      .where(
        and(
          eq(schema.assistantRuns.userId, u.id),
          eq(schema.assistantRuns.runType, "monitor"),
        ),
      )
      .orderBy(desc(schema.assistantRuns.startedAt))
      .limit(1);

    const [calendarIntegration] = await db
      .select({ lastSyncedAt: schema.integrations.lastSyncedAt })
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, u.id),
          eq(schema.integrations.provider, GOOGLE_CALENDAR_PROVIDER),
        ),
      )
      .limit(1);

    return {
      now: new Date().toISOString(),
      monitor: {
        lastRunAt: latestMonitor?.startedAt?.toISOString() ?? null,
        intervalMs: MONITOR_INTERVAL_MS,
      },
      calendar: {
        lastSyncedAt: calendarIntegration?.lastSyncedAt?.toISOString() ?? null,
        intervalMs: CALENDAR_INTERVAL_MS,
      },
    };
  });
}
