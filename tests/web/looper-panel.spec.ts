/**
 * tests/web/looper-panel.spec.ts (TASK-235-UI / v2.87)
 *
 * Playwright-Smoke für das LooperPanel-UI-Wiring:
 *
 *   - Toggle-Button "⟲ Loop" in DrumMachine-Toolbar öffnet das Panel
 *   - 4 Loop-Pads sind sichtbar (data-testid="looper-pad-{0..3}")
 *   - Jeder Pad hat einen zugehörigen Channel-Picker
 *     (data-testid="looper-channel-picker-{0..3}")
 *   - Channel-Picker zeigt mindestens "Master" als Option
 *   - Click auf Pad triggert die State-Machine-Transition (kein Crash)
 *   - Default-State der Pads ist "empty" (data-loop-state="empty")
 *
 * Strategie:
 *   - Wir seeden Live-Inputs in localStorage, damit der Picker mehr als
 *     nur "Master" zu wählen hat.
 *   - DrumMachine ist Default-Tab, der Toggle-Button ist direkt klickbar.
 */
import { test, expect, type Page } from "@playwright/test";

const LIVE_INPUT_SEED = [
  {
    id: "liveinput:test-1",
    name: "KORG Electribe",
    deviceId: null,
    volume: 0.5,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    latencyCompensationMs: 0,
    recordArmed: false,
  },
  {
    id: "liveinput:test-2",
    name: "Volca Beats",
    deviceId: null,
    volume: 0.5,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    latencyCompensationMs: 0,
    recordArmed: false,
  },
];

async function seedLiveInputs(page: Page) {
  await page.addInitScript((channels) => {
    try {
      window.localStorage.setItem(
        "synthstudio:liveinputs:v1",
        JSON.stringify(channels),
      );
    } catch {
      /* ignore */
    }
  }, LIVE_INPUT_SEED);
}

async function openLooperPanel(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  const toggle = page.getByTestId("toggle-looper-panel");
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();
}

test.describe("Live-Looper UI (TASK-235-UI)", () => {
  test.beforeEach(async ({ page }) => {
    await seedLiveInputs(page);
  });

  test("Toggle öffnet das LooperPanel mit 4 Pads + 4 Channel-Pickern", async ({ page }) => {
    await openLooperPanel(page);

    const panel = page.getByTestId("looper-panel");
    await expect(panel).toBeVisible();

    for (let i = 0; i < 4; i++) {
      const pad = page.getByTestId(`looper-pad-${i}`);
      await expect(pad).toBeVisible();
      // Default-State sollte "empty" sein
      await expect(pad).toHaveAttribute("data-loop-state", "empty");

      const picker = page.getByTestId(`looper-channel-picker-${i}`);
      await expect(picker).toBeVisible();
    }
  });

  test("Channel-Picker enthält Master + alle Live-Inputs als Optionen", async ({ page }) => {
    await openLooperPanel(page);

    const picker = page.getByTestId("looper-channel-picker-0");
    await expect(picker).toBeVisible();

    // Verifiziere alle Options auf dem ersten Picker
    const optionTexts = await picker.locator("option").allTextContents();
    expect(optionTexts).toContain("Master");
    expect(optionTexts).toContain("KORG Electribe");
    expect(optionTexts).toContain("Volca Beats");
  });

  test("Channel-Picker-Auswahl persistiert in useLooperStore", async ({ page }) => {
    await openLooperPanel(page);

    const picker = page.getByTestId("looper-channel-picker-0");
    await picker.selectOption("liveinput:test-1");

    // Verifiziere via localStorage-Snapshot (useLooperStore persistiert nach
    // jedem setSourceChannel automatisch).
    const persisted = await page.evaluate(() => {
      try {
        return window.localStorage.getItem("synthstudio:looper:v1");
      } catch { return null; }
    });
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].sourceChannelId).toBe("liveinput:test-1");
  });

  test("Klick auf Pad triggert State-Machine ohne Crash", async ({ page }) => {
    await openLooperPanel(page);

    const pad0 = page.getByTestId("looper-pad-0");
    await expect(pad0).toHaveAttribute("data-loop-state", "empty");

    // Click triggert AudioEngine.triggerLoop — in der jsdom-Test-Umgebung
    // ohne AudioContext bleibt der State zwar oft "empty" (kein Output-Node),
    // aber der Click darf KEIN Uncaught-Error werfen.
    await pad0.click();

    // Pad bleibt sichtbar (keine Exception hat das Rendering zerstört).
    await expect(pad0).toBeVisible();
  });
});
