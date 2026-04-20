import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import {
  dismissNotification,
  listActiveNotifications,
} from "../services/notifications.js";
import { runMonitor } from "../ai/monitor.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/api/notifications", async (req) => {
    const u = currentUser(req);
    return listActiveNotifications(u.id);
  });

  app.post("/api/notifications/:id/dismiss", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await dismissNotification(u.id, id);
    return { ok: true };
  });

  app.post("/api/notifications/scan", async (req) => {
    const u = currentUser(req);
    const created = await runMonitor(u.id);
    return { created: created.length };
  });

  app.post("/api/notifications/test-discord", async () => {
    // Discord bot integration lands in phase 2. This endpoint exists so the
    // memory/integrations panel can exercise the route without crashing.
    return { ok: true, delivered: false, reason: "discord_stub" };
  });
}
