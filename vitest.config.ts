import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Unit-Tests: server/ und tests/electron/ (ohne E2E-Unterordner)
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "tests/electron/**/*.test.ts",
      "tests/electron/**/*.spec.ts",
    ],
    // E2E-Tests laufen ausschließlich über Playwright, nicht über Vitest
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "tests/electron/e2e/**",
    ],
  },
});
