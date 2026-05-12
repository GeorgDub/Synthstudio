/**
 * tests/web/close-buttons.spec.ts
 *
 * Playwright Smoke-Tests für Phase O.2 – Universal Close-Buttons.
 * Verifiziert dass alle modalen DrumMachine-Panels einen × Button haben + ESC schließt.
 */
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByRole("tab", { name: "Sequencer" }).click();
});

test.describe("Universal Close-Buttons", () => {
  test("Envelope Follower Panel hat × Close-Button", async ({ page }) => {
    await page.locator('button[title="Envelope Follower"]').click();
    await expect(page.getByText("Envelope Follower").first()).toBeVisible();
    // × Button mit aria-label "Schließen"
    const closeBtn = page.getByRole("button", { name: "Schließen" }).first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    // Panel sollte geschlossen sein – + Follower Button weg
    await expect(page.getByRole("button", { name: /\+ Follower/i })).toHaveCount(0);
  });

  test("Pattern Morph Panel hat × Close-Button", async ({ page }) => {
    await page.locator('button[title="Pattern Morph"]').click();
    const closeBtn = page.getByRole("button", { name: "Schließen" }).first();
    await expect(closeBtn).toBeVisible();
  });

  test("Note Repeat Panel hat × Close-Button", async ({ page }) => {
    await page.locator('button[title="Note Repeat (MPC-Style)"]').click();
    const closeBtn = page.getByRole("button", { name: "Schließen" }).first();
    await expect(closeBtn).toBeVisible();
  });

  test("ESC schließt ein offenes Panel", async ({ page }) => {
    await page.locator('button[title="Envelope Follower"]').click();
    await expect(page.getByRole("button", { name: /\+ Follower/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /\+ Follower/i })).toHaveCount(0);
  });
});
