import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

/**
 * Regression for BUG-002 — BPM +/- buttons UX
 *
 * Before v1.18.2: buttons had onClick handlers but `hover:bg-bg-elevated`
 * equalled the default `bg-bg-elevated` → zero visible feedback. Users
 * thought the buttons did nothing and assumed they were just decorative
 * indicators for the keyboard shortcuts.
 *
 * After v1.18.2: buttons get hover background swap (bg-elevated → bg-base),
 * hover text swap (text-muted → text-primary), active:scale-95 + title +
 * aria-label.
 */
test.describe("BPM +/- buttons (BUG-002)", () => {
  test.beforeEach(async ({ page }) => {
    await seedActivation(page);
    await page.goto("/");
    await page.waitForSelector('button[aria-label="BPM verringern"]', { timeout: 10_000 });
  });

  test("minus button has accessible label + tooltip", async ({ page }) => {
    const minus = page.getByRole("button", { name: "BPM verringern" });
    await expect(minus).toBeVisible();
    await expect(minus).toHaveAttribute("title", /BPM −1/);
  });

  test("plus button has accessible label + tooltip", async ({ page }) => {
    const plus = page.getByRole("button", { name: "BPM erhöhen" });
    await expect(plus).toBeVisible();
    await expect(plus).toHaveAttribute("title", /BPM \+1/);
  });

  test("clicking + actually increments BPM", async ({ page }) => {
    const bpmInput = page.locator('input[type="number"][min="20"][max="300"]').first();
    const before = parseInt(await bpmInput.inputValue());
    await page.getByRole("button", { name: "BPM erhöhen" }).click();
    await expect(bpmInput).toHaveValue(String(before + 1));
  });

  test("clicking − actually decrements BPM", async ({ page }) => {
    const bpmInput = page.locator('input[type="number"][min="20"][max="300"]').first();
    const before = parseInt(await bpmInput.inputValue());
    await page.getByRole("button", { name: "BPM verringern" }).click();
    await expect(bpmInput).toHaveValue(String(before - 1));
  });

  test("buttons show visible hover feedback (background changes)", async ({ page }) => {
    const minus = page.getByRole("button", { name: "BPM verringern" });
    const bgBefore = await minus.evaluate(el => getComputedStyle(el).backgroundColor);
    await minus.hover();
    await page.waitForTimeout(200);
    const bgHover = await minus.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgHover).not.toBe(bgBefore);
  });
});
