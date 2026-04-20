import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { newId } from "../lib/ids.js";
import { decrypt, encrypt } from "../lib/crypto.js";

export const GOOGLE_CALENDAR_PROVIDER = "google_calendar";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function googleOAuthConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function makeOAuth2Client(): OAuth2Client {
  if (!googleOAuthConfigured()) {
    throw new Error("google_oauth_not_configured");
  }
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

// Tiny in-memory CSRF store for the OAuth state round-trip. Entries expire
// after 10 minutes. Fine for single-process dev; migrate to Redis with real
// auth.
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

export function getAuthUrl(state: string): string {
  const client = makeOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(code: string): Promise<{
  tokens: Credentials;
  email: string;
}> {
  const client = makeOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email || "unknown@google";
  return { tokens, email };
}

export async function upsertGoogleIntegration(
  userId: string,
  tokens: Credentials,
  email: string,
): Promise<{ id: string }> {
  const now = new Date();
  const payload = JSON.stringify({
    access_token: tokens.access_token ?? null,
    refresh_token: tokens.refresh_token ?? null,
    expiry_date: tokens.expiry_date ?? null,
    token_type: tokens.token_type ?? null,
    scope: tokens.scope ?? null,
  });

  const [existing] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.provider, GOOGLE_CALENDAR_PROVIDER),
      ),
    );

  // Google only returns a refresh_token on first consent. If the user
  // reconnects without prompt=consent we may not get one — preserve the
  // existing refresh token in that case.
  let finalPayload = payload;
  if (existing?.refreshTokenEncrypted && !tokens.refresh_token) {
    const prev = JSON.parse(decrypt(existing.refreshTokenEncrypted)) as Credentials;
    finalPayload = JSON.stringify({
      access_token: tokens.access_token ?? null,
      refresh_token: prev.refresh_token ?? null,
      expiry_date: tokens.expiry_date ?? null,
      token_type: tokens.token_type ?? null,
      scope: tokens.scope ?? null,
    });
  }

  const encryptedPayload = encrypt(finalPayload);

  if (existing) {
    await db
      .update(schema.integrations)
      .set({
        status: "connected",
        detail: email,
        accessTokenEncrypted: encryptedPayload,
        refreshTokenEncrypted: encryptedPayload,
        lastSyncedAt: now,
      })
      .where(eq(schema.integrations.id, existing.id));
    return { id: existing.id };
  }

  const id = newId("in");
  await db.insert(schema.integrations).values({
    id,
    userId,
    provider: GOOGLE_CALENDAR_PROVIDER,
    status: "connected",
    detail: email,
    accessTokenEncrypted: encryptedPayload,
    refreshTokenEncrypted: encryptedPayload,
    lastSyncedAt: now,
  });
  return { id };
}

async function persistRefreshedCreds(
  userId: string,
  integrationId: string,
  merged: Credentials,
): Promise<void> {
  const payload = JSON.stringify({
    access_token: merged.access_token ?? null,
    refresh_token: merged.refresh_token ?? null,
    expiry_date: merged.expiry_date ?? null,
    token_type: merged.token_type ?? null,
    scope: merged.scope ?? null,
  });
  await db
    .update(schema.integrations)
    .set({
      accessTokenEncrypted: encrypt(payload),
      refreshTokenEncrypted: encrypt(payload),
    })
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.id, integrationId),
      ),
    );
}

export async function getAuthedClient(
  userId: string,
): Promise<{ client: OAuth2Client; integrationId: string } | null> {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.provider, GOOGLE_CALENDAR_PROVIDER),
        eq(schema.integrations.status, "connected"),
      ),
    );
  if (!row || !row.accessTokenEncrypted) return null;

  const client = makeOAuth2Client();
  const creds = JSON.parse(decrypt(row.accessTokenEncrypted)) as Credentials;
  client.setCredentials(creds);

  // Google's OAuth2Client emits "tokens" whenever it silently refreshes. Merge
  // and persist so the refresh token isn't lost and we don't re-refresh next
  // call.
  client.on("tokens", (next) => {
    const merged: Credentials = { ...creds, ...next };
    if (!next.refresh_token && creds.refresh_token) merged.refresh_token = creds.refresh_token;
    void persistRefreshedCreds(userId, row.id, merged).catch((err) => {
      console.error("google token persist failed", err);
    });
  });

  return { client, integrationId: row.id };
}

export async function disconnectGoogle(
  userId: string,
  integrationId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, userId),
        eq(schema.integrations.id, integrationId),
      ),
    );
  if (!row) return;

  if (row.provider === GOOGLE_CALENDAR_PROVIDER && row.accessTokenEncrypted) {
    try {
      const client = makeOAuth2Client();
      const creds = JSON.parse(decrypt(row.accessTokenEncrypted)) as Credentials;
      client.setCredentials(creds);
      await client.revokeCredentials();
    } catch (err) {
      // Revoke best-effort: token may already be invalid. Don't block the
      // local clear.
      console.warn("google revoke failed", err);
    }
  }

  await db
    .update(schema.integrations)
    .set({
      status: "disconnected",
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    })
    .where(eq(schema.integrations.id, integrationId));
}
