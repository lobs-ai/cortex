import { DEMO_USER_ID } from "./lib/user.js";
import { runMonitor } from "./ai/monitor.js";
import { syncCalendar } from "./services/googleCalendar.js";

// Minimal background worker. Polls on a timer:
//   - monitor every 30 min for proactive alerts
//   - google calendar every 15 min (no-op if not connected)

const MONITOR_INTERVAL_MS = 30 * 60 * 1000;
const CALENDAR_INTERVAL_MS = 15 * 60 * 1000;

async function monitorTick() {
  try {
    const created = await runMonitor(DEMO_USER_ID);
    if (created.length > 0) console.log(`monitor: ${created.length} new notifications`);
  } catch (err) {
    console.error("monitor error:", err);
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
