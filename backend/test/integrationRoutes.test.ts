import "./helpers/tempDb.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { applySchema } from "../src/db/push.js";
import { db, schema } from "../src/db/client.js";
import { integrationsManageRoutes } from "../src/routes/integrations.js";

async function buildApp() {
  const app = Fastify();
  await app.register(integrationsManageRoutes);
  return app;
}

beforeAll(() => {
  applySchema();
});

beforeEach(async () => {
  await db.delete(schema.integrations);
  await db.delete(schema.integrationConfigs);
});

describe("/api/integrations/configs/:provider", () => {
  it("returns an empty fields object for a fresh provider", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/integrations/configs/google",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provider: "google", fields: {} });
    await app.close();
  });

  it("rejects unknown providers", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/integrations/configs/evilco",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "unknown_provider" });
    await app.close();
  });

  it("PUT returns masked fields and never echoes raw secrets", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/integrations/configs/google",
      headers: { "content-type": "application/json" },
      payload: {
        fields: {
          client_id: "1234567890.apps.googleusercontent.com",
          client_secret: "GOCSPX-supersecret-xyz",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe("google");
    expect(body.fields.client_id.present).toBe(true);
    expect(body.fields.client_secret.present).toBe(true);
    expect(body.fields.client_secret.masked).not.toContain("supersecret");
    // Raw secret must never appear in the response body string.
    expect(res.body.includes("supersecret")).toBe(false);
    await app.close();
  });

  it("PUT is idempotent + updates in place", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/integrations/configs/slack",
      headers: { "content-type": "application/json" },
      payload: { fields: { bot_token: "xoxb-one" } },
    });
    await app.inject({
      method: "PUT",
      url: "/api/integrations/configs/slack",
      headers: { "content-type": "application/json" },
      payload: { fields: { bot_token: "xoxb-two" } },
    });
    const rows = await db
      .select()
      .from(schema.integrationConfigs)
      .where(eq(schema.integrationConfigs.provider, "slack"));
    expect(rows).toHaveLength(1);
    await app.close();
  });

  it("PUT with null deletes a field", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/integrations/configs/linear",
      headers: { "content-type": "application/json" },
      payload: { fields: { api_key: "lin_api_1", default_team: "CTX" } },
    });
    await app.inject({
      method: "PUT",
      url: "/api/integrations/configs/linear",
      headers: { "content-type": "application/json" },
      payload: { fields: { default_team: null } },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/integrations/configs/linear",
    });
    const body = res.json();
    expect(body.fields.api_key?.present).toBe(true);
    expect(body.fields.default_team).toBeUndefined();
    await app.close();
  });

  it("DELETE clears all fields for the provider", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/integrations/configs/notion",
      headers: { "content-type": "application/json" },
      payload: {
        fields: { integration_token: "secret_x", default_database_id: "db_1" },
      },
    });
    const del = await app.inject({
      method: "DELETE",
      url: "/api/integrations/configs/notion",
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    const rows = await db
      .select()
      .from(schema.integrationConfigs)
      .where(eq(schema.integrationConfigs.provider, "notion"));
    expect(rows).toHaveLength(0);
    await app.close();
  });
});

describe("/api/integrations/google/status", () => {
  const origId = process.env.GOOGLE_CLIENT_ID;
  const origSecret = process.env.GOOGLE_CLIENT_SECRET;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = origId ?? "";
    process.env.GOOGLE_CLIENT_SECRET = origSecret ?? "";
  });

  it("reports configured=true once DB creds are saved", async () => {
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    const app = await buildApp();

    let res = await app.inject({
      method: "GET",
      url: "/api/integrations/google/status",
    });
    expect(res.json()).toEqual({ configured: false });

    await app.inject({
      method: "PUT",
      url: "/api/integrations/configs/google",
      headers: { "content-type": "application/json" },
      payload: {
        fields: {
          client_id: "x.apps.googleusercontent.com",
          client_secret: "GOCSPX-abc",
        },
      },
    });

    res = await app.inject({
      method: "GET",
      url: "/api/integrations/google/status",
    });
    expect(res.json()).toEqual({ configured: true });
    await app.close();
  });
});
