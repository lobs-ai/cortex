import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

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

export async function recordPreference(
  userId: string,
  input: { key: string; value: unknown; source?: string; confidence?: number },
) {
  const key = input.key.trim();
  if (!key) throw new Error("preference key is required");
  // Reserved namespace for LLM role/model configuration — not agent-writable.
  if (key.startsWith("llm.role.")) {
    throw new Error(`preference key "${key}" is reserved`);
  }

  const now = new Date();
  const valueJson = JSON.stringify(input.value ?? null);
  const source = input.source ?? "agent";
  const confidence = clamp01(input.confidence ?? 0.8);

  const [existing] = await db
    .select()
    .from(schema.preferencesExplicit)
    .where(
      and(
        eq(schema.preferencesExplicit.userId, userId),
        eq(schema.preferencesExplicit.key, key),
      ),
    );

  if (existing) {
    await db
      .update(schema.preferencesExplicit)
      .set({ valueJson, source, confidence, updatedAt: now })
      .where(eq(schema.preferencesExplicit.id, existing.id));
    return { id: existing.id, key, value: input.value, source, confidence, updated: true };
  }

  const id = newId("pr");
  await db.insert(schema.preferencesExplicit).values({
    id,
    userId,
    key,
    valueJson,
    source,
    confidence,
    createdAt: now,
    updatedAt: now,
  });
  return { id, key, value: input.value, source, confidence, updated: false };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.8;
  return Math.max(0, Math.min(1, n));
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
