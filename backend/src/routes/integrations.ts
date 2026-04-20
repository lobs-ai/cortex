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
  upsertGoogleConnection,
} from "../services/googleAuth.js";
import { listCalendars, syncCalendar } from "../services/googleCalendar.js";
import {
  clearConfig,
  describeConfig,
  getConfig,
  setConfig,
} from "../services/integrationConfigs.js";

// Known providers we accept configs for. Anything else is rejected so we
// don't accumulate junk rows.
const KNOWN_PROVIDERS = new Set([
  "google",
  "gmail",
  "google_drive",
  "google_calendar",
  "discord",
  "github",
  "slack",
  "notion",
  "linear",
]);

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

const OAUTH_PROVIDERS = new Set(["google", "gmail", "google_drive", "google_calendar"]);

async function upsertIntegrationStatus(
  userId: string,
  provider: string,
  status: "connected" | "disconnected",
) {
  const [existing] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, provider)),
    );
  if (existing) {
    await db
      .update(schema.integrations)
      .set({ status, lastSyncedAt: status === "connected" ? new Date() : existing.lastSyncedAt })
      .where(eq(schema.integrations.id, existing.id));
  } else if (status === "connected") {
    await db.insert(schema.integrations).values({
      id: newId("in"),
      userId,
      provider,
      status,
      detail: null,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      lastSyncedAt: new Date(),
    });
  }
}

export async function integrationsManageRoutes(app: FastifyInstance) {
  app.get("/api/integrations", async (req) => {
    const u = currentUser(req);
    const rows = await db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.userId, u.id));
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      status: r.status,
      detail: r.detail,
      lastSyncedAt: r.lastSyncedAt,
    }));
  });

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

    await db
      .update(schema.integrations)
      .set(updates)
      .where(and(eq(schema.integrations.userId, u.id), eq(schema.integrations.id, id)));

    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.userId, u.id), eq(schema.integrations.id, id)));
    if (!row) return reply.code(404).send({ error: "not_found" });
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

  // ── Per-provider config store (encrypted) ──────────────────────────────

  app.get("/api/integrations/configs/:provider", async (req, reply) => {
    const u = currentUser(req);
    const { provider } = z.object({ provider: z.string() }).parse(req.params);
    if (!KNOWN_PROVIDERS.has(provider)) {
      return reply.code(400).send({ error: "unknown_provider" });
    }
    const fields = await describeConfig(u.id, provider);
    return { provider, fields };
  });

  app.put("/api/integrations/configs/:provider", async (req, reply) => {
    const u = currentUser(req);
    const { provider } = z.object({ provider: z.string() }).parse(req.params);
    if (!KNOWN_PROVIDERS.has(provider)) {
      return reply.code(400).send({ error: "unknown_provider" });
    }
    const body = z
      .object({ fields: z.record(z.string(), z.string().nullable()) })
      .parse(req.body);
    await setConfig(u.id, provider, body.fields);
    if (!OAUTH_PROVIDERS.has(provider)) {
      await upsertIntegrationStatus(u.id, provider, "connected");
    }
    return { provider, fields: await describeConfig(u.id, provider) };
  });

  app.delete("/api/integrations/configs/:provider", async (req, reply) => {
    const u = currentUser(req);
    const { provider } = z.object({ provider: z.string() }).parse(req.params);
    if (!KNOWN_PROVIDERS.has(provider)) {
      return reply.code(400).send({ error: "unknown_provider" });
    }
    await clearConfig(u.id, provider);
    if (!OAUTH_PROVIDERS.has(provider)) {
      await upsertIntegrationStatus(u.id, provider, "disconnected");
    }
    return { ok: true };
  });

  // ── Google OAuth flow ──────────────────────────────────────────────────

  app.get("/api/integrations/google/status", async (req) => {
    const u = currentUser(req);
    return { configured: await googleOAuthConfigured(u.id) };
  });

  app.get("/api/integrations/google/connect", async (req, reply) => {
    const u = currentUser(req);
    if (!(await googleOAuthConfigured(u.id))) {
      return reply.code(501).send({
        error: "google_oauth_not_configured",
        message:
          "Save your Google OAuth client ID + secret first. See Settings → Integrations → Google.",
      });
    }
    const state = mintState(u.id);
    const url = await getAuthUrl(u.id, state);
    return reply.redirect(url);
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
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? "Connected" : "Failed"}</title>
<style>body{font-family:system-ui;padding:40px;max-width:420px;margin:auto;color:#111}h1{font-size:18px;margin:0 0 12px}.muted{color:#666;font-size:13px}</style>
</head><body>
<h1>${ok ? "\u2713 Google connected" : "Connection failed"}</h1>
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
      const { tokens, email } = await exchangeCode(s.userId, q.code);
      await upsertGoogleConnection(s.userId, tokens, email);
      void syncCalendar(s.userId).catch((err) =>
        console.error("initial google calendar sync failed", err),
      );
      return respond(
        true,
        `Connected ${email}. Calendar events will appear shortly; Gmail/Drive can be toggled in Settings.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return respond(false, msg);
    }
  });

  app.get("/api/integrations/google/calendars", async (req, reply) => {
    const u = currentUser(req);
    try {
      const cals = await listCalendars(u.id);
      return cals;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: msg });
    }
  });

  app.get("/api/integrations/google/write-calendar", async (req) => {
    const u = currentUser(req);
    const cfg = await getConfig(u.id, "google_calendar");
    return { calendarId: cfg.write_calendar_id ?? null };
  });

  app.put("/api/integrations/google/write-calendar", async (req) => {
    const u = currentUser(req);
    const { calendarId } = z.object({ calendarId: z.string().nullable() }).parse(req.body);
    await setConfig(u.id, "google_calendar", { write_calendar_id: calendarId });
    return { ok: true };
  });

  app.post("/api/integrations/google/disconnect", async (req) => {
    const u = currentUser(req);
    await disconnectGoogle(u.id);
    return { ok: true };
  });

  // Generic per-row disconnect (row stays, status flips, tokens cleared).
  // Google rows route to the full revoke flow.
  app.post("/api/integrations/:id/disconnect", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.userId, u.id), eq(schema.integrations.id, id)));
    if (!row) return reply.code(404).send({ error: "not_found" });

    if (
      row.provider === "google" ||
      row.provider === "google_calendar" ||
      row.provider === "gmail" ||
      row.provider === "google_drive"
    ) {
      await disconnectGoogle(u.id);
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
