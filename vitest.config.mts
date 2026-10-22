import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    environment: "node",
    // Source-scanning guard tests read every file under src/ and can exceed 5s on busy CI runners.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
      "server-only": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./tests/server-only.ts"),
    },
  },
});
