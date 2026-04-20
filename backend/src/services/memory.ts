import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export async function listPreferences(userId: string) {
  const rows = await db
    .select()
    .from(schema.preferencesExplicit)
    .where(eq(schema.preferencesExplicit.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: safeJson(r.valueJson),
    source: r.source,
    confidence: r.confidence,
  }));
}

export async function listTendencies(userId: string) {
  const rows = await db
    .select()
    .from(schema.tendenciesLearned)
    .where(eq(schema.tendenciesLearned.userId, userId))
    .orderBy(desc(schema.tendenciesLearned.confidence));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    evidence: r.evidenceCount,
    confidence: r.confidence,
    status: r.status,
    lastSeen: r.lastObservedAt,
    type: r.tendencyType,
  }));
}

export async function patchTendency(
  userId: string,
  id: string,
  input: { status?: string; text?: string },
) {
  const updates: Partial<typeof schema.tendenciesLearned.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.status !== undefined) updates.status = input.status;
  if (input.text !== undefined) updates.text = input.text;
  await db
    .update(schema.tendenciesLearned)
    .set(updates)
    .where(and(eq(schema.tendenciesLearned.userId, userId), eq(schema.tendenciesLearned.id, id)));
}

export async function deleteMemoryItem(userId: string, id: string) {
  await db
    .delete(schema.memoryItems)
    .where(and(eq(schema.memoryItems.userId, userId), eq(schema.memoryItems.id, id)));
}

export async function listIntegrations(userId: string) {
  const rows = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    status: r.status,
    detail: r.detail,
    lastSyncedAt: r.lastSyncedAt,
  }));
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
