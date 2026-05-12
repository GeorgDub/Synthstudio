/**
 * Playwright-Konfiguration für Web-App E2E-Tests
 *
 * Startet automatisch den Vite-Dev-Server und führt Tests gegen http://localhost:5173
 * in Chromium aus (kein Electron-Build nötig).
 *
 * Ausführen:
 *   pnpm test:web
 */
import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: path.resolve("tests/web"),
  testMatch: "**/*.spec.ts",

  timeout: 30_000,
  expect: { timeout: 10_000 },

  workers: 1,
  fullyParallel: false,

  reporter: [["list"]],

  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    trace: "on-first-retry",
  },

  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
