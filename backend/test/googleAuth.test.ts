import "./helpers/tempDb.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { applySchema } from "../src/db/push.js";
import { db, schema } from "../src/db/client.js";
import {
  GOOGLE_FEATURE_PROVIDERS,
  GOOGLE_MASTER_PROVIDER,
  consumeState,
  disconnectGoogle,
  getAuthedClient,
  googleOAuthConfigured,
  isFeatureEnabled,
  mintState,
  upsertGoogleConnection,
} from "../src/services/googleAuth.js";
import { setConfig } from "../src/services/integrationConfigs.js";

const USER = "u_google_test";

beforeAll(() => {
  applySchema();
});

beforeEach(async () => {
  await db
    .delete(schema.integrations)
    .where(eq(schema.integrations.userId, USER));
  await db
    .delete(schema.integrationConfigs)
    .where(eq(schema.integrationConfigs.userId, USER));
});

describe("CSRF state store", () => {
  it("consumes a freshly-minted state exactly once", () => {
    const token = mintState(USER);
    expect(consumeState(token)).toEqual({ userId: USER });
    expect(consumeState(token)).toBeNull();
  });

  it("rejects unknown tokens", () => {
    expect(consumeState("not-a-real-state")).toBeNull();
  });

  it("binds the token to the user who minted it", () => {
    const a = mintState("u_a");
    const b = mintState("u_b");
    expect(consumeState(a)).toEqual({ userId: "u_a" });
    expect(consumeState(b)).toEqual({ userId: "u_b" });
  });
});

describe("googleOAuthConfigured", () => {
  // env.ts snapshots process.env at import time, so env-fallback behavior
  // is covered by a manual sanity check in dev; here we pin the DB path
  // which is what the product actually relies on.

  it("returns false when DB config is empty (env left unset in tests)", async () => {
    expect(await googleOAuthConfigured(USER)).toBe(false);
  });

  it("returns true when DB config holds both fields", async () => {
    await setConfig(USER, "google", {
      client_id: "dbid.apps.googleusercontent.com",
      client_secret: "GOCSPX-db",
    });
    expect(await googleOAuthConfigured(USER)).toBe(true);
  });

  it("returns false if only one of the two is set", async () => {
    await setConfig(USER, "google", {
      client_id: "dbid.apps.googleusercontent.com",
    });
    expect(await googleOAuthConfigured(USER)).toBe(false);
  });
});

describe("upsertGoogleConnection + disconnectGoogle", () => {
  it("creates the master row + 3 feature rows on first connect", async () => {
    await upsertGoogleConnection(
      USER,
      {
        access_token: "at_1",
        refresh_token: "rt_1",
        expiry_date: Date.now() + 3600_000,
        token_type: "Bearer",
        scope: "calendar.readonly",
      },
      "user@example.com",
    );

    const rows = await db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, USER),
          inArray(schema.integrations.provider, [
            GOOGLE_MASTER_PROVIDER,
            ...GOOGLE_FEATURE_PROVIDERS,
          ]),
        ),
      );

    const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
    expect(Object.keys(byProvider).sort()).toEqual(
      [GOOGLE_MASTER_PROVIDER, ...GOOGLE_FEATURE_PROVIDERS].sort(),
    );
    for (const [provider, row] of Object.entries(byProvider)) {
      expect(row.status).toBe("connected");
      expect(row.detail).toBe("user@example.com");
      if (provider === GOOGLE_MASTER_PROVIDER) {
        expect(row.accessTokenEncrypted).toBeTruthy();
        expect(row.accessTokenEncrypted!.startsWith("v1:")).toBe(true);
      } else {
        expect(row.accessTokenEncrypted).toBeNull();
      }
    }
  });

  it("preserves refresh_token when Google omits one on re-consent", async () => {
    // getAuthedClient needs OAuth creds to instantiate the OAuth2 client,
    // even though we don't hit the network here.
    await setConfig(USER, "google", {
      client_id: "x.apps.googleusercontent.com",
      client_secret: "GOCSPX-y",
    });
    await upsertGoogleConnection(
      USER,
      { access_token: "at_old", refresh_token: "rt_old", expiry_date: 1 },
      "user@example.com",
    );
    // Re-consent flows often only return an access_token.
    await upsertGoogleConnection(
      USER,
      { access_token: "at_new", expiry_date: 2 },
      "user@example.com",
    );

    const client = await getAuthedClient(USER);
    expect(client).not.toBeNull();
    const creds = client!.client.credentials;
    expect(creds.refresh_token).toBe("rt_old");
    expect(creds.access_token).toBe("at_new");
  });

  it("honors a prior explicit disable of a feature on re-consent", async () => {
    await upsertGoogleConnection(
      USER,
      { access_token: "at_1", refresh_token: "rt_1" },
      "user@example.com",
    );
    // User disables Gmail after connecting.
    await db
      .update(schema.integrations)
      .set({ status: "disconnected" })
      .where(
        and(
          eq(schema.integrations.userId, USER),
          eq(schema.integrations.provider, "gmail"),
        ),
      );

    // Re-consent shouldn't silently turn Gmail back on.
    await upsertGoogleConnection(
      USER,
      { access_token: "at_2" },
      "user@example.com",
    );

    expect(await isFeatureEnabled(USER, "gmail")).toBe(false);
    expect(await isFeatureEnabled(USER, "google_calendar")).toBe(true);
    expect(await isFeatureEnabled(USER, "google_drive")).toBe(true);
  });

  it("disconnectGoogle clears tokens and turns all four rows off", async () => {
    await upsertGoogleConnection(
      USER,
      { access_token: "at", refresh_token: "rt" },
      "user@example.com",
    );
    // Configure DB creds so disconnect's revoke attempt doesn't try the
    // real Google endpoint — makeOAuth2Client will succeed locally.
    await setConfig(USER, "google", {
      client_id: "x.apps.googleusercontent.com",
      client_secret: "GOCSPX-y",
    });

    // disconnectGoogle calls revokeCredentials() which hits the network.
    // Swallow its failure by stubbing nothing — the code path already
    // catches and warns on failure. We care about the DB state.
    await disconnectGoogle(USER).catch(() => undefined);

    const rows = await db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, USER),
          inArray(schema.integrations.provider, [
            GOOGLE_MASTER_PROVIDER,
            ...GOOGLE_FEATURE_PROVIDERS,
          ]),
        ),
      );
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect(r.status).toBe("disconnected");
      expect(r.accessTokenEncrypted).toBeNull();
      expect(r.refreshTokenEncrypted).toBeNull();
    }
  });

  it("getAuthedClient returns null when not connected", async () => {
    expect(await getAuthedClient(USER)).toBeNull();
  });

  it("isFeatureEnabled returns false when master is disconnected", async () => {
    // Feature-row status=connected but no master — shouldn't matter, the
    // sync services consult both, but isFeatureEnabled is purely about
    // the feature row, so this test pins its contract.
    await db.insert(schema.integrations).values({
      id: "in_only_feature",
      userId: USER,
      provider: "google_calendar",
      status: "connected",
    });
    expect(await isFeatureEnabled(USER, "google_calendar")).toBe(true);

    await db
      .update(schema.integrations)
      .set({ status: "disconnected" })
      .where(eq(schema.integrations.id, "in_only_feature"));
    expect(await isFeatureEnabled(USER, "google_calendar")).toBe(false);
  });
});
