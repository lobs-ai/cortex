import { DEMO_USER_ID } from "./lib/user.js";
import { runMonitor } from "./ai/monitor.js";
import { syncCalendar } from "./services/googleCalendar.js";
import { db, schema } from "./db/client.js";
import { newId } from "./lib/ids.js";
import { CALENDAR_INTERVAL_MS, MONITOR_INTERVAL_MS } from "./lib/schedules.js";

// Minimal background worker. Polls on a timer:
//   - monitor every 30 min for proactive alerts
//   - google calendar every 15 min (no-op if not connected)

async function monitorTick() {
  const startedAt = new Date();
  let status: "ok" | "error" = "ok";
  let createdCount = 0;
  try {
    const created = await runMonitor(DEMO_USER_ID);
    createdCount = created.length;
    if (createdCount > 0) console.log(`monitor: ${createdCount} new notifications`);
  } catch (err) {
    status = "error";
    console.error("monitor error:", err);
  }
  const finishedAt = new Date();
  try {
    await db.insert(schema.assistantRuns).values({
      id: newId("ar"),
      userId: DEMO_USER_ID,
      runType: "monitor",
      triggerType: "schedule",
      startedAt,
      finishedAt,
      status,
      outputJson: JSON.stringify({ notificationsCreated: createdCount }),
    });
  } catch (err) {
    console.error("failed to record monitor run:", err);
  }
}

async function calendarTick() {
  try {
    const res = await syncCalendar(DEMO_USER_ID);
    if (res.synced > 0) {
      console.log(
        `calendar: ${res.inserted} new, ${res.updated} updated, ${res.cancelled} cancelled`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg === "not_connected" ||
      msg === "feature_disabled" ||
      msg === "google_oauth_not_configured"
    )
      return;
    console.error("calendar sync error:", err);
  }
}

console.log("cortex worker starting");
await Promise.all([monitorTick(), calendarTick()]);
setInterval(monitorTick, MONITOR_INTERVAL_MS);
setInterval(calendarTick, CALENDAR_INTERVAL_MS);
