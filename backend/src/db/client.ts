import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import * as schema from "./schema.js";

// Tests set CORTEX_DB_PATH to an isolated tmp file so they don't stomp
// the dev database. In-process callers can also pass `:memory:`.
const dbPath = process.env.CORTEX_DB_PATH
  ? path.resolve(process.env.CORTEX_DB_PATH)
  : path.resolve(process.cwd(), "cortex.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;
export { schema };
export type DB = typeof db;
