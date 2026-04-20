import "./helpers/tempDb.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearConfig,
  describeConfig,
  getConfig,
  getConfigField,
  maskSecret,
  setConfig,
} from "../src/services/integrationConfigs.js";
import { applySchema } from "../src/db/push.js";
import { db, schema } from "../src/db/client.js";

const USER = "u_test";

beforeAll(() => {
  applySchema();
});

beforeEach(async () => {
  // Clean slate per test.
  await db.delete(schema.integrationConfigs);
});

describe("integrationConfigs", () => {
  it("round-trips fields via setConfig → getConfig (values are decrypted)", async () => {
    await setConfig(USER, "google", {
      client_id: "123.apps.googleusercontent.com",
      client_secret: "GOCSPX-abc",
    });
    const cfg = await getConfig(USER, "google");
    expect(cfg).toEqual({
      client_id: "123.apps.googleusercontent.com",
      client_secret: "GOCSPX-abc",
    });
  });

  it("stores ciphertext, not plaintext, at rest", async () => {
    await setConfig(USER, "github", { personal_access_token: "github_pat_xyz" });
    const rows = await db.select().from(schema.integrationConfigs);
    expect(rows).toHaveLength(1);
    expect(rows[0].valueEncrypted).not.toContain("github_pat_xyz");
    expect(rows[0].valueEncrypted.startsWith("v1:")).toBe(true);
  });

  it("empty string or null deletes the field", async () => {
    await setConfig(USER, "linear", { api_key: "lin_api_1", default_team: "CTX" });
    await setConfig(USER, "linear", { default_team: "" });
    let cfg = await getConfig(USER, "linear");
    expect(cfg).toEqual({ api_key: "lin_api_1" });

    await setConfig(USER, "linear", { api_key: null });
    cfg = await getConfig(USER, "linear");
    expect(cfg).toEqual({});
  });

  it("updates an existing field in place", async () => {
    await setConfig(USER, "slack", { bot_token: "xoxb-one" });
    await setConfig(USER, "slack", { bot_token: "xoxb-two" });
    const rows = await db.select().from(schema.integrationConfigs);
    expect(rows).toHaveLength(1);
    const cfg = await getConfig(USER, "slack");
    expect(cfg).toEqual({ bot_token: "xoxb-two" });
  });

  it("isolates providers from each other", async () => {
    await setConfig(USER, "google", { client_id: "g-1" });
    await setConfig(USER, "discord", { bot_token: "d-1" });
    expect(await getConfig(USER, "google")).toEqual({ client_id: "g-1" });
    expect(await getConfig(USER, "discord")).toEqual({ bot_token: "d-1" });
  });

  it("isolates users from each other", async () => {
    await setConfig("u_a", "google", { client_id: "a" });
    await setConfig("u_b", "google", { client_id: "b" });
    expect(await getConfig("u_a", "google")).toEqual({ client_id: "a" });
    expect(await getConfig("u_b", "google")).toEqual({ client_id: "b" });
  });

  it("clearConfig removes only the targeted provider for the user", async () => {
    await setConfig(USER, "google", { client_id: "g" });
    await setConfig(USER, "github", { personal_access_token: "p" });
    await setConfig("u_other", "google", { client_id: "keep-me" });

    await clearConfig(USER, "google");

    expect(await getConfig(USER, "google")).toEqual({});
    expect(await getConfig(USER, "github")).toEqual({ personal_access_token: "p" });
    expect(await getConfig("u_other", "google")).toEqual({ client_id: "keep-me" });
  });

  it("getConfigField returns a single field or null", async () => {
    await setConfig(USER, "notion", { integration_token: "secret_xyz" });
    expect(await getConfigField(USER, "notion", "integration_token")).toBe("secret_xyz");
    expect(await getConfigField(USER, "notion", "missing")).toBeNull();
  });

  it("describeConfig only returns masked, length-capped metadata", async () => {
    await setConfig(USER, "google", {
      client_id: "1234567890.apps.googleusercontent.com",
      client_secret: "GOCSPX-abcdef1234567890",
    });
    const d = await describeConfig(USER, "google");
    expect(d.client_id.present).toBe(true);
    expect(d.client_id.length).toBeGreaterThan(0);
    expect(d.client_id.masked).not.toContain("googleusercontent");
    // Mask is short and contains an ellipsis for longer secrets.
    expect(d.client_secret.masked).toMatch(/…/);
  });
});

describe("maskSecret", () => {
  it("masks short values completely", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("abc")).toBe("•••");
    expect(maskSecret("123456")).toBe("••••••");
  });

  it("leaves a telltale on medium values", () => {
    expect(maskSecret("abcdefghij")).toBe("ab…ij");
  });

  it("trims leading/trailing whitespace before masking", () => {
    // Mask is based on the trimmed value.
    expect(maskSecret("  hello  ").length).toBeLessThan("  hello  ".length);
  });

  it("shows first/last 4 on long values", () => {
    expect(maskSecret("0123456789abcdef")).toBe("0123…cdef");
  });
});
