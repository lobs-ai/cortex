import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { env } from "./env.js";
import { meRoutes } from "./routes/me.js";
import { taskRoutes } from "./routes/tasks.js";
import { eventRoutes } from "./routes/events.js";
import { projectRoutes } from "./routes/projects.js";
import { planRoutes } from "./routes/plans.js";
import { chatRoutes } from "./routes/chat.js";
import { memoryRoutes } from "./routes/memory.js";
import { notificationRoutes } from "./routes/notifications.js";

async function main() {
  const app = Fastify({
    logger: {
      transport: env.CORTEX_ENV === "dev" ? { target: "pino-pretty" } : undefined,
      level: "info",
    },
  });

  await app.register(sensible);
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

  app.get("/", async () => ({ ok: true, service: "cortex-backend" }));
  app.get("/health", async () => ({ ok: true }));

  await app.register(meRoutes);
  await app.register(taskRoutes);
  await app.register(eventRoutes);
  await app.register(projectRoutes);
  await app.register(planRoutes);
  await app.register(chatRoutes);
  await app.register(memoryRoutes);
  await app.register(notificationRoutes);

  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    app.log.error({ err: e }, "unhandled");
    if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
    return reply.code(500).send({ error: "internal_error", message: e.message });
  });

  await app.listen({ host: "0.0.0.0", port: env.PORT });
  app.log.info(`cortex listening on :${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
