/**
 * tests/web/esx-import.spec.ts
 *
 * Playwright-Smoke für den ESX-Import-Einstieg in der DrumMachine-Toolbar.
 * Der volle Datei→Dialog-Flow (Parsen einer echten .esx) ist headless zu schwer;
 * hier wird nur verifiziert, dass Button + verstecktes File-Input vorhanden sind.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedActivation } from "./_seedApp";

async function openDrumMachine(page: Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
}

test.describe("ESX-Import Toolbar-Einstieg", () => {
  test("Button + File-Input vorhanden, akzeptiert .esx", async ({ page }) => {
    await openDrumMachine(page);

    const btn = page.getByTestId("esx-import-open");
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).toContainText("Korg Import");

    const input = page.getByTestId("esx-import-input");
    await expect(input).toHaveAttribute("type", "file");
    await expect(input).toHaveAttribute("accept", /\.esx/);
  });
});
