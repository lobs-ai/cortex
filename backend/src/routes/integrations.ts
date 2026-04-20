import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { currentUser } from "../lib/user.js";
import {
  consumeState,
  disconnectGoogle,
  exchangeCode,
  getAuthUrl,
  googleOAuthConfigured,
  mintState,
  upsertGoogleIntegration,
} from "../services/googleAuth.js";
import { syncCalendar } from "../services/googleCalendar.js";

// CRUD over user-facing integration rows + real OAuth flow for Google
// Calendar. Other providers (Gmail, Drive, Discord, …) still use manual
// "record status" entries until they get their own OAuth implementations.

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

  // ── Google OAuth flow ──────────────────────────────────────────────────

  app.get("/api/integrations/google/status", async () => ({
    configured: googleOAuthConfigured(),
  }));

  app.get("/api/integrations/google/connect", async (req, reply) => {
    if (!googleOAuthConfigured()) {
      return reply.code(501).send({
        error: "google_oauth_not_configured",
        message:
          "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. See docs/INTEGRATIONS.md.",
      });
    }
    const u = currentUser(req);
    const state = mintState(u.id);
    return reply.redirect(getAuthUrl(state));
  });

  app.get("/api/integrations/google/callback", async (req, reply) => {
    const q = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);

    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const safeJson = (obj: unknown) =>
      JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

    const respond = (ok: boolean, message: string) => {
      const payload = safeJson({ type: "google-oauth", ok, message });
      const safeMessage = escapeHtml(message);
      // Popup-friendly response: postMessage to opener, then close. If the
      // user opened in a full tab, show a plain status.
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? "Connected" : "Failed"}</title>
<style>body{font-family:system-ui;padding:40px;max-width:420px;margin:auto;color:#111}h1{font-size:18px;margin:0 0 12px}.muted{color:#666;font-size:13px}</style>
</head><body>
<h1>${ok ? "\u2713 Google Calendar connected" : "Connection failed"}</h1>
<p class="muted">${safeMessage}</p>
<p class="muted">You can close this window.</p>
<script>
  try { if (window.opener) { window.opener.postMessage(${payload}, "*"); } } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 800);
</script>
</body></html>`;
      reply.type("text/html").send(html);
    };

    if (q.error) return respond(false, `Google returned: ${q.error}`);
    if (!q.code || !q.state) return respond(false, "missing code or state");

    const s = consumeState(q.state);
    if (!s) return respond(false, "invalid or expired state (try again)");

    try {
      const { tokens, email } = await exchangeCode(q.code);
      await upsertGoogleIntegration(s.userId, tokens, email);
      // Kick off first sync in the background; don't block the callback.
      void syncCalendar(s.userId).catch((err) =>
        console.error("initial google calendar sync failed", err),
      );
      return respond(true, `Connected ${email}. Your events will sync shortly.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return respond(false, msg);
    }
  });

  app.post("/api/integrations/:id/disconnect", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.userId, u.id), eq(schema.integrations.id, id)));
    if (!row) return reply.code(404).send({ error: "not_found" });

    if (row.provider === "google_calendar") {
      await disconnectGoogle(u.id, id);
    } else {
      await db
        .update(schema.integrations)
        .set({
          status: "disconnected",
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
        })
        .where(eq(schema.integrations.id, id));
    }
    return { ok: true };
  });
}
