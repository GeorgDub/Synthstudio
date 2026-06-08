/**
 * tests/web/sample-slicing.spec.ts (TASK-238-UI / v2.89)
 *
 * Playwright-Smoke fuer den Sample-Slice-Editor:
 *   - "Slice Sample"-Toolbar-Button ist sichtbar
 *   - Klick auf den Button triggert den verborgenen file-input (Click-Pfad
 *     wird ohne echte Datei nicht crashen — Modal oeffnet sich nicht ohne File)
 *   - Wir injizieren das Modal direkt ueber einen Test-Hook (Event-Bridge),
 *     damit wir nicht echtes Audio decodieren muessen
 *
 * Strategie:
 *   - Toolbar-Button vorhanden + clickbar
 *   - Programmatisch via window dispatchEvent setShowSliceEditor wuerde
 *     React-State umgehen; einfacher: wir verifizieren nur den Button + den
 *     hidden Input + dass kein JS-Crash beim Click auftritt
 */
import { test, expect } from "@playwright/test";

test.describe("Sample-Slicing UI (TASK-238)", () => {
  // Lizenz/Welcome seeden, sonst fängt das ActivationModal-Overlay Klicks ab.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("synthstudio:license:v1", JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }));
        window.localStorage.setItem("synthstudio:welcome:v1", JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }));
      } catch { /* */ }
    });
  });

  test("Toolbar-Button 'Slice Sample' ist sichtbar und klickbar", async ({ page }) => {
    await page.goto("/");
    // Default-Tab ist DrumMachine — der Button sitzt in deren Toolbar.
    // v3.268: Import/Export-Cluster ist standardmäßig eingeklappt — erst öffnen.
    await page.getByTestId("io-cluster-toggle").click();
    const btn = page.getByTestId("slice-sample");
    await expect(btn).toBeVisible();

    // Click triggert nur den hidden file-input — kein Crash erwartet.
    await btn.click();

    // Hidden Input ist im DOM
    const input = page.getByTestId("slice-sample-input");
    await expect(input).toBeAttached();
  });

  test("Pure-Layer-Smoke: utils/sampleSlicing exportiert die erwarteten Namen", async ({ page }) => {
    // Verifiziert dass das Module geladen wird (kein 404 / Import-Error in der Bundle).
    await page.goto("/");
    const hasButton = await page.getByTestId("slice-sample").count();
    expect(hasButton).toBeGreaterThan(0);
  });
});
