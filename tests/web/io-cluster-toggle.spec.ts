/**
 * io-cluster-toggle.spec.ts — v3.268
 *
 * Die selten genutzten Import/Export-Buttons (MIDI/FLP/Electribe/KORG/E2/Slice)
 * sind in ein einklappbares "I/O"-Cluster gewandert (Toolbar beruhigen). Test
 * sichert: standardmäßig eingeklappt, Toggle öffnet/schließt, und die hidden
 * File-Inputs bleiben IMMER im DOM (Drag-&-Drop-Refs müssen valide bleiben).
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("synthstudio:license:v1", JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }));
      window.localStorage.setItem("synthstudio:welcome:v1", JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }));
    } catch { /* */ }
  });
});

test("I/O-Cluster: eingeklappt by default, Toggle öffnet/schließt", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

  const toggle = page.getByTestId("io-cluster-toggle");
  await expect(toggle).toBeVisible();
  // Default: eingeklappt.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("flp-import")).toBeHidden();
  // Hidden File-Input bleibt im DOM (Drag-&-Drop-Ref valide).
  expect(await page.getByTestId("slice-sample-input").count()).toBe(1);

  // Aufklappen.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("flp-import")).toBeVisible();
  await expect(page.getByTestId("electribe-import")).toBeVisible();
  await expect(page.getByTestId("slice-sample")).toBeVisible();

  // Wieder einklappen.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("flp-import")).toBeHidden();
});
