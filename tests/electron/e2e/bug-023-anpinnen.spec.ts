/**
 * tests/electron/e2e/bug-023-anpinnen.spec.ts
 *
 * Reproduziert BUG-023 (Anpinnen verschwindet ohne wiederzukehren) in einer
 * echten Electron-Instanz und prüft was in crash.log landet.
 *
 * Workflow:
 *   1. App starten
 *   2. Mixer-Popup öffnen (via IPC window:open-mixer)
 *   3. Mixer-Popup schließen (via IPC window:close-mixer) — simuliert Anpinnen
 *   4. crash.log auslesen + Events sammeln
 *   5. Verifizieren ob popup-closed-received vom Renderer eintrifft
 *
 * Ausgabe: Log-Sequenz zwischen popup:destroy-manual und nächstem heartbeat
 * wird in den Test-Output geschrieben (sichtbar in CI + lokal).
 */
import { _electron as electron, ElectronApplication, Page } from "playwright";
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ELECTRON_MAIN = path.join(REPO_ROOT, "electron-dist", "main.cjs");

test.describe("BUG-023 – Anpinnen Mixer-Popup Log-Trace", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    if (!fs.existsSync(ELECTRON_MAIN)) {
      throw new Error("Electron not compiled. Run: pnpm compile:electron");
    }
    // Eigener userData-Dir damit der Test nicht mit laufenden Synthstudio-
    // Instanzen kollidiert (cache-lock-Konflikte)
    const tmpUserData = path.join(REPO_ROOT, "test-results", `electron-userdata-${Date.now()}`);
    fs.mkdirSync(tmpUserData, { recursive: true });
    app = await electron.launch({
      executablePath: require("electron"),
      args: [ELECTRON_MAIN, `--user-data-dir=${tmpUserData}`],
      env: { ...process.env, NODE_ENV: "test", ELECTRON_IS_DEV: "0" },
    });
    (globalThis as { __testUserData?: string }).__testUserData = tmpUserData;
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    // Warten bis Renderer voll gemountet ist
    await page.waitForTimeout(3_000);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test("Mixer-Popup öffnen → schließen → Log-Trace prüfen", async () => {
    // 1. crash.log-Pfad ermitteln
    const logPath = await app.evaluate(async ({ app }) => {
      const userData = app.getPath("userData");
      return userData;
    });
    const crashLogFile = path.join(logPath, "crash.log");
    console.log("\n=== crash.log path ===");
    console.log(crashLogFile);
    console.log("");

    // 2. Position im Log merken VOR der Aktion
    const startSize = fs.existsSync(crashLogFile) ? fs.statSync(crashLogFile).size : 0;

    // 3a. Erst auf Mixer-Tab gehen
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[role="tab"], button'));
      const mixerTab = buttons.find(b => /^mixer$/i.test((b.textContent ?? "").trim()));
      (mixerTab as HTMLElement | undefined)?.click();
    });
    await page.waitForTimeout(500);

    const initialState = await page.evaluate(() => ({
      workspaceMode: localStorage.getItem("ss-workspace-mode:v1"),
      activeTab: localStorage.getItem("ss-layout:active-tab"),
      hasReattachBtn: !!document.querySelector('[data-testid="mixer-reattach"]'),
      hasPinBtn: !!document.querySelector('[data-testid="mixer-open-in-window"]'),
    }));
    console.log("\n=== Initial UI state (before open) ===");
    console.log(JSON.stringify(initialState, null, 2));

    // 3b. Renderer triggert das Öffnen via electronAPI
    await page.evaluate(() => {
      const api = (window as Window & { electronAPI?: { openMixerWindow?: () => Promise<unknown> } }).electronAPI;
      api?.openMixerWindow?.();
    });

    // Warten bis das Popup-Fenster erscheint
    await page.waitForTimeout(2_500);
    const popupOpened = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().length
    );
    console.log("Windows after open:", popupOpened);
    expect(popupOpened).toBeGreaterThanOrEqual(2); // main + popup

    // Warten bis das Popup gemountet hat und request-state geschickt hat
    await page.waitForTimeout(2_000);

    const stateAfterOpen = await page.evaluate(() => ({
      hasReattachBtn: !!document.querySelector('[data-testid="mixer-reattach"]'),
      hasPinBtn: !!document.querySelector('[data-testid="mixer-open-in-window"]'),
    }));
    console.log("\n=== UI state after popup open ===");
    console.log(JSON.stringify(stateAfterOpen, null, 2));

    // 4. Anpinnen simulieren (im POPUP → closeMixerWindow)
    const popupPage = (await app.windows()).find(p => p !== page);
    if (popupPage) {
      console.log("Found popup page, triggering close...");
      await popupPage.evaluate(() => {
        const api = (window as Window & { electronAPI?: { closeMixerWindow?: () => Promise<unknown> } }).electronAPI;
        api?.closeMixerWindow?.();
      });
    } else {
      console.log("No popup page found, falling back to main close trigger");
      await page.evaluate(() => {
        const api = (window as Window & { electronAPI?: { closeMixerWindow?: () => Promise<unknown> } }).electronAPI;
        api?.closeMixerWindow?.();
      });
    }

    // Warten bis Close-Sequenz fertig ist
    await page.waitForTimeout(2_000);

    const stateAfterClose = await page.evaluate(() => ({
      hasReattachBtn: !!document.querySelector('[data-testid="mixer-reattach"]'),
      hasPinBtn: !!document.querySelector('[data-testid="mixer-open-in-window"]'),
    }));
    console.log("\n=== UI state AFTER popup close ===");
    console.log(JSON.stringify(stateAfterClose, null, 2));
    console.log("KERNFRAGE: hasReattachBtn sollte FALSE sein, hasPinBtn sollte TRUE sein");

    const windowsAfterClose = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().length
    );
    console.log("Windows after close:", windowsAfterClose);

    // 5. Log-Auszug seit Test-Start lesen + ausgeben
    if (fs.existsSync(crashLogFile)) {
      const fullLog = fs.readFileSync(crashLogFile, "utf-8");
      const newPart = fullLog.slice(startSize);
      console.log("\n=== crash.log NEW EVENTS ===");
      console.log(newPart || "(no new events)");
      console.log("=== END ===\n");

      // Asserts
      expect(newPart).toContain("popup:destroy-manual");
      expect(newPart).toContain("popup:closed-notify");
      expect(newPart).toContain("popup:closed");

      // KERNFRAGE: kommt das renderer-event an?
      const hasRendererEvent = newPart.includes("popup-closed-received");
      console.log("hasRendererEvent (popup-closed-received):", hasRendererEvent);

      // Soft assertion — wir wollen wissen, nicht failen
      if (!hasRendererEvent) {
        console.log("⚠ Renderer event MISSING — IPC was sent but not received");
      } else {
        console.log("✓ Renderer event RECEIVED — state propagation works");
      }
    } else {
      console.log("crash.log not found at:", crashLogFile);
    }
  });
});
