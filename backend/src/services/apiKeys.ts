import { and, asc, eq } from "drizzle-orm";
import { db, rawDb, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { PROVIDERS, type ProviderId } from "../ai/registry.js";

rawDb.exec(`
CREATE TABLE IF NOT EXISTS provider_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  key_encrypted TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

export type StoredKey = {
  id: string;
  provider: ProviderId;
  label: string;
  masked: string;
  isActive: boolean;
  createdAt: string;
};

const PROVIDER_IDS = new Set(PROVIDERS.filter((p) => p.requiresApiKey).map((p) => p.id));

function mask(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export async function listKeys(userId: string): Promise<StoredKey[]> {
  const rows = await db
    .select()
    .from(schema.providerApiKeys)
    .where(eq(schema.providerApiKeys.userId, userId))
    .orderBy(asc(schema.providerApiKeys.provider), asc(schema.providerApiKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider as ProviderId,
    label: r.label,
    masked: mask(r.keyEncrypted),
    isActive: r.isActive,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

export async function addKey(
  userId: string,
  input: { provider: ProviderId; label: string; key: string },
): Promise<StoredKey> {
  if (!PROVIDER_IDS.has(input.provider)) {
    throw new Error(`provider ${input.provider} does not take an API key`);
  }
  const key = input.key.trim();
  if (!key) throw new Error("key is required");
  const label = input.label.trim() || "default";

  const existing = await db
    .select()
    .from(schema.providerApiKeys)
    .where(
      and(
        eq(schema.providerApiKeys.userId, userId),
        eq(schema.providerApiKeys.provider, input.provider),
      ),
    );
  const isFirst = existing.length === 0;

  const now = new Date();
  const id = newId("ak");
  await db.insert(schema.providerApiKeys).values({
    id,
    userId,
    provider: input.provider,
    label,
    keyEncrypted: key,
    isActive: isFirst,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    provider: input.provider,
    label,
    masked: mask(key),
    isActive: isFirst,
    createdAt: now.toISOString(),
  };
}

export async function deleteKey(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.providerApiKeys)
    .where(
      and(eq(schema.providerApiKeys.userId, userId), eq(schema.providerApiKeys.id, id)),
    );
  if (!row) return;

  await db
    .delete(schema.providerApiKeys)
    .where(
      and(eq(schema.providerApiKeys.userId, userId), eq(schema.providerApiKeys.id, id)),
    );

  if (row.isActive) {
    const [next] = await db
      .select()
      .from(schema.providerApiKeys)
      .where(
        and(
          eq(schema.providerApiKeys.userId, userId),
          eq(schema.providerApiKeys.provider, row.provider),
        ),
      )
      .orderBy(asc(schema.providerApiKeys.createdAt));
    if (next) {
      await db
        .update(schema.providerApiKeys)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(schema.providerApiKeys.id, next.id));
    }
  }
}

export async function setActiveKey(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.providerApiKeys)
    .where(
      and(eq(schema.providerApiKeys.userId, userId), eq(schema.providerApiKeys.id, id)),
    );
  if (!row) throw new Error("key not found");

  const now = new Date();
  await db
    .update(schema.providerApiKeys)
    .set({ isActive: false, updatedAt: now })
    .where(
      and(
        eq(schema.providerApiKeys.userId, userId),
        eq(schema.providerApiKeys.provider, row.provider),
      ),
    );
  await db
    .update(schema.providerApiKeys)
    .set({ isActive: true, updatedAt: now })
    .where(eq(schema.providerApiKeys.id, id));
}

export async function getActiveKey(userId: string, provider: ProviderId): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.providerApiKeys)
    .where(
      and(
        eq(schema.providerApiKeys.userId, userId),
        eq(schema.providerApiKeys.provider, provider),
        eq(schema.providerApiKeys.isActive, true),
      ),
    );
  if (row) return row.keyEncrypted;

  const entry = PROVIDERS.find((p) => p.id === provider);
  if (entry?.keyEnvVar) {
    const envVal = process.env[entry.keyEnvVar];
    if (envVal) return envVal;
  }
  return null;
}

export async function countKeysPerProvider(userId: string): Promise<Record<string, number>> {
  const rows = await db
    .select()
    .from(schema.providerApiKeys)
    .where(eq(schema.providerApiKeys.userId, userId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.provider] = (out[r.provider] ?? 0) + 1;
  return out;
}
