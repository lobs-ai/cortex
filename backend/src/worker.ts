import { DEMO_USER_ID } from "./lib/user.js";
import { runMonitor } from "./ai/monitor.js";

// Minimal background worker. Real BullMQ workers land in phase 3 along with
// redis; in dev we just poll the monitor every 30 minutes so the proactive
// rail has fresh alerts.

const INTERVAL_MS = 30 * 60 * 1000;

async function tick() {
  try {
    const created = await runMonitor(DEMO_USER_ID);
    if (created.length > 0) console.log(`monitor: ${created.length} new notifications`);
  } catch (err) {
    console.error("monitor error:", err);
  }
}

console.log("cortex worker starting");
await tick();
setInterval(tick, INTERVAL_MS);
