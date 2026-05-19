/**
 * ota-update-panel.spec.ts — Sprint-101 OTA-UI E2E.
 *
 * Verifies:
 *   - OtaUpdatePanel rendert im OmniTribe-Tab
 *   - Konfigurieren-Toggle zeigt Form
 *   - "Check for Updates" mit gemocktem fetch + Python-signiertem Manifest
 *     liefert "Update verfuegbar"-Banner
 *   - Falsches Secret → keine Anzeige (Verify-Fehler)
 */

import { test, expect } from "@playwright/test";

// Fixture-Pfad (mit dem in den TS-Tests verwendeten Manifest):
const PYTHON_SIGNED_MANIFEST = `{
  "schema_version": 1,
  "manifest_signed_at": "2026-05-19T11:57:00Z",
  "manifest_hmac": "b98f8c2e8ead5f1bbde254e0303bba0322017e5dc84285f3deb1d98ec330c7ee",
  "releases": [
    {
      "version": "0.5.0",
      "channel": "stable",
      "url": "https://example.org/v0.5.0.vsb",
      "size_bytes": 2097408,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "released_at": "2026-05-19T12:00:00Z",
      "min_loader_version": "0.1.0",
      "release_notes_url": "",
      "hmac": "e4f02ef3cae6ee0e524b1eef2bf2ec2fa068666539a72bc3ff8731ba00120601"
    }
  ]
}`;

test.describe("OTA Update Panel (Sprint-101)", () => {
  test.beforeEach(async ({ page }) => {
    // Welcome + License umgehen
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
    // Mock-fetch fuer das Manifest:
    await page.route("**/test-manifest.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: PYTHON_SIGNED_MANIFEST,
      });
    });
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("tab", { name: /^Tools$/ }).click();
    await page.getByRole("button", { name: /OmniTribe/ }).click();
  });

  test("Panel rendert + Config-Toggle funktioniert", async ({ page }) => {
    const panel = page.getByTestId("ota-update-panel");
    await expect(panel).toBeVisible();
    await page.getByTestId("ota-toggle-config").click();
    await expect(page.getByTestId("ota-config-url")).toBeVisible();
    await expect(page.getByTestId("ota-config-secret")).toBeVisible();
  });

  test("Mit gueltigem Setup zeigt Update-Banner", async ({ page }) => {
    await page.getByTestId("ota-toggle-config").click();
    await page.getByTestId("ota-config-url").fill("https://test.example/test-manifest.json");
    await page.getByTestId("ota-config-secret").fill("cross-validation-secret");
    await page.getByTestId("ota-config-version").fill("0.3.0");
    await page.getByTestId("ota-check-now").click();

    const banner = page.getByTestId("ota-update-available");
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText("v0.5.0");
    await expect(banner).toContainText("stable");

    // Download-Link
    const link = page.getByTestId("ota-download-link");
    await expect(link).toHaveAttribute("href", "https://example.org/v0.5.0.vsb");
  });

  test("Falsches Secret zeigt hmac-invalid Fehler", async ({ page }) => {
    await page.getByTestId("ota-toggle-config").click();
    await page.getByTestId("ota-config-url").fill("https://test.example/test-manifest.json");
    await page.getByTestId("ota-config-secret").fill("wrong-secret-here");
    await page.getByTestId("ota-config-version").fill("0.3.0");
    await page.getByTestId("ota-check-now").click();

    const noUpdate = page.getByTestId("ota-no-update");
    await expect(noUpdate).toBeVisible({ timeout: 5000 });
    await expect(noUpdate).toContainText(/hmac-invalid|mismatch/);
  });

  test("Wenn current >= release, kein Update", async ({ page }) => {
    await page.getByTestId("ota-toggle-config").click();
    await page.getByTestId("ota-config-url").fill("https://test.example/test-manifest.json");
    await page.getByTestId("ota-config-secret").fill("cross-validation-secret");
    await page.getByTestId("ota-config-version").fill("1.0.0");   // newer than 0.5.0
    await page.getByTestId("ota-check-now").click();

    const noUpdate = page.getByTestId("ota-no-update");
    await expect(noUpdate).toBeVisible({ timeout: 5000 });
    await expect(noUpdate).toContainText("aktuellsten Version");
  });
});
