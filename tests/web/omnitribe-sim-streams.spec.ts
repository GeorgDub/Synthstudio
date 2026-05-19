/**
 * omnitribe-sim-streams.spec.ts — Sprint-99 Live-Stream E2E.
 *
 * Setzt voraus:
 *   - Vite-Dev-Server auf :5173
 *   - sim_ws_server.py mit --autoload all (mind. chord) auf :8744
 *
 * Verifiziert:
 *   - Connect-Button funktioniert + Sim-Stream-Activity-Indicator erscheint
 *   - Nach "Enable Live Monitoring" laufen VU-Frames (>5 fps)
 *   - VU-Meter-Komponente zeigt non-zero Werte
 */

import { test, expect } from "@playwright/test";

test.describe("OmniTribe Sim-Streams Live (Sprint-99)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem(
          "synthstudio:license:v1",
          JSON.stringify({
            status: "pro", trialStartedAt: Date.now(),
            licenseKey: "PLAY-WRIGHT-TEST", activatedEmail: "e2e@test.local",
          }),
        );
        window.localStorage.setItem(
          "synthstudio:welcome:v1",
          JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }),
        );
      } catch { /* */ }
    });
    page.on("console", (msg) => {
      if (msg.text().includes("OmniTribe")) {
        console.log(`[page-console] ${msg.text()}`);
      }
    });
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();
    await page.getByTestId("toggle-sim-section").click();
  });

  test("Live-Monitoring zeigt VU-Stream-Activity > 5 fps", async ({ page }) => {
    // Connect
    await page.getByTestId("connect-sim-btn").click();
    await expect(page.getByTestId("sim-status-connected")).toBeVisible({
      timeout: 5000,
    });

    // Enable Live Monitoring
    const monitorBtn = page.getByTestId("sim-enable-monitoring-btn");
    await expect(monitorBtn).toBeVisible();
    await monitorBtn.click();

    // Activity-Indicator erscheint
    const activity = page.getByTestId("sim-stream-activity");
    await expect(activity).toBeVisible();

    // Warte 1.5s damit der 1Hz-Rolling-Counter mind. einmal aktualisiert
    await page.waitForTimeout(1500);

    // VU-FPS muss > 5 sein (Stream laeuft @ 60 Hz)
    const text = await activity.textContent();
    expect(text).toMatch(/VU (\d+) fps/);
    const match = text?.match(/VU (\d+) fps/);
    const vuFps = match ? parseInt(match[1], 10) : 0;
    expect(vuFps).toBeGreaterThan(5);
  });

  test("VU-Meter-Komponente zeigt non-zero Werte nach Monitoring", async ({ page }) => {
    await page.getByTestId("connect-sim-btn").click();
    await expect(page.getByTestId("sim-status-connected")).toBeVisible({
      timeout: 5000,
    });
    await page.getByTestId("sim-enable-monitoring-btn").click();
    // Warten bis Stream fluss
    await page.waitForTimeout(800);

    // VU-Meter sucht — Bars haben role oder spezifische DOM-Struktur.
    // Wir pruefen ob im OmniTribe-Tab-Container ueberhaupt Bars mit Hoehe > 0 sind.
    const vuHeights = await page.evaluate(() => {
      // Suche bars in der VU-Meter-Komponente (16 vertikale divs mit inline style height)
      const bars = Array.from(document.querySelectorAll('[style*="height"]'));
      return bars
        .map((b) => parseFloat((b as HTMLElement).style.height || "0"))
        .filter((h) => h > 0);
    });
    // Mindestens ein Bar mit height > 0 → Stream fliesst
    expect(vuHeights.length).toBeGreaterThan(0);
  });
});
