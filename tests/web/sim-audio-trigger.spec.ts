/**
 * sim-audio-trigger.spec.ts — Sprint-102 Note-Trigger E2E.
 *
 * Setzt voraus: sim_ws_server.py mit chord-autoload auf :8744.
 *
 * Verifiziert:
 *   - Trigger-Section ist im UI sichtbar
 *   - Audio-Toggle wechselt State
 *   - Click "Trigger" schickt Note-On → Sim antwortet (default: passthrough)
 *     → Browser empfaengt omnitribe:noteOn-Event
 *   - Mit chord enabled+Maj kommen 3 noteOn-Events zurueck
 */

import { test, expect } from "@playwright/test";

test.describe("Sim Audio-Trigger (Sprint-102)", () => {
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

  test("Audio-Toggle wechselt State", async ({ page }) => {
    const toggle = page.getByTestId("sim-audio-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Click — jsdom hat keine AudioContext, aber click sollte nicht crashen
    // und im echten Chromium funktioniert die echte AudioContext.
    await toggle.click();
    // Chromium hat eine echte AudioContext → sollte auf "On" wechseln
    await expect(toggle).toHaveAttribute("aria-pressed", "true",
                                          { timeout: 2000 });
  });

  test("Trigger-Button schickt Note-On und Browser empfaengt Echo", async ({ page }) => {
    // Inject a listener im Window damit wir die Events von der Bridge
    // empfangen koennen.
    await page.evaluate(() => {
      (window as unknown as { __noteOns: number[] }).__noteOns = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const detail = (e as CustomEvent).detail as { note: number };
        (window as unknown as { __noteOns: number[] }).__noteOns.push(detail.note);
      });
    });

    // Default-Note 60, Trigger-Button klicken
    await page.getByTestId("sim-trigger-chord").click();
    // Warten bis Note-On-Event ankommt (passthrough — chord disabled by default)
    await page.waitForTimeout(300);

    const notes = await page.evaluate(() => {
      return (window as unknown as { __noteOns: number[] }).__noteOns;
    });
    expect(notes).toContain(60);
  });

  test("Mit chord enabled+Maj kommen 3 Note-Ons zurueck", async ({ page }) => {
    // Listener installieren
    await page.evaluate(() => {
      (window as unknown as { __chordNotes: number[] }).__chordNotes = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const detail = (e as CustomEvent).detail as { note: number };
        (window as unknown as { __chordNotes: number[] }).__chordNotes.push(detail.note);
      });
    });

    // chord-Setup via existierende ChordPanel-UI (gleicher Bridge-Singleton
    // wie Trigger-Button). Maj (id=0) ist bereits Default selected, also
    // nur Enable-Toggle drücken.
    const enableToggle = page.getByTestId("chord-enable-toggle");
    await expect(enableToggle).toBeVisible();
    await enableToggle.click();
    // Maj-Button (chord-type-0) explizit klicken um sicher zu sein
    await page.getByTestId("chord-type-0").click();
    await page.waitForTimeout(300);   // throttle drain

    // Trigger
    await page.getByTestId("sim-trigger-chord").click();
    await page.waitForTimeout(600);

    const notes = await page.evaluate(() => {
      return (window as unknown as { __chordNotes: number[] }).__chordNotes;
    });
    console.log("Captured notes:", JSON.stringify(notes));
    expect(notes).toContain(60);
    expect(notes).toContain(64);
    expect(notes).toContain(67);
  });
});
