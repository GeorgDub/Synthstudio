/**
 * sim-audio-fx.spec.ts — Sprint-106 AudioFxPanel E2E.
 *
 * Setzt voraus: Vite dev server :5173 + sim_ws_server.py :8744.
 */

import { test, expect } from "@playwright/test";

test.describe("AudioFxPanel (Sprint-106)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem(
          "synthstudio:license:v1",
          JSON.stringify({
            status: "pro", trialStartedAt: Date.now(),
            licenseKey: "PLAY", activatedEmail: "e2e@test.local",
          }),
        );
        window.localStorage.setItem(
          "synthstudio:welcome:v1",
          JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }),
        );
      } catch { /* */ }
    });
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();
  });

  test("Panel rendert mit allen Controls", async ({ page }) => {
    const panel = page.getByTestId("audio-fx-panel");
    await expect(panel).toBeVisible();
    // Waveform-Buttons
    for (const w of ["sine", "sawtooth", "square", "triangle"]) {
      await expect(page.getByTestId(`fx-wave-${w}`)).toBeVisible();
    }
    // Slider
    for (const id of ["fx-cutoff", "fx-q", "fx-delay-time", "fx-delay-fb", "fx-master"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("Waveform-Click setzt aria-checked", async ({ page }) => {
    await page.getByTestId("fx-wave-sine").click();
    await expect(page.getByTestId("fx-wave-sine"))
      .toHaveAttribute("aria-checked", "true");
    await page.getByTestId("fx-wave-sawtooth").click();
    await expect(page.getByTestId("fx-wave-sawtooth"))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("fx-wave-sine"))
      .toHaveAttribute("aria-checked", "false");
  });

  test("Cutoff-Slider ändert Display-Wert", async ({ page }) => {
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="fx-cutoff"]',
      ) as HTMLInputElement | null;
      if (!slider) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(slider, "8000");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.getByTestId("fx-cutoff-display")).toHaveText("8.0kHz");
  });

  test("Delay Feedback-Slider zeigt Prozent-Format", async ({ page }) => {
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="fx-delay-fb"]',
      ) as HTMLInputElement | null;
      if (!slider) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(slider, "0.5");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.getByTestId("fx-delay-fb-display")).toHaveText("50%");
  });

  test("FX-Settings überleben Reload via localStorage", async ({ page }) => {
    // Cutoff = 2000, Wave = square
    await page.getByTestId("fx-wave-square").click();
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="fx-cutoff"]',
      ) as HTMLInputElement | null;
      if (!slider) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(slider, "2000");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();

    await expect(page.getByTestId("fx-wave-square"))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("fx-cutoff-display")).toHaveText("2.0kHz");
  });

  test("Slider funktionieren auch wenn Audio noch off ist", async ({ page }) => {
    // Audio nicht aktiviert — Slider sollten trotzdem editierbar sein
    // (Settings landen in localStorage, applien sich wenn Audio aktiv wird).
    const slider = page.getByTestId("fx-master");
    await expect(slider).not.toBeDisabled();
  });
});
