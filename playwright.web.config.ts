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

/**
 * ── TASK-262: headless-untaugliche Specs env-gaten ───────────────────────────
 *
 * Diese 11 Specs timeouten in headless Chromium (30s), weil sie Laufzeit-
 * Infrastruktur brauchen, die in CI fehlt:
 *   - echtes Web-Audio-Output (LUFS/Audio-Events: arp-playback, automix-panel,
 *     sim-audio-trigger), bzw.
 *   - einen WebSocket-Sim-Loopback (sim-*, omnitribe-sim-*: der Dominant-Fehler
 *     ist `getByTestId("sim-status-connected")` not visible), bzw.
 *   - License-Polish-Flows die ebenfalls vom Sim/Audio-Stack abhängen.
 *
 * Sie werden NICHT gelöscht. Stattdessen:
 *   - CI_HEADLESS=1  → diese 11 werden via `testIgnore` ausgeschlossen
 *                      (= deterministisch grüner, blocking CI-Pfad).
 *   - CI_AUDIO_ONLY=1 → es laufen NUR diese 11 (dedizierter, non-blocking
 *                       Coverage-Job in CI, continue-on-error).
 *   - kein Flag       → ALLES läuft wie bisher (lokal + voller Lauf).
 *
 * Single source of truth ist das Array unten — niemals separat in der
 * Workflow-YAML duplizieren. Glob-Patterns matchen gegen den absoluten
 * Datei-Pfad, daher `** /`-Präfix.
 */
const HEADLESS_INCOMPATIBLE_SPECS = [
  "**/sim-step-cursor.spec.ts",
  "**/sim-song-mode.spec.ts",
  "**/sim-pitch-melody.spec.ts",
  "**/sim-pattern-bank.spec.ts",
  "**/sim-pattern-sequencer.spec.ts",
  "**/sim-audio-trigger.spec.ts",
  "**/license-polish.spec.ts",
  "**/omnitribe-sim-streams.spec.ts",
  "**/omnitribe-sim-connect.spec.ts",
  "**/arp-playback.spec.ts",
  "**/automix-panel.spec.ts",
];

const isHeadlessCi = process.env.CI_HEADLESS === "1";
const isAudioOnly = process.env.CI_AUDIO_ONLY === "1";

export default defineConfig({
  testDir: path.resolve("tests/web"),

  // CI_AUDIO_ONLY=1: NUR die 11 headless-untauglichen Specs laufen (dedizierter
  //   non-blocking Coverage-Job). sonst: alle *.spec.ts.
  testMatch: isAudioOnly ? HEADLESS_INCOMPATIBLE_SPECS : "**/*.spec.ts",

  // CI_HEADLESS=1: die 11 headless-untauglichen Specs ausschließen (blocking-Pfad grün).
  // sonst: nichts ignorieren (volle Coverage lokal + im Audio-Job).
  testIgnore: isHeadlessCi ? HEADLESS_INCOMPATIBLE_SPECS : [],

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
