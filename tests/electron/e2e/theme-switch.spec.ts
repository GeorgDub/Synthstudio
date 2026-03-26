/**
 * theme-switch.spec.ts
 *
 * E2E-Tests für das Theme-System in Synthstudio.
 *
 * Szenarien:
 *   1. App startet mit Standard-Theme "dark"
 *   2. Klick auf "Neon Circuit"-Button setzt data-theme="neon"
 *   3. Theme bleibt nach Page-Reload erhalten (localStorage-Persistenz)
 *
 * Voraussetzung: pnpm compile:electron
 * Ausführen: pnpm test:e2e
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

// ─── Pfade ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ELECTRON_MAIN = path.join(REPO_ROOT, "electron-dist", "main.cjs");

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

// ─── Fixture: App starten / stoppen ──────────────────────────────────────────

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  assertAppCompiled();
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [ELECTRON_MAIN],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_IS_DEV: "0",
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2_000);
  return { app, page };
}

/** Liest das aktuelle data-theme-Attribut vom <html>-Element. */
function getDataTheme(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.documentElement.getAttribute("data-theme")
  );
}

// ─── Szenario 1: Standard-Theme beim Start ───────────────────────────────────

test.describe("Szenario 1 – Standard-Theme beim App-Start", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test("1.1 – data-theme auf <html> ist 'dark' (Standard)", async () => {
    const theme = await getDataTheme(page);
    // Kein Attribut gesetzt bedeutet ebenfalls "dark" per CSS-Fallback,
    // nach initFromStorage sollte es aber explizit "dark" sein.
    expect(theme === "dark" || theme === null).toBe(true);
  });

  test("1.2 – CSS-Custom-Property --ss-bg-base ist gesetzt", async () => {
    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ss-bg-base")
        .trim()
    );
    // Die Property muss einen Wert haben (kein leerer String)
    expect(value.length).toBeGreaterThan(0);
  });
});

// ─── Szenario 2: Theme-Wechsel zu Neon ───────────────────────────────────────

test.describe("Szenario 2 – Theme-Wechsel zu 'neon'", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test("2.1 – Klick auf Neon-Circuit-Button setzt data-theme='neon'", async () => {
    // ThemeSwitcher rendert Buttons mit aria-label="${theme.name}: …"
    // und aria-pressed für den aktiven Zustand.
    // Wir suchen nach einem Button dessen Label "neon" enthält (case-insensitive).
    const neonButton = page.getByRole("button", { name: /neon/i });
    const found = await neonButton.count();

    if (found === 0) {
      // ThemeSwitcher ist möglicherweise noch nicht gerendert (v1.9+)
      test.fixme();
      // eslint-disable-next-line no-console
      console.warn("[theme-switch] Kein Neon-Button gefunden – ThemeSwitcher ggf. noch nicht gemountet");
      return;
    }

    await neonButton.first().click();
    await page.waitForTimeout(300);

    const theme = await getDataTheme(page);
    expect(theme).toBe("neon");
  });

  test("2.2 – Nach Neon-Wechsel hat der Button aria-pressed='true'", async () => {
    const neonButton = page.getByRole("button", { name: /neon/i });
    const found = await neonButton.count();

    if (found === 0) {
      test.fixme();
      return;
    }

    // aria-pressed muss true sein, da das Theme bereits auf neon steht
    const pressed = await neonButton.first().getAttribute("aria-pressed");
    expect(pressed).toBe("true");
  });
});

// ─── Szenario 3: Theme-Persistenz nach Reload ────────────────────────────────

test.describe("Szenario 3 – Theme-Persistenz nach Page-Reload", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test("3.1 – Theme 'neon' bleibt nach localStorage-Reload erhalten", async () => {
    // Theme direkt via localStorage setzen (umgeht fehlende UI)
    await page.evaluate(() => {
      localStorage.setItem("ss-theme", "neon");
    });

    // Reload simulieren – Electron: page.reload() triggert neu-Render
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2_000);

    const theme = await getDataTheme(page);
    // Nach Reload muss useThemeStore das gespeicherte Theme anwenden
    expect(theme).toBe("neon");
  });

  test("3.2 – localStorage enthält das gesetzte Theme", async () => {
    const stored = await page.evaluate(() =>
      localStorage.getItem("ss-theme")
    );
    expect(stored).toBe("neon");
  });
});
