import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

// Set CORTEX_DB_PATH to a per-test-file tmp file BEFORE importing any
// module that touches the DB. Each vitest fork imports modules fresh, so
// this only needs to run once per test file (at the very top).
//
// Usage:
//   import "./helpers/tempDb";   // must be first import
//   import { db, schema } from "../src/db/client.js";
//
// A deterministic ENCRYPTION_KEY is also set so ciphertext is stable in
// tests that need to round-trip it.

if (!process.env.CORTEX_DB_PATH) {
  const dir = mkdtempSync(path.join(tmpdir(), "cortex-test-"));
  const name = `cortex-${randomBytes(4).toString("hex")}.db`;
  process.env.CORTEX_DB_PATH = path.join(dir, name);
}
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "test-encryption-key-32-bytes-ok!";
}
