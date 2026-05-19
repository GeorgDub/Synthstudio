/**
 * sim-pattern-sequencer.spec.ts — Sprint-103 Live Step-Sequencer E2E.
 *
 * Setzt voraus: sim_ws_server.py mit chord-autoload auf :8744.
 */

import { test, expect } from "@playwright/test";

test.describe("Sim Step-Sequencer (Sprint-103)", () => {
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

  test("Panel rendert + Steps sind interaktiv", async ({ page }) => {
    const panel = page.getByTestId("step-sequencer-panel");
    await expect(panel).toBeVisible();
    // 16 Step-Buttons
    for (let i = 0; i < 16; i++) {
      await expect(page.getByTestId(`step-${i}`)).toBeVisible();
    }
    // Click Step 0 → pressed
    await page.getByTestId("step-0").click();
    await expect(page.getByTestId("step-0"))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("step-0").click();
    await expect(page.getByTestId("step-0"))
      .toHaveAttribute("aria-pressed", "false");
  });

  test("Presets: 'quarters' setzt 0, 4, 8, 12", async ({ page }) => {
    await page.getByTestId("preset-quarters").click();
    await expect(page.getByTestId("step-0")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("step-4")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("step-8")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("step-12")).toHaveAttribute("aria-pressed", "true");
    // Andere off
    await expect(page.getByTestId("step-1")).toHaveAttribute("aria-pressed", "false");
  });

  test("Play → Note-On-Events fliessen + Stop stoppt", async ({ page }) => {
    // BPM hoch fuer schnellere Tests
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

    await page.evaluate(() => {
      (window as unknown as { __seqNotes: number[] }).__seqNotes = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const d = (e as CustomEvent).detail as { note: number };
        (window as unknown as { __seqNotes: number[] }).__seqNotes.push(d.note);
      });
    });

    await page.getByTestId("seq-play-btn").click();
    await page.waitForTimeout(700);   // BPM 240, 62.5ms/step → ~10 Steps
    await page.getByTestId("seq-stop-btn").click();

    const notes = await page.evaluate(() =>
      (window as unknown as { __seqNotes: number[] }).__seqNotes);
    // Mind. 3 Note-Ons (= 3 Steps gefeuert)
    expect(notes.length).toBeGreaterThanOrEqual(3);
    // Alle sollten root-Note (60) sein (chord disabled by default)
    expect(notes.every((n) => n === 60)).toBe(true);
  });

  test("Mit chord Maj enabled → 3 Note-Ons pro Step", async ({ page }) => {
    // Chord enable + Maj
    await page.getByTestId("chord-enable-toggle").click();
    await page.getByTestId("chord-type-0").click();
    await page.waitForTimeout(300);

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
    // Nur Step 0 aktiv
    await page.getByTestId("step-0").click();

    await page.evaluate(() => {
      (window as unknown as { __chordSeq: number[] }).__chordSeq = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const d = (e as CustomEvent).detail as { note: number };
        (window as unknown as { __chordSeq: number[] }).__chordSeq.push(d.note);
      });
    });

    await page.getByTestId("seq-play-btn").click();
    // Bei 240 BPM und nur Step 0 aktiv: jeden 16-tel ein Trigger,
    // also alle 250ms (62.5ms × 4 Restplatze). Warten 800ms = 3 Trigger.
    await page.waitForTimeout(800);
    await page.getByTestId("seq-stop-btn").click();

    const notes = await page.evaluate(() =>
      (window as unknown as { __chordSeq: number[] }).__chordSeq);
    // Maj-Triade [60, 64, 67] sollte mehrmals erscheinen
    expect(notes).toContain(60);
    expect(notes).toContain(64);
    expect(notes).toContain(67);
  });

  test("Clear-Button resettet alle Steps", async ({ page }) => {
    await page.getByTestId("preset-all").click();
    await page.getByTestId("preset-clear").click();
    for (let i = 0; i < 16; i++) {
      await expect(page.getByTestId(`step-${i}`))
        .toHaveAttribute("aria-pressed", "false");
    }
  });
});
