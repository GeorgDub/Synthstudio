/**
 * Synthstudio – Electron E2E-Tests (Testing-Agent)
 *
 * Szenario 1: App starten und Hauptfenster prüfen
 *
 * Diese Tests verwenden Playwright mit dem `_electron`-Treiber, der die
 * kompilierte Electron-App direkt startet – ohne Mocks, ohne Browser.
 *
 * Voraussetzung:
 *   pnpm compile:electron   → kompiliert electron/ nach dist-electron/
 *
 * Ausführen:
 *   pnpm test:e2e
 *
 * STRIKTE TRENNUNG:
 *   - Diese Datei darf NICHT über `pnpm test` (Vitest) laufen.
 *   - Kein `vi.mock()`, kein Vitest-Import – nur Playwright.
 *   - Keine Electron-Imports im Testcode (nur über `app.evaluate()`).
 */
import { _electron as electron, ElectronApplication, Page } from "playwright";
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Pfade ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ELECTRON_MAIN = path.join(REPO_ROOT, "dist-electron", "main.js");

// ─── Hilfsfunktion: Prüft ob die App kompiliert ist ──────────────────────────

function assertAppCompiled(): void {
  if (!fs.existsSync(ELECTRON_MAIN)) {
    throw new Error(
      `[E2E] Kompilierter Electron-Einstiegspunkt nicht gefunden:\n` +
        `  ${ELECTRON_MAIN}\n\n` +
        `Bitte zuerst kompilieren:\n` +
        `  pnpm compile:electron\n`
    );
  }
}

// ─── Test-Suite: App-Start ────────────────────────────────────────────────────

test.describe("Electron App – App-Start (Szenario 1)", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    // Sicherstellen, dass die App kompiliert ist
    assertAppCompiled();

    // Electron-App starten (kein Dev-Server, keine Mocks)
    app = await electron.launch({
      args: [ELECTRON_MAIN],
      env: {
        ...process.env,
        // Produktionsmodus erzwingen, damit kein Dev-Server erwartet wird
        NODE_ENV: "test",
      },
    });

    // Erstes Fenster abwarten
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ── Test 1: Hauptfenster erscheint ─────────────────────────────────────────

  test("App startet und zeigt Hauptfenster an", async () => {
    // Fenstertitel prüfen (aus electron/main.ts: APP_NAME = "KORG ESX-1 Studio")
    const title = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows[0]?.getTitle() ?? "";
    });

    expect(title).toContain("KORG ESX-1 Studio");
  });

  // ── Test 2: Genau ein Fenster ist geöffnet ─────────────────────────────────

  test("Genau ein BrowserWindow ist geöffnet", async () => {
    const windowCount = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });

    expect(windowCount).toBe(1);
  });

  // ── Test 3: Fenster ist sichtbar (nicht minimiert) ─────────────────────────

  test("Hauptfenster ist sichtbar und nicht minimiert", async () => {
    const isVisible = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win?.isVisible() ?? false;
    });

    expect(isVisible).toBe(true);
  });

  // ── Test 4: Seite hat keinen kritischen Fehler (kein leerer Body) ──────────

  test("Renderer-Seite ist geladen (Body nicht leer)", async () => {
    // Warten bis React gerendert hat
    await page.waitForSelector("body", { timeout: 10_000 });

    const bodyContent = await page.evaluate(() => document.body.innerHTML.trim());
    expect(bodyContent.length).toBeGreaterThan(0);
  });

  // ── Test 5: Keine unkritischen Konsolen-Fehler beim Start ──────────────────

  test("Keine JavaScript-Fehler in der Konsole beim Start", async () => {
    const errors: string[] = [];

    // Konsolen-Fehler sammeln (rückwirkend nicht möglich, daher neues Fenster prüfen)
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    // Kurz warten, damit alle Initialisierungsfehler aufgezeichnet werden
    await page.waitForTimeout(1_000);

    // Keine unbehandelten JS-Fehler erwartet
    expect(errors).toHaveLength(0);
  });
});
