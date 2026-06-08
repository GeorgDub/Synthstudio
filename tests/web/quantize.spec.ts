/**
 * tests/web/quantize.spec.ts
 *
 * Playwright Smoke-Tests für die Quantize-Buttons in der DrumMachine.
 *
 * Regression: TASK-104 / BUG-005 – Klick auf einen Quantize-Button (Q: 1/8,
 * 1/16, 1/32) crashte die ganze Seite (TypeError beim Zugriff auf
 * result[finalIdx].active wenn pt.steps.length < pattern.stepCount).
 *
 * Der Test stellt sicher dass:
 *   1. Die Quantize-Buttons sichtbar sind
 *   2. Klicks darauf KEINE Page-Errors auslösen
 *   3. Die App nach dem Klick noch interaktiv ist
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByRole("tab", { name: "Sequencer" }).click();
});

// Die Q-Buttons identifizieren wir per title-Attribut (eindeutig und stabil)
function quantizeBtn(page: import("@playwright/test").Page, grid: "1/8" | "1/16" | "1/32") {
  return page.locator(`button[title^="Quantize auf ${grid}"]`);
}

test.describe("Quantize-Buttons (TASK-104 / BUG-005)", () => {
  test("Quantize-Buttons sind in der Toolbar sichtbar", async ({ page }) => {
    // Die drei Quantize-Grid-Buttons (1/8, 1/16, 1/32) erscheinen sobald
    // ein Part aktiv ist (Default-Pattern: erster Part bereits aktiv).
    for (const grid of ["1/8", "1/16", "1/32"] as const) {
      await expect(quantizeBtn(page, grid)).toBeVisible({ timeout: 10_000 });
    }
  });

  test("regression: Klick auf Quantize 1/16 crasht die Seite nicht", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const btn = quantizeBtn(page, "1/16");
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();

    // Kurz warten damit React mögliche Errors propagiert
    await page.waitForTimeout(250);

    // Die Page muss interaktiv bleiben (Tab-Bar weiterhin sichtbar)
    await expect(page.getByRole("tablist")).toBeVisible();

    // Keine unhandled Page-Errors durch den Click
    const quantizeRelated = pageErrors.filter((e) =>
      /quantiz|Cannot read prop|undefined/i.test(e.message),
    );
    expect(quantizeRelated).toEqual([]);
  });

  test("regression: alle drei Quantize-Grids hintereinander klickbar ohne Crash", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    for (const grid of ["1/8", "1/16", "1/32"] as const) {
      const btn = quantizeBtn(page, grid);
      await expect(btn).toBeVisible();
      await btn.click();
      await page.waitForTimeout(120);
    }

    // App lebt noch
    await expect(page.getByRole("tablist")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
