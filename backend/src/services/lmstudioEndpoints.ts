import { and, asc, eq } from "drizzle-orm";
import { db, rawDb, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";

rawDb.exec(`
CREATE TABLE IF NOT EXISTS lmstudio_endpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

export const DEFAULT_LMSTUDIO_BASE_URL = "http://localhost:1234/v1";

export type LmstudioEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  isActive: boolean;
  createdAt: string;
};

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) throw new Error("base URL is required");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, "");
  return url;
}

export async function listEndpoints(userId: string): Promise<LmstudioEndpoint[]> {
  const rows = await db
    .select()
    .from(schema.lmstudioEndpoints)
    .where(eq(schema.lmstudioEndpoints.userId, userId))
    .orderBy(asc(schema.lmstudioEndpoints.createdAt));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    baseUrl: r.baseUrl,
    isActive: r.isActive,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

export async function addEndpoint(
  userId: string,
  input: { label: string; baseUrl: string },
): Promise<LmstudioEndpoint> {
  const label = input.label.trim() || "default";
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  const existing = await db
    .select()
    .from(schema.lmstudioEndpoints)
    .where(eq(schema.lmstudioEndpoints.userId, userId));
  const isFirst = existing.length === 0;

  const now = new Date();
  const id = newId("lm");
  await db.insert(schema.lmstudioEndpoints).values({
    id,
    userId,
    label,
    baseUrl,
    isActive: isFirst,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    label,
    baseUrl,
    isActive: isFirst,
    createdAt: now.toISOString(),
  };
}

export async function updateEndpoint(
  userId: string,
  id: string,
  patch: { label?: string; baseUrl?: string },
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.lmstudioEndpoints)
    .where(and(eq(schema.lmstudioEndpoints.userId, userId), eq(schema.lmstudioEndpoints.id, id)));
  if (!row) throw new Error("endpoint not found");

  const next: { label?: string; baseUrl?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.label !== undefined) next.label = patch.label.trim() || row.label;
  if (patch.baseUrl !== undefined) next.baseUrl = normalizeBaseUrl(patch.baseUrl);

  await db
    .update(schema.lmstudioEndpoints)
    .set(next)
    .where(eq(schema.lmstudioEndpoints.id, id));
}

export async function deleteEndpoint(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.lmstudioEndpoints)
    .where(and(eq(schema.lmstudioEndpoints.userId, userId), eq(schema.lmstudioEndpoints.id, id)));
  if (!row) return;

  await db
    .delete(schema.lmstudioEndpoints)
    .where(and(eq(schema.lmstudioEndpoints.userId, userId), eq(schema.lmstudioEndpoints.id, id)));

  if (row.isActive) {
    const [next] = await db
      .select()
      .from(schema.lmstudioEndpoints)
      .where(eq(schema.lmstudioEndpoints.userId, userId))
      .orderBy(asc(schema.lmstudioEndpoints.createdAt));
    if (next) {
      await db
        .update(schema.lmstudioEndpoints)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(schema.lmstudioEndpoints.id, next.id));
    }
  }
}

export async function setActiveEndpoint(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.lmstudioEndpoints)
    .where(and(eq(schema.lmstudioEndpoints.userId, userId), eq(schema.lmstudioEndpoints.id, id)));
  if (!row) throw new Error("endpoint not found");

  const now = new Date();
  await db
    .update(schema.lmstudioEndpoints)
    .set({ isActive: false, updatedAt: now })
    .where(eq(schema.lmstudioEndpoints.userId, userId));
  await db
    .update(schema.lmstudioEndpoints)
    .set({ isActive: true, updatedAt: now })
    .where(eq(schema.lmstudioEndpoints.id, id));
}

export async function getEndpointBaseUrl(userId: string, id: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.lmstudioEndpoints)
    .where(and(eq(schema.lmstudioEndpoints.userId, userId), eq(schema.lmstudioEndpoints.id, id)));
  return row?.baseUrl ?? null;
}

export async function getActiveBaseUrl(userId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.lmstudioEndpoints)
    .where(
      and(
        eq(schema.lmstudioEndpoints.userId, userId),
        eq(schema.lmstudioEndpoints.isActive, true),
      ),
    );
  if (row) return row.baseUrl;
  return DEFAULT_LMSTUDIO_BASE_URL;
}
