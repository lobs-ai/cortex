import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { env } from "../env.js";
import * as schema from "./schema.js";

// SQLite dev fallback. The design doc targets Postgres; swap the driver
// (drizzle-orm/node-postgres) once DATABASE_URL points at Postgres.
const dbPath = path.resolve(process.cwd(), "cortex.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;
export { schema };
export type DB = typeof db;

// Note: DATABASE_URL=${env.DATABASE_URL} — Postgres target left wired via
// drizzle.config.ts; local dev uses cortex.db for zero-setup onboarding.
void env;
