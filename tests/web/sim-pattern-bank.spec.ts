/**
 * sim-pattern-bank.spec.ts — Sprint-107 Pattern-Bank E2E.
 *
 * Setzt voraus: sim_ws_server.py auf :8744 + Vite :5173.
 */

import { test, expect } from "@playwright/test";

test.describe("Pattern-Bank Slot-Switching (Sprint-107)", () => {
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

  test("8 Bank-Slots A..H sind sichtbar, Slot A initial aktiv", async ({ page }) => {
    for (let i = 0; i < 8; i++) {
      const slot = page.getByTestId(`bank-slot-${i}`);
      await expect(slot).toBeVisible();
    }
    await expect(page.getByTestId("bank-slot-0"))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("bank-slot-1"))
      .toHaveAttribute("aria-checked", "false");
  });

  test("Click auf Slot B macht ihn aktiv, Slot A inaktiv", async ({ page }) => {
    await page.getByTestId("bank-slot-1").click();
    await expect(page.getByTestId("bank-slot-1"))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("bank-slot-0"))
      .toHaveAttribute("aria-checked", "false");
  });

  test("Slot-Edits sind unabhaengig", async ({ page }) => {
    // Slot A: aktiviere Steps 0, 4, 8, 12
    await page.getByTestId("preset-quarters").click();
    await expect(page.getByTestId("step-0"))
      .toHaveAttribute("aria-pressed", "true");

    // Wechsel zu Slot B
    await page.getByTestId("bank-slot-1").click();
    // Slot B ist leer
    await expect(page.getByTestId("step-0"))
      .toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("step-4"))
      .toHaveAttribute("aria-pressed", "false");

    // Slot B: aktiviere Step 7
    await page.getByTestId("step-7").click();
    await expect(page.getByTestId("step-7"))
      .toHaveAttribute("aria-pressed", "true");

    // Zurueck zu Slot A → quarters sind noch da, Step 7 nicht
    await page.getByTestId("bank-slot-0").click();
    await expect(page.getByTestId("step-0"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("step-7"))
      .toHaveAttribute("aria-pressed", "false");
  });

  test("Slot-Inhalt-Indikator: leere vs gefuellte Slots", async ({ page }) => {
    // Slot A fuellen
    await page.getByTestId("preset-quarters").click();
    // Slot B aktivieren — A wird inaktiv und sollte Indikator (•) zeigen
    await page.getByTestId("bank-slot-1").click();
    const slotA = page.getByTestId("bank-slot-0");
    // Der Indikator (•) ist nur sichtbar wenn nicht-aktiv UND Steps vorhanden
    const aText = await slotA.textContent();
    expect(aText).toContain("•");
    // Slot C (kein Inhalt) hat keinen Punkt
    const slotC = page.getByTestId("bank-slot-2");
    const cText = await slotC.textContent();
    expect(cText).not.toContain("•");
  });

  test("Bank ueberlebt Reload, activeSlot persistiert", async ({ page }) => {
    // Slot C waehlen und Steps setzen
    await page.getByTestId("bank-slot-2").click();
    await page.getByTestId("step-3").click();
    await page.getByTestId("step-11").click();
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();

    // Slot C ist noch aktiv
    await expect(page.getByTestId("bank-slot-2"))
      .toHaveAttribute("aria-checked", "true");
    // Steps 3 + 11 sind aktiviert
    await expect(page.getByTestId("step-3"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("step-11"))
      .toHaveAttribute("aria-pressed", "true");
  });

  test("Slot-Wechsel pushed alle Step-States zum Sim", async ({ page }) => {
    // Slot A: alle Steps off (default)
    // Slot B: alle Steps on
    await page.getByTestId("bank-slot-1").click();
    await page.getByTestId("preset-all").click();
    await page.waitForTimeout(150);

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

    // Listener installieren
    await page.evaluate(() => {
      (window as unknown as { __notes: number[] }).__notes = [];
      window.addEventListener("omnitribe:noteOn", (e) => {
        const d = (e as CustomEvent).detail as { note: number };
        (window as unknown as { __notes: number[] }).__notes.push(d.note);
      });
    });

    // Play in Slot B
    await page.getByTestId("seq-play-btn").click();
    await page.waitForTimeout(400);
    await page.getByTestId("seq-stop-btn").click();

    const notesInB = await page.evaluate(() =>
      (window as unknown as { __notes: number[] }).__notes,
    );
    expect(notesInB.length).toBeGreaterThan(2);

    // Wechsel zu Slot A (alles leer) — Reset listener
    await page.getByTestId("bank-slot-0").click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      (window as unknown as { __notes: number[] }).__notes = [];
    });

    await page.getByTestId("seq-play-btn").click();
    await page.waitForTimeout(400);
    await page.getByTestId("seq-stop-btn").click();

    const notesInA = await page.evaluate(() =>
      (window as unknown as { __notes: number[] }).__notes,
    );
    // Slot A ist leer → kein Note-On erwartet
    expect(notesInA.length).toBe(0);
  });
});
