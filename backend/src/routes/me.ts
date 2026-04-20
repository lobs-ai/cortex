import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";

export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (req) => {
    const u = currentUser(req);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    if (!row) return { id: u.id, email: "", name: "unknown", timezone: "UTC" };
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      timezone: row.timezone,
    };
  });
}
