import { and, eq } from "drizzle-orm";
import { db, rawDb, schema } from "../db/client.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";

// Per-user integration config (client IDs, secrets, PATs, bot tokens, …).
// Values are AES-256-GCM encrypted before write. Never return raw values
// from any HTTP handler — use maskFields() for reads.
//
// Auto-migrate so users who already ran db:push on an older schema don't
// hit "no such table" on first request. Safe no-op if already present.
rawDb.exec(`
CREATE TABLE IF NOT EXISTS integration_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  field TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, provider, field)
);
CREATE INDEX IF NOT EXISTS idx_integration_configs_lookup
  ON integration_configs (user_id, provider, field);
`);

export async function getConfig(
  userId: string,
  provider: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(schema.integrationConfigs)
    .where(
      and(
        eq(schema.integrationConfigs.userId, userId),
        eq(schema.integrationConfigs.provider, provider),
      ),
    );
  const out: Record<string, string> = {};
  for (const r of rows) {
    try {
      out[r.field] = decrypt(r.valueEncrypted);
    } catch {
      // Bad ciphertext (e.g. ENCRYPTION_KEY changed). Skip rather than crash.
    }
  }
  return out;
}

export async function getConfigField(
  userId: string,
  provider: string,
  field: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.integrationConfigs)
    .where(
      and(
        eq(schema.integrationConfigs.userId, userId),
        eq(schema.integrationConfigs.provider, provider),
        eq(schema.integrationConfigs.field, field),
      ),
    );
  if (!row) return null;
  try {
    return decrypt(row.valueEncrypted);
  } catch {
    return null;
  }
}

// fields: `null` means delete that key; empty string also deletes (so the UI
// can clear a field by submitting a blank input).
export async function setConfig(
  userId: string,
  provider: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const now = new Date();
  for (const [field, rawValue] of Object.entries(fields)) {
    const value = rawValue == null ? null : rawValue.trim();
    const [existing] = await db
      .select()
      .from(schema.integrationConfigs)
      .where(
        and(
          eq(schema.integrationConfigs.userId, userId),
          eq(schema.integrationConfigs.provider, provider),
          eq(schema.integrationConfigs.field, field),
        ),
      );

    if (!value) {
      if (existing) {
        await db
          .delete(schema.integrationConfigs)
          .where(eq(schema.integrationConfigs.id, existing.id));
      }
      continue;
    }

    const encrypted = encrypt(value);
    if (existing) {
      await db
        .update(schema.integrationConfigs)
        .set({ valueEncrypted: encrypted, updatedAt: now })
        .where(eq(schema.integrationConfigs.id, existing.id));
    } else {
      await db.insert(schema.integrationConfigs).values({
        id: newId("ic"),
        userId,
        provider,
        field,
        valueEncrypted: encrypted,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

export async function clearConfig(userId: string, provider: string): Promise<void> {
  await db
    .delete(schema.integrationConfigs)
    .where(
      and(
        eq(schema.integrationConfigs.userId, userId),
        eq(schema.integrationConfigs.provider, provider),
      ),
    );
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return "•".repeat(trimmed.length);
  if (trimmed.length <= 12) return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

// Return a masked view of stored fields, safe to return from HTTP handlers.
export async function describeConfig(
  userId: string,
  provider: string,
): Promise<Record<string, { present: true; masked: string; length: number }>> {
  const cfg = await getConfig(userId, provider);
  const out: Record<string, { present: true; masked: string; length: number }> = {};
  for (const [k, v] of Object.entries(cfg)) {
    out[k] = { present: true, masked: maskSecret(v), length: v.length };
  }
  return out;
}
