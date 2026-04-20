import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import {
  DEFAULT_ROLE_CONFIG,
  PROVIDERS,
  ROLES,
  type RoleId,
  type ProviderId,
} from "../ai/registry.js";
import { countKeysPerProvider } from "./apiKeys.js";

export type RoleConfig = { provider: ProviderId; model: string };
export type Settings = Record<RoleId, RoleConfig>;

const KEY_PREFIX = "llm.role.";
const keyFor = (role: RoleId) => `${KEY_PREFIX}${role}`;

export async function getSettings(userId: string): Promise<Settings> {
  const rows = await db
    .select()
    .from(schema.preferencesExplicit)
    .where(eq(schema.preferencesExplicit.userId, userId));

  const out: Settings = { ...DEFAULT_ROLE_CONFIG };
  for (const r of rows) {
    if (!r.key.startsWith(KEY_PREFIX)) continue;
    const role = r.key.slice(KEY_PREFIX.length) as RoleId;
    if (!(role in out)) continue;
    try {
      const parsed = JSON.parse(r.valueJson) as Partial<RoleConfig>;
      if (parsed && typeof parsed === "object" && parsed.provider && parsed.model) {
        out[role] = { provider: parsed.provider as ProviderId, model: parsed.model };
      }
    } catch {
      // ignore malformed
    }
  }
  return out;
}

export async function setRoleConfig(userId: string, role: RoleId, cfg: RoleConfig) {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(schema.preferencesExplicit)
    .where(
      and(
        eq(schema.preferencesExplicit.userId, userId),
        eq(schema.preferencesExplicit.key, keyFor(role)),
      ),
    );
  if (existing) {
    await db
      .update(schema.preferencesExplicit)
      .set({ valueJson: JSON.stringify(cfg), updatedAt: now })
      .where(eq(schema.preferencesExplicit.id, existing.id));
  } else {
    await db.insert(schema.preferencesExplicit).values({
      id: newId("pr"),
      userId,
      key: keyFor(role),
      valueJson: JSON.stringify(cfg),
      source: "user",
      confidence: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function getRegistry(userId: string) {
  const stored = await countKeysPerProvider(userId);
  return {
    providers: PROVIDERS.map((p) => {
      const envPresent = p.keyEnvVar ? Boolean(process.env[p.keyEnvVar]) : false;
      const storedCount = stored[p.id] ?? 0;
      return {
        id: p.id,
        label: p.label,
        requiresApiKey: p.requiresApiKey,
        keyEnvVar: p.keyEnvVar,
        keyPresent: !p.requiresApiKey || envPresent || storedCount > 0,
        storedKeyCount: storedCount,
        models: p.models,
      };
    }),
    roles: ROLES.map((r) => ({ id: r.id, label: r.label, note: r.note })),
  };
}

export async function getRoleModel(userId: string, role: RoleId): Promise<RoleConfig> {
  const settings = await getSettings(userId);
  return settings[role];
}
