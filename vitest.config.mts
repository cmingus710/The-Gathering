import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
