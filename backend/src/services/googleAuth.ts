import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { newId } from "../lib/ids.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { getConfig } from "./integrationConfigs.js";

// Row model:
//   provider = "google"          → master. Holds OAuth tokens + connected email.
//   provider = "google_calendar" → per-feature enable flag (status=connected|disconnected).
//   provider = "gmail"           → same.
//   provider = "google_drive"    → same.
//
// On Connect Google, all three feature rows are enabled. Users can later
// toggle any feature off — sync services for that feature are expected to
// check the flag before running. Disconnecting the master revokes tokens
// and turns all features off.

export const GOOGLE_MASTER_PROVIDER = "google";
export const GOOGLE_FEATURE_PROVIDERS = ["google_calendar", "gmail", "google_drive"] as const;
export type GoogleFeatureProvider = (typeof GOOGLE_FEATURE_PROVIDERS)[number];

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

async function resolveClientCreds(
  userId: string,
): Promise<{ clientId: string; clientSecret: string; redirectUri: string } | null> {
  const cfg = await getConfig(userId, "google");
  const clientId = cfg.client_id?.trim() || env.GOOGLE_CLIENT_ID;
  const clientSecret = cfg.client_secret?.trim() || env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    cfg.redirect_uri?.trim() || env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

export async function googleOAuthConfigured(userId: string): Promise<boolean> {
  return (await resolveClientCreds(userId)) !== null;
}

async function makeOAuth2Client(userId: string): Promise<OAuth2Client> {
  const creds = await resolveClientCreds(userId);
  if (!creds) throw new Error("google_oauth_not_configured");
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUri);
}

// ── Short-lived CSRF state store ──────────────────────────────────────────
type StateEntry = { userId: string; expires: number };
const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, StateEntry>();

function gcState(): void {
  const now = Date.now();
  for (const [k, v] of stateStore) if (v.expires < now) stateStore.delete(k);
}

export function mintState(userId: string): string {
  gcState();
  const token = randomBytes(18).toString("base64url");
  stateStore.set(token, { userId, expires: Date.now() + STATE_TTL_MS });
  return token;
}

export function consumeState(token: string): { userId: string } | null {
  gcState();
  const entry = stateStore.get(token);
  if (!entry) return null;
  stateStore.delete(token);
  if (entry.expires < Date.now()) return null;
  return { userId: entry.userId };
}

// ── Flow ──────────────────────────────────────────────────────────────────

export async function getAuthUrl(userId: string, state: string): Promise<string> {
  const client = await makeOAuth2Client(userId);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(
  userId: string,
  code: string,
): Promise<{ tokens: Credentials; email: string }> {
  const client = await makeOAuth2Client(userId);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email || "unknown@google";
  return { tokens, email };
}

function serializeCreds(c: Credentials): string {
  return JSON.stringify({
    access_token: c.access_token ?? null,
    refresh_token: c.refresh_token ?? null,
    expiry_date: c.expiry_date ?? null,
    token_type: c.token_type ?? null,
    scope: c.scope ?? null,
  });
}

export async function upsertGoogleConnection(
  userId: string,
  tokens: Credentials,
  email: string,
): Promise<void> {
  const now = new Date();

  // Preserve prior refresh token if Google omitted one (silent re-consent).
  const [existingMaster] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.provider, GOOGLE_MASTER_PROVIDER),
      ),
    );
  let finalTokens: Credentials = { ...tokens };
  if (existingMaster?.accessTokenEncrypted && !tokens.refresh_token) {
    try {
      const prev = JSON.parse(decrypt(existingMaster.accessTokenEncrypted)) as Credentials;
      if (prev.refresh_token) finalTokens.refresh_token = prev.refresh_token;
    } catch {
      // bad ciphertext, ignore
    }
  }

  const encrypted = encrypt(serializeCreds(finalTokens));

  if (existingMaster) {
    await db
      .update(schema.integrations)
      .set({
        status: "connected",
        detail: email,
        accessTokenEncrypted: encrypted,
        refreshTokenEncrypted: encrypted,
        lastSyncedAt: now,
      })
      .where(eq(schema.integrations.id, existingMaster.id));
  } else {
    await db.insert(schema.integrations).values({
      id: newId("in"),
      userId,
      provider: GOOGLE_MASTER_PROVIDER,
      status: "connected",
      detail: email,
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: encrypted,
      lastSyncedAt: now,
    });
  }

  // Ensure feature rows exist and are enabled. Preserve a row's existing
  // status if the user previously disabled it (so a reconnect doesn't
  // silently re-enable a feature they turned off).
  for (const provider of GOOGLE_FEATURE_PROVIDERS) {
    const [existing] = await db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, userId),
          eq(schema.integrations.provider, provider),
        ),
      );
    if (existing) {
      // Only flip to "connected" if it wasn't explicitly disconnected.
      if (existing.status !== "disconnected") {
        await db
          .update(schema.integrations)
          .set({ status: "connected", detail: email })
          .where(eq(schema.integrations.id, existing.id));
      } else {
        // Leave as disconnected but update detail.
        await db
          .update(schema.integrations)
          .set({ detail: email })
          .where(eq(schema.integrations.id, existing.id));
      }
    } else {
      await db.insert(schema.integrations).values({
        id: newId("in"),
        userId,
        provider,
        status: "connected",
        detail: email,
      });
    }
  }
}

async function persistRefreshedCreds(
  userId: string,
  masterId: string,
  merged: Credentials,
): Promise<void> {
  const payload = encrypt(serializeCreds(merged));
  await db
    .update(schema.integrations)
    .set({ accessTokenEncrypted: payload, refreshTokenEncrypted: payload })
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.id, masterId),
      ),
    );
}

export async function getAuthedClient(
  userId: string,
): Promise<{ client: OAuth2Client; masterId: string } | null> {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.provider, GOOGLE_MASTER_PROVIDER),
        eq(schema.integrations.status, "connected"),
      ),
    );
  if (!row || !row.accessTokenEncrypted) return null;

  const client = await makeOAuth2Client(userId);
  const creds = JSON.parse(decrypt(row.accessTokenEncrypted)) as Credentials;
  client.setCredentials(creds);

  client.on("tokens", (next) => {
    const merged: Credentials = { ...creds, ...next };
    if (!next.refresh_token && creds.refresh_token) merged.refresh_token = creds.refresh_token;
    void persistRefreshedCreds(userId, row.id, merged).catch((err) => {
      console.error("google token persist failed", err);
    });
  });

  return { client, masterId: row.id };
}

export async function isFeatureEnabled(
  userId: string,
  feature: GoogleFeatureProvider,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.provider, feature),
        eq(schema.integrations.status, "connected"),
      ),
    );
  return !!row;
}

export async function disconnectGoogle(userId: string): Promise<void> {
  const [master] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.provider, GOOGLE_MASTER_PROVIDER),
      ),
    );
  if (master?.accessTokenEncrypted) {
    try {
      const client = await makeOAuth2Client(userId);
      const creds = JSON.parse(decrypt(master.accessTokenEncrypted)) as Credentials;
      client.setCredentials(creds);
      await client.revokeCredentials();
    } catch (err) {
      console.warn("google revoke failed", err);
    }
  }

  // Clear master tokens, turn everything off.
  await db
    .update(schema.integrations)
    .set({
      status: "disconnected",
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    })
    .where(
      and(
        eq(schema.integrations.userId, userId),
        inArray(schema.integrations.provider, [
          GOOGLE_MASTER_PROVIDER,
          ...GOOGLE_FEATURE_PROVIDERS,
        ]),
      ),
    );
}
