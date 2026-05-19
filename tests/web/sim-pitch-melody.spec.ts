/**
 * sim-pitch-melody.spec.ts — Sprint-105 Per-Step-Pitch E2E.
 *
 * Setzt voraus: sim_ws_server.py mit chord-autoload auf :8744.
 */

import { test, expect } from "@playwright/test";

test.describe("Sim Pitch-Offset Melodie (Sprint-105)", () => {
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

  test("Pitch-Inputs sind im UI vorhanden + initial 0", async ({ page }) => {
    for (let i = 0; i < 16; i++) {
      const input = page.getByTestId(`pitch-${i}`);
      await expect(input).toBeVisible();
      await expect(input).toHaveValue("0");
    }
  });

  test("Pitch-Input setzen aendert Wert im UI", async ({ page }) => {
    const input = page.getByTestId("pitch-3");
    await input.fill("7");
    await input.blur();
    await expect(input).toHaveValue("7");
  });

  test("Pitch-Offset clamped auf [-24..+24]", async ({ page }) => {
    const input = page.getByTestId("pitch-0");
    // input min/max ist HTML-Attribut + JS-Logic clampt zusaetzlich
    await input.fill("50");
    await input.blur();
    // Value im DOM kann beliebig sein, aber state ist clamped — wir
    // pruefen via localStorage statt UI direkt.
    await page.waitForTimeout(100);
    const cached = await page.evaluate(() => {
      const raw = window.localStorage.getItem("synthstudio:omnitribe.pattern.v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(cached?.pitchOffsets[0]).toBeLessThanOrEqual(24);
  });

  test("Melodie-Pattern: 4 Steps, je eigene Pitch → 4 unterschiedliche Notes", async ({ page }) => {
    // Setup: 4 Steps aktiv mit verschiedenen Pitch-Offsets
    await page.getByTestId("step-0").click();
    await page.getByTestId("step-1").click();
    await page.getByTestId("step-2").click();
    await page.getByTestId("step-3").click();

    // Pitch: 0, 4, 7, 12 (Maj-arpeggio)
    await page.getByTestId("pitch-0").fill("0");
    await page.getByTestId("pitch-1").fill("4");
    await page.getByTestId("pitch-2").fill("7");
    await page.getByTestId("pitch-3").fill("12");
    // Blur fuer onChange
    await page.getByTestId("pitch-3").blur();
    await page.waitForTimeout(300);

    // BPM hoch fuer schnelle Reproduktion
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
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      (window as unknown as { __melody: number[] }).__melody = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const d = (e as CustomEvent).detail as { note: number };
        (window as unknown as { __melody: number[] }).__melody.push(d.note);
      });
    });

    await page.getByTestId("seq-play-btn").click();
    // 4 steps × 62.5ms = 250ms — wir warten 700ms damit mind. eine
    // ganze Iteration durch ist auch mit WS-Latency.
    await page.waitForTimeout(700);
    await page.getByTestId("seq-stop-btn").click();

    const notes = await page.evaluate(() =>
      (window as unknown as { __melody: number[] }).__melody,
    );
    // Mindestens 60, 64, 67, 72 in der Sequenz
    expect(notes).toContain(60);
    expect(notes).toContain(64);
    expect(notes).toContain(67);
    expect(notes).toContain(72);
  });

  test("Pitch-Offset propagiert durch Chord-Fan-Out", async ({ page }) => {
    // Chord enable + Maj
    await page.getByTestId("chord-enable-toggle").click();
    await page.getByTestId("chord-type-0").click();
    await page.waitForTimeout(200);

    // Step 0 aktiv mit pitch +7 (G)
    await page.getByTestId("step-0").click();
    await page.getByTestId("pitch-0").fill("7");
    await page.getByTestId("pitch-0").blur();
    await page.waitForTimeout(300);

    // BPM hoch
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
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      (window as unknown as { __chord: number[] }).__chord = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const d = (e as CustomEvent).detail as { note: number };
        (window as unknown as { __chord: number[] }).__chord.push(d.note);
      });
    });

    await page.getByTestId("seq-play-btn").click();
    await page.waitForTimeout(500);
    await page.getByTestId("seq-stop-btn").click();

    const notes = await page.evaluate(() =>
      (window as unknown as { __chord: number[] }).__chord,
    );
    // Maj-Triad ab G (67): [67, 71, 74]
    expect(notes).toContain(67);
    expect(notes).toContain(71);
    expect(notes).toContain(74);
  });

  test("Pitch-Werte ueberleben Reload via localStorage", async ({ page }) => {
    await page.getByTestId("step-5").click();
    await page.getByTestId("pitch-5").fill("3");
    await page.getByTestId("pitch-5").blur();
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();

    await expect(page.getByTestId("pitch-5")).toHaveValue("3");
  });
});
