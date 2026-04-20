import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import path from "node:path";
import next from "next";
import { env } from "./env.js";
import { meRoutes } from "./routes/me.js";
import { taskRoutes } from "./routes/tasks.js";
import { eventRoutes } from "./routes/events.js";
import { projectRoutes } from "./routes/projects.js";
import { planRoutes } from "./routes/plans.js";
import { chatRoutes } from "./routes/chat.js";
import { memoryRoutes } from "./routes/memory.js";
import { notificationRoutes } from "./routes/notifications.js";
import { recurringRoutes } from "./routes/recurring.js";
import { integrationsManageRoutes } from "./routes/integrations.js";
import { settingsRoutes } from "./routes/settings.js";

const dev = env.CORTEX_ENV !== "production";
const frontendDir = path.resolve(process.cwd(), "../frontend");

async function main() {
  const nextApp = next({ dev, dir: frontendDir });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = Fastify({
    logger: {
      transport: dev ? { target: "pino-pretty" } : undefined,
      level: "info",
    },
  });

  await app.register(sensible);
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

  app.get("/health", async () => ({ ok: true }));

  // API routes — these take precedence over Next.js
  await app.register(meRoutes);
  await app.register(taskRoutes);
  await app.register(eventRoutes);
  await app.register(projectRoutes);
  await app.register(planRoutes);
  await app.register(chatRoutes);
  await app.register(memoryRoutes);
  await app.register(notificationRoutes);
  await app.register(recurringRoutes);
  await app.register(integrationsManageRoutes);
  await app.register(settingsRoutes);

  // Anything Fastify doesn't have a route for falls through to Next.js
  // (pages, static assets, _next/*).
  app.setNotFoundHandler(async (req, reply) => {
    await handle(req.raw, reply.raw);
    reply.hijack();
  });

  // HMR / websocket upgrade in dev — Next owns its own websocket server,
  // so forward the upgrade event for the HMR endpoint.
  if (dev) {
    const upgrade = (nextApp as unknown as { getUpgradeHandler?: () => (req: unknown, socket: unknown, head: unknown) => void }).getUpgradeHandler?.();
    if (upgrade) {
      app.server.on("upgrade", (req, socket, head) => {
        if (req.url?.startsWith("/_next/webpack-hmr")) {
          upgrade(req, socket, head);
        }
      });
    }
  }

  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    app.log.error({ err: e }, "unhandled");
    if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
    return reply.code(500).send({ error: "internal_error", message: e.message });
  });

  await app.listen({ host: "0.0.0.0", port: env.PORT });
  app.log.info(`cortex listening on :${env.PORT} (next.js ${dev ? "dev" : "prod"} embedded)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
