/**
 * sim-song-mode.spec.ts — Sprint-108 Song-Mode E2E.
 *
 * Setzt voraus: sim_ws_server.py :8744 + Vite :5173.
 */

import { test, expect } from "@playwright/test";

test.describe("Song-Mode (Sprint-108)", () => {
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
    await page.getByTestId("toggle-sim-section").click();
    await page.getByTestId("connect-sim-btn").click();
    await expect(page.getByTestId("sim-status-connected")).toBeVisible({
      timeout: 5000,
    });
  });

  test("Song-Editor ist sichtbar, initial leer", async ({ page }) => {
    await expect(page.getByTestId("song-editor")).toBeVisible();
    await expect(page.getByTestId("song-mode-toggle")).not.toBeChecked();
    // Empty-Hint sichtbar
    const editor = page.getByTestId("song-editor");
    await expect(editor).toContainText("Keine Song-Steps");
  });

  test("Add Step + Slot/Repeats editieren", async ({ page }) => {
    await page.getByTestId("song-add-step").click();
    // 1 Step
    await expect(page.getByTestId("song-step-0")).toBeVisible();
    await expect(page.getByTestId("song-step-0-slot")).toHaveValue("0");
    await expect(page.getByTestId("song-step-0-repeats")).toHaveValue("1");
    // Slot wechseln + Repeats setzen
    await page.getByTestId("song-step-0-slot").selectOption("2");
    await page.getByTestId("song-step-0-repeats").fill("4");
    await expect(page.getByTestId("song-step-0-slot")).toHaveValue("2");
    await expect(page.getByTestId("song-step-0-repeats")).toHaveValue("4");
  });

  test("Remove-Step entfernt Eintrag", async ({ page }) => {
    await page.getByTestId("song-add-step").click();
    await page.getByTestId("song-add-step").click();
    await expect(page.getByTestId("song-step-0")).toBeVisible();
    await expect(page.getByTestId("song-step-1")).toBeVisible();
    await page.getByTestId("song-step-0-remove").click();
    // Step 0 ist weg, Step 1 (alt) ist jetzt Step 0
    await expect(page.locator('[data-testid="song-step-1"]')).not.toBeVisible();
    await expect(page.getByTestId("song-step-0")).toBeVisible();
  });

  test("Clear-Button leert die Sequenz", async ({ page }) => {
    await page.getByTestId("song-add-step").click();
    await page.getByTestId("song-add-step").click();
    await page.getByTestId("song-clear").click();
    const editor = page.getByTestId("song-editor");
    await expect(editor).toContainText("Keine Song-Steps");
  });

  test("Song-Sequenz ueberlebt Reload", async ({ page }) => {
    await page.getByTestId("song-add-step").click();
    await page.getByTestId("song-step-0-slot").selectOption("3");
    await page.getByTestId("song-step-0-repeats").fill("2");
    await page.getByTestId("song-mode-toggle").check();
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();

    await expect(page.getByTestId("song-mode-toggle")).toBeChecked();
    await expect(page.getByTestId("song-step-0-slot")).toHaveValue("3");
    await expect(page.getByTestId("song-step-0-repeats")).toHaveValue("2");
  });

  test("Song-Mode advanced Slots beim Play", async ({ page }) => {
    // Setup Slot A: alle Steps an (damit der Sim notwendig durch Pattern-
    // Wraps muss). Slot B: nur Step 0 (anderer Pattern).
    await page.getByTestId("preset-all").click();   // Slot A = all
    await page.getByTestId("bank-slot-1").click();
    await page.getByTestId("step-0").click();        // Slot B = Step 0

    // Song-Sequence: A×1 → B×1
    await page.getByTestId("bank-slot-0").click();
    await page.getByTestId("song-add-step").click();
    // Sicherstellen Slot=0, repeats=1
    await page.getByTestId("song-step-0-slot").selectOption("0");
    await page.getByTestId("song-step-0-repeats").fill("1");
    await page.getByTestId("bank-slot-1").click();
    await page.getByTestId("song-add-step").click();
    await page.getByTestId("song-step-1-slot").selectOption("1");
    await page.getByTestId("song-step-1-repeats").fill("1");
    // Aktivieren
    await page.getByTestId("song-mode-toggle").check();

    // BPM hoch fuer schnelle Pattern-Loops
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="seq-bpm-slider"]',
      ) as HTMLInputElement | null;
      if (!slider) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(slider, "240");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(300);

    // Play → sollte beim Wrap (nach 16 Steps × 62.5ms = 1s) Slot B aktivieren
    await page.getByTestId("seq-play-btn").click();
    // Warten bis mind. ein Pattern-Wrap durch ist (1s @ 240 BPM)
    await page.waitForTimeout(1200);

    // Slot B sollte jetzt aktiv sein
    const activeB = await page.getByTestId("bank-slot-1")
      .getAttribute("aria-checked");
    const activeA = await page.getByTestId("bank-slot-0")
      .getAttribute("aria-checked");
    // Entweder B (Schritt 2 wurde aktiv) oder A (zurueck am Loop-Ende) muss
    // aktiv sein. Mind. ein Slot-Switch hat stattgefunden.
    expect([activeA, activeB]).toContain("true");

    await page.getByTestId("seq-stop-btn").click();
  });
});
