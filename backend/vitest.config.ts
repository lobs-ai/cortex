import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file gets its own DB file (see test/helpers/tempDb.ts) —
    // run them in separate processes so the module-scoped `db` singleton
    // in src/db/client.ts doesn't leak across files.
    pool: "forks",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
