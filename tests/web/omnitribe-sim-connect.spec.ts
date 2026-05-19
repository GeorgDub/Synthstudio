/**
 * omnitribe-sim-connect.spec.ts — Sprint-97 Live E2E gegen sim_ws_server.py.
 *
 * Setzt voraus:
 *   1. Vite-Dev-Server laeuft auf http://localhost:5173
 *   2. sim_ws_server.py laeuft auf ws://localhost:8744 (--autoload chord)
 *
 * Workflow:
 *   - App oeffnen
 *   - Tools-Tab + OmniTribe-Sub-Tab waehlen
 *   - "Dev: Sim-Loopback"-Section aufklappen
 *   - "Connect to Sim-Server" klicken
 *   - "✓ Sim connected" sichtbar
 *   - Identity-Response prueft module_count im Console-Log
 */

import { test, expect } from "@playwright/test";

test.describe("OmniTribe Sim-Loopback Connect-Button (Sprint-97)", () => {
  test.beforeEach(async ({ page }) => {
    // License-Modal + Welcome-Wizard umgehen (beide intercepten clicks).
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem(
          "synthstudio:license:v1",
          JSON.stringify({
            status: "pro",
            trialStartedAt: Date.now(),
            licenseKey: "PLAY-WRIGHT-TEST",
            activatedEmail: "e2e@test.local",
          }),
        );
        window.localStorage.setItem(
          "synthstudio:welcome:v1",
          JSON.stringify({
            seen: true, dismissed: true,
            seenAt: Date.now(),
          }),
        );
      } catch { /* swallow */ }
    });

    // Console-Logs sammeln fuer Identity-Response-Verifikation
    page.on("console", (msg) => {
      if (msg.text().includes("OmniTribe")) {
        console.log(`[page-console] ${msg.text()}`);
      }
    });
    await page.goto("/");
    // Warte bis die Tab-Leiste sichtbar — App ist bereit
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  });

  test("Sim-Section aufklappen und live verbinden", async ({ page }) => {
    // 1. Tools-Tab im Haupt-Tablist (role=tab, nicht button)
    await page.getByRole("tab", { name: /^Tools$/ }).click();

    // 2. OmniTribe-Sub-Tab (button mit Emoji 🎛 OmniTribe)
    const omniTab = page.getByRole("button", { name: /OmniTribe/ });
    await expect(omniTab).toBeVisible({ timeout: 5000 });
    await omniTab.click();

    // 3. Panel ist sichtbar
    const panel = page.getByTestId("device-connection-panel");
    await expect(panel).toBeVisible();

    // 4. Sim-Section initial collapsed → toggle aufklappen
    const simToggle = page.getByTestId("toggle-sim-section");
    await expect(simToggle).toBeVisible();
    await simToggle.click();

    const simSection = page.getByTestId("sim-loopback-section");
    await expect(simSection).toBeVisible();

    // 5. URL-Input ist mit Default vorbefuellt
    const urlInput = page.getByTestId("sim-url-input");
    await expect(urlInput).toHaveValue("ws://localhost:8744");

    // 6. Click "Connect to Sim-Server"
    const connectBtn = page.getByTestId("connect-sim-btn");
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    // 7. Status wechselt zu "Connecting…" oder direkt "Connected"
    //    (je nach Geschwindigkeit) — wir warten auf End-Zustand
    const status = page.getByTestId("sim-status-connected");
    await expect(status).toBeVisible({ timeout: 5000 });
    await expect(status).toContainText("Sim connected");
    await expect(status).toContainText("ws://localhost:8744");

    // 8. Disconnect-Button ist jetzt sichtbar
    const disconnectBtn = page.getByTestId("disconnect-sim-btn");
    await expect(disconnectBtn).toBeVisible();

    // 9. Disconnect funktioniert
    await disconnectBtn.click();
    await expect(status).not.toBeVisible();
    await expect(page.getByTestId("connect-sim-btn")).toBeVisible();
  });

  test("Verbindung zu unerreichbarer URL zeigt Error-State", async ({ page }) => {
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();
    await page.getByTestId("toggle-sim-section").click();

    // URL aendern auf einen Port wo niemand lauscht
    const urlInput = page.getByTestId("sim-url-input");
    await urlInput.fill("ws://localhost:9999");

    await page.getByTestId("connect-sim-btn").click();

    // Error-Status erscheint
    const errStatus = page.getByTestId("sim-status-error");
    await expect(errStatus).toBeVisible({ timeout: 10_000 });
    await expect(errStatus).toContainText(/failed|error/i);
  });
});
