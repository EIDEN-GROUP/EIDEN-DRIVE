import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // `server-only` throws outside a Next server bundle; stub it for unit tests.
      "server-only": `${root}/tests/stubs/server-only.ts`
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000
  }
});
