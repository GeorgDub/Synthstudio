/**
 * sim-step-cursor.spec.ts — Sprint-104 Live-Cursor + per-Step-Velocity E2E.
 *
 * Setzt voraus: sim_ws_server.py mit chord-autoload auf :8744.
 */

import { test, expect } from "@playwright/test";

test.describe("Sim Step-Cursor + Velocity (Sprint-104)", () => {
  test.beforeEach(async ({ page }) => {
    // KEIN localStorage.clear() — Playwright gibt jedem Test eine fresh
    // BrowserContext, also brauchen wir das nicht. clear() im addInitScript
    // wuerde auf jedem reload feuern und Pattern-Persistence-Test brechen.
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

  test("Live-Cursor: aktueller Step bekommt data-current='true' waehrend Play", async ({ page }) => {
    // High BPM fuer schnelle Steps
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="seq-bpm-slider"]',
      ) as HTMLInputElement | null;
      if (slider) {
        slider.value = "240";
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.getByTestId("preset-all").click();

    await page.getByTestId("seq-play-btn").click();
    await page.waitForTimeout(500);

    // Mindestens einer der 16 Steps sollte data-current="true" haben
    const currentSteps = await page.evaluate(() => {
      const allSteps = document.querySelectorAll('[data-testid^="step-"]');
      return Array.from(allSteps).filter((el) =>
        el.getAttribute("data-current") === "true",
      ).length;
    });
    expect(currentSteps).toBeGreaterThanOrEqual(1);

    await page.getByTestId("seq-stop-btn").click();
    await page.waitForTimeout(150);

    // Nach Stop: kein Step mehr current
    const currentAfterStop = await page.evaluate(() => {
      const allSteps = document.querySelectorAll('[data-testid^="step-"]');
      return Array.from(allSteps).filter((el) =>
        el.getAttribute("data-current") === "true",
      ).length;
    });
    expect(currentAfterStop).toBe(0);
  });

  test("Velocity-Bar erscheint nur fuer aktive Steps", async ({ page }) => {
    await page.getByTestId("step-3").click();
    // Step 3 hat velocity-bar
    await expect(page.getByTestId("step-3-vel-bar")).toBeVisible();
    // Step 0 (inactive) hat keinen
    const bar0 = await page.locator('[data-testid="step-0-vel-bar"]').count();
    expect(bar0).toBe(0);
  });

  test("Shift+Click erhoeht Velocity sichtbar (Bar-Hoehe)", async ({ page }) => {
    await page.getByTestId("step-2").click();
    // Initial vel = 100, bar height = ~78%
    const bar = page.getByTestId("step-2-vel-bar");
    const initialHeight = await bar.evaluate(
      (el) => (el as HTMLElement).style.height,
    );
    // 3× Shift-Click = +24 velocity (von 100 → 124)
    for (let i = 0; i < 3; i++) {
      await page.getByTestId("step-2").click({ modifiers: ["Shift"] });
    }
    const afterHeight = await bar.evaluate(
      (el) => (el as HTMLElement).style.height,
    );
    expect(parseFloat(afterHeight)).toBeGreaterThan(parseFloat(initialHeight));
  });

  test("Alt+Click senkt Velocity", async ({ page }) => {
    await page.getByTestId("step-5").click();
    const bar = page.getByTestId("step-5-vel-bar");
    const initialHeight = await bar.evaluate(
      (el) => (el as HTMLElement).style.height,
    );
    for (let i = 0; i < 5; i++) {
      await page.getByTestId("step-5").click({ modifiers: ["Alt"] });
    }
    const afterHeight = await bar.evaluate(
      (el) => (el as HTMLElement).style.height,
    );
    expect(parseFloat(afterHeight)).toBeLessThan(parseFloat(initialHeight));
  });

  test("Pattern ueberlebt Reload via localStorage", async ({ page }) => {
    // Steps setzen
    await page.getByTestId("preset-quarters").click();
    // BPM-Slider via React-kompatibler native value setter
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="seq-bpm-slider"]',
      ) as HTMLInputElement | null;
      if (!slider) return;
      const proto = window.HTMLInputElement.prototype as unknown as {
        __lookupSetter__: (key: string) => ((v: string) => void) | undefined;
      };
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(slider, "150");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(300);

    // Reload
    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();

    // Step 0 muss noch aktiv sein
    await expect(page.getByTestId("step-0"))
      .toHaveAttribute("aria-pressed", "true", { timeout: 3000 });
    await expect(page.getByTestId("step-4"))
      .toHaveAttribute("aria-pressed", "true");
    // BPM auf 150
    await expect(page.getByTestId("seq-bpm-display")).toHaveText("150");
  });

  test("Per-step Velocity wird live durch chord-fan-out propagiert", async ({ page }) => {
    // Chord enable + Maj
    await page.getByTestId("chord-enable-toggle").click();
    await page.getByTestId("chord-type-0").click();
    await page.waitForTimeout(200);

    // Step 0 aktiv, Velocity auf 30 senken (sehr leise — gut messbar)
    await page.getByTestId("step-0").click();
    for (let i = 0; i < 10; i++) {
      await page.getByTestId("step-0").click({ modifiers: ["Alt"] });
    }
    // velocity = 100 - 10*8 = 20

    // BPM hoch
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="seq-bpm-slider"]',
      ) as HTMLInputElement | null;
      if (slider) {
        slider.value = "240";
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);

    // Sniff noteOn-Events mit velocity
    await page.evaluate(() => {
      (window as unknown as { __velCheck: number[] }).__velCheck = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const d = (e as CustomEvent).detail as { velocity: number };
        (window as unknown as { __velCheck: number[] }).__velCheck.push(d.velocity);
      });
    });

    await page.getByTestId("seq-play-btn").click();
    await page.waitForTimeout(700);
    await page.getByTestId("seq-stop-btn").click();

    const velocities = await page.evaluate(() =>
      (window as unknown as { __velCheck: number[] }).__velCheck,
    );
    // Mind. 3 Note-Ons gefeuert
    expect(velocities.length).toBeGreaterThanOrEqual(3);
    // Alle Note-Ons sollten velocity 20 haben
    expect(velocities.every((v) => v === 20)).toBe(true);
  });
});
