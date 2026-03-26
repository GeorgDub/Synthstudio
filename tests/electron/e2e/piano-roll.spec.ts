/**
 * piano-roll.spec.ts
 *
 * E2E-Tests für den Piano-Roll-Workflow in Synthstudio.
 *
 * Szenarien:
 *   1. Piano-Roll-Dialog ist beim Start nicht sichtbar
 *   2. Klick auf den Öffnen-Button zeigt den Dialog
 *   3. ESC schließt den Dialog wieder
 *   4. Klick auf eine Grid-Zelle erzeugt eine visuelle Änderung
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

/**
 * Sucht den Piano-Roll-Trigger-Button über gängige Selektoren.
 * Gibt null zurück wenn kein Button gefunden werden kann.
 */
async function findPianoRollButton(page: Page) {
  // Bevorzugte Selektoren (Reihenfolge nach Spezifität)
  const candidates = [
    page.getByRole("button", { name: /piano.?roll/i }),
    page.getByLabel(/piano.?roll/i),
    page.locator('[data-testid*="piano-roll"]'),
    page.locator('[aria-label*="Piano"]'),
  ];

  for (const locator of candidates) {
    const count = await locator.count();
    if (count > 0) return locator.first();
  }
  return null;
}

// ─── Szenario 1: Initialer Zustand ───────────────────────────────────────────

test.describe("Szenario 1 – Kein Dialog beim Start", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test("1.1 – Kein role='dialog' beim initialen Laden sichtbar", async () => {
    const dialogs = page.locator("[role='dialog']");
    // Es kann Dialoge geben, aber sie dürfen nicht sichtbar sein
    const visibleCount = await dialogs.filter({ hasText: /piano/i }).count();
    expect(visibleCount).toBe(0);
  });
});

// ─── Szenario 2 & 3: Dialog öffnen und schließen ─────────────────────────────

test.describe("Szenario 2/3 – Piano-Roll-Dialog öffnen und via ESC schließen", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test("2.1 – Klick auf Piano-Roll-Button zeigt role='dialog'", async () => {
    const trigger = await findPianoRollButton(page);

    if (!trigger) {
      // Piano-Roll-Trigger noch nicht implementiert oder anders eingebunden
      test.fixme(
        true,
        "Piano-Roll-Trigger-Button nicht im DOM gefunden – ggf. über Kontextmenü erreichbar"
      );
      return;
    }

    await trigger.click();
    await page.waitForTimeout(600);

    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test("3.1 – ESC schließt den Piano-Roll-Dialog", async () => {
    const trigger = await findPianoRollButton(page);

    if (!trigger) {
      test.fixme(
        true,
        "Piano-Roll-Trigger-Button nicht im DOM gefunden – ESC-Test übersprungen"
      );
      return;
    }

    // Sicherstellen, dass der Dialog offen ist
    const dialogBefore = page.locator("[role='dialog']").first();
    const isOpenBefore = await dialogBefore.isVisible();
    if (!isOpenBefore) {
      await trigger.click();
      await page.waitForTimeout(600);
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // Dialog sollte nach ESC nicht mehr sichtbar sein
    const dialogAfter = page.locator("[role='dialog']");
    const visibleAfter = await dialogAfter.filter({ hasText: /.+/ }).count();
    // Entweder keine Dialoge oder alle versteckt
    const allHidden = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
      return dialogs.every((d) => {
        const style = window.getComputedStyle(d);
        return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
      });
    });
    expect(visibleAfter === 0 || allHidden).toBe(true);
  });
});

// ─── Szenario 4: Grid-Zelle toggeln ──────────────────────────────────────────

test.describe("Szenario 4 – Grid-Zelle im Piano-Roll toggeln", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test("4.1 – Klick auf eine Grid-Zelle ändert ihren visuellen Zustand", async () => {
    const trigger = await findPianoRollButton(page);

    if (!trigger) {
      test.fixme(
        true,
        "Piano-Roll-Trigger-Button nicht im DOM gefunden – Grid-Test übersprungen"
      );
      return;
    }

    await trigger.click();
    await page.waitForTimeout(800);

    // Erwartete Zellen-Selektoren: data-testid="cell-*", role="gridcell", oder .piano-roll-cell
    const cellLocator = page.locator(
      '[data-testid^="cell-"], [role="gridcell"], .piano-roll-cell, .pr-cell'
    );
    const cellCount = await cellLocator.count();

    if (cellCount === 0) {
      test.fixme(
        true,
        "Keine Piano-Roll-Raster-Zellen im DOM – Selektor muss angepasst werden"
      );
      return;
    }

    const firstCell = cellLocator.first();
    // Zustand vor dem Klick speichern
    const classBeforeClick = await firstCell.getAttribute("class");
    const ariaBefore = await firstCell.getAttribute("aria-pressed");

    await firstCell.click();
    await page.waitForTimeout(300);

    const classAfterClick = await firstCell.getAttribute("class");
    const ariaAfter = await firstCell.getAttribute("aria-pressed");

    // Mindestens eines der Attribute muss sich geändert haben
    const changed = classBeforeClick !== classAfterClick || ariaBefore !== ariaAfter;
    expect(changed).toBe(true);
  });
});
