import { DEMO_USER_ID } from "./lib/user.js";
import { runMonitor } from "./ai/monitor.js";
import { syncCalendar } from "./services/googleCalendar.js";
import { db, schema } from "./db/client.js";
import { newId } from "./lib/ids.js";
import { CALENDAR_INTERVAL_MS, MONITOR_INTERVAL_MS } from "./lib/schedules.js";
import { regenerateDailyPlan } from "./services/plans.js";
import { createNotification, listActiveNotifications } from "./services/notifications.js";

// Minimal background worker. Polls on a timer:
//   - monitor every 30 min for proactive alerts
//   - google calendar every 15 min (no-op if not connected)

async function monitorTick() {
  const startedAt = new Date();
  let status: "ok" | "error" = "ok";
  let notificationCount = 0;
  let taskCount = 0;
  try {
    const result = await runMonitor(DEMO_USER_ID);
    notificationCount = result.notifications.length;
    taskCount = result.tasksCreated.length;
    if (notificationCount > 0) console.log(`monitor: ${notificationCount} new notifications`);
    if (taskCount > 0) {
      console.log(`monitor: ${taskCount} new tasks proactively created`);
      // The plan the user is looking at was generated with an older task list.
      // Regenerate so the new tasks land in the hero/deep-work slots.
      await autoRefreshPlan();
    }
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
      outputJson: JSON.stringify({
        notificationsCreated: notificationCount,
        tasksCreated: taskCount,
      }),
    });
  } catch (err) {
    console.error("failed to record monitor run:", err);
  }
}

const PLAN_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

async function autoRefreshPlan() {
  try {
    await regenerateDailyPlan(DEMO_USER_ID);
    const active = await listActiveNotifications(DEMO_USER_ID);
    const recent = active.find(
      (n) => n.kind === "plan_refreshed" && Date.now() - +n.createdAt < PLAN_REFRESH_COOLDOWN_MS,
    );
    if (!recent) {
      await createNotification(DEMO_USER_ID, {
        severity: "low",
        kind: "plan_refreshed",
        title: "Plan refreshed — your calendar changed",
        body: "Cortex re-planned today based on a calendar update.",
        category: "info",
      });
    }
    console.log("calendar: today's plan regenerated");
  } catch (err) {
    console.error("auto plan regen failed:", err);
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
    if (res.todayTouched) await autoRefreshPlan();
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
