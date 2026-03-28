/**
 * Playwright-Konfiguration für Electron E2E-Tests (Testing-Agent)
 *
 * Strikte Trennung von Unit-Tests (Vitest) und E2E-Tests (Playwright):
 * - Unit-Tests: `pnpm test`  → vitest, tests/electron/**\/*.test.ts
 * - E2E-Tests:  `pnpm test:e2e` → playwright, tests/electron/e2e/**
 *
 * Voraussetzung: Die Electron-App muss zuvor kompiliert worden sein:
 *   pnpm compile:electron
 */
import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  // Nur E2E-Tests in tests/electron/e2e/
  testDir: path.resolve("tests/electron/e2e"),
  testMatch: "**/*.ts",

  // Timeout für den App-Start (Electron braucht etwas länger)
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },

  // Kein Parallelismus für Electron-Tests (ein Prozess pro Test-Suite)
  workers: 1,
  fullyParallel: false,

  // Reporter
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  // Kein Browser-Projekt nötig – Electron startet seinen eigenen Chromium
  projects: [
    {
      name: "electron",
      use: {},
    },
  ],
});
