import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { currentUser } from "../lib/user.js";

// CRUD over user-facing integration rows. Real OAuth (Google, Discord) is
// phase 2; this route lets the user record credentials + toggle status so
// the integrations list reflects reality.

const CONNECT_BODY = z.object({
  provider: z.string().min(1),
  status: z.enum(["connected", "available", "disconnected"]).default("connected"),
  detail: z.string().nullable().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
});

const PATCH_BODY = z.object({
  status: z.enum(["connected", "available", "disconnected"]).optional(),
  detail: z.string().nullable().optional(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
});

export async function integrationsManageRoutes(app: FastifyInstance) {
  app.post("/api/integrations", async (req) => {
    const u = currentUser(req);
    const body = CONNECT_BODY.parse(req.body);
    const id = newId("in");
    const now = new Date();
    await db.insert(schema.integrations).values({
      id,
      userId: u.id,
      provider: body.provider,
      status: body.status,
      detail: body.detail ?? null,
      accessTokenEncrypted: body.accessToken ?? null,
      refreshTokenEncrypted: body.refreshToken ?? null,
      lastSyncedAt: body.status === "connected" ? now : null,
    });
    return { id };
  });

  app.patch("/api/integrations/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = PATCH_BODY.parse(req.body);
    const updates: Partial<typeof schema.integrations.$inferInsert> = {};
    if (body.status !== undefined) {
      updates.status = body.status;
      if (body.status === "connected") updates.lastSyncedAt = new Date();
    }
    if (body.detail !== undefined) updates.detail = body.detail;
    if (body.accessToken !== undefined) updates.accessTokenEncrypted = body.accessToken;
    if (body.refreshToken !== undefined) updates.refreshTokenEncrypted = body.refreshToken;

    const result = await db
      .update(schema.integrations)
      .set(updates)
      .where(and(eq(schema.integrations.userId, u.id), eq(schema.integrations.id, id)));

    // drizzle on better-sqlite3 returns a run() result; row count isn't
    // straightforward — do a read-back to confirm.
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.userId, u.id), eq(schema.integrations.id, id)));
    if (!row) return reply.code(404).send({ error: "not_found" });
    void result;
    return {
      id: row.id,
      provider: row.provider,
      status: row.status,
      detail: row.detail,
      lastSyncedAt: row.lastSyncedAt,
    };
  });

  app.delete("/api/integrations/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await db
      .delete(schema.integrations)
      .where(and(eq(schema.integrations.userId, u.id), eq(schema.integrations.id, id)));
    return { ok: true };
  });
}
