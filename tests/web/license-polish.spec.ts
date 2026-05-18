/**
 * tests/web/license-polish.spec.ts (TASK-232-FOLLOWUP / v2.98)
 *
 * Playwright-Smoke für License-Polish:
 *   - Settings → "Lizenz"-Section ist erreichbar und zeigt Status
 *   - "Lizenz aktivieren" öffnet das ActivationModal (re-mountable)
 *   - ProLockBadge ist im expired-Modus sichtbar, im Pro-Modus unsichtbar
 *
 * Strategie: localStorage seeden bevor App lädt, damit der Auto-Modal nicht
 * dazwischenrätsen (status='trial' oder 'pro') und wir definitiv definiert
 * sind welche Sichtbarkeit Lock-Badges haben sollen.
 */
import { test, expect, type Page } from "@playwright/test";

async function seedLicenseState(
  page: Page,
  status: "trial" | "pro" | "expired",
  opts?: { trialStartedAt?: number; licenseKey?: string; activatedEmail?: string },
) {
  await page.addInitScript(([s, o]) => {
    try {
      const payload = {
        status: s,
        trialStartedAt: (o as { trialStartedAt?: number })?.trialStartedAt ?? Date.now(),
        licenseKey: (o as { licenseKey?: string })?.licenseKey ?? null,
        activatedEmail: (o as { activatedEmail?: string })?.activatedEmail ?? null,
      };
      window.localStorage.setItem("synthstudio:license:v1", JSON.stringify(payload));
    } catch { /* */ }
  }, [status, opts ?? {}]);
}

async function openSettingsLicenseSection(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

  // Settings-Button (⚙) öffnen (title="Einstellungen (alle Settings)")
  const gear = page.locator('button[title^="Einstellungen"]');
  await expect(gear).toBeVisible({ timeout: 10_000 });
  await gear.click();

  // Sidebar-Eintrag "Lizenz" klicken
  const licenseTab = page.getByRole("button", { name: /Lizenz/i }).first();
  await expect(licenseTab).toBeVisible({ timeout: 5_000 });
  await licenseTab.click();
}

test.describe("License-Polish UI (v2.98)", () => {
  test("Settings → Lizenz-Section ist erreichbar und zeigt Trial-Status", async ({ page }) => {
    await seedLicenseState(page, "trial");
    await openSettingsLicenseSection(page);

    const status = page.getByTestId("settings-license-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/Trial/i);
  });

  test("ActivationModal lässt sich aus Settings öffnen + schließen", async ({ page }) => {
    await seedLicenseState(page, "trial");
    await openSettingsLicenseSection(page);

    const activateBtn = page.getByTestId("settings-license-activate");
    await expect(activateBtn).toBeVisible();
    await activateBtn.click();

    // Modal ist sichtbar (role="dialog" mit aria-label="Lizenz-Aktivierung")
    const modal = page.locator('[role="dialog"][aria-label="Lizenz-Aktivierung"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Schließen via X-Button (forceOpen=true → X ist sichtbar)
    const closeBtn = modal.locator('button[aria-label="Schließen"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Modal weg
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });

  test("ProLockBadge ist im expired-Status sichtbar bei Live-Input-Button", async ({ page }) => {
    // Trial vor Tagen begonnen → expired (Default TRIAL_DURATION_DAYS=30).
    const longPast = Date.now() - 365 * 24 * 60 * 60 * 1000;
    await seedLicenseState(page, "expired", { trialStartedAt: longPast });

    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

    // In den Mixer-Tab wechseln (Tab name "Mixer")
    const mixerTab = page.getByRole("tab", { name: /Mixer/i }).first();
    if (await mixerTab.isVisible().catch(() => false)) {
      await mixerTab.click();
    }

    // ProLockBadge für USB-Audio-In sollte im DOM sein
    const badge = page.getByTestId("pro-lock-badge-usb-audio-in");
    await expect(badge).toBeVisible({ timeout: 5_000 });
  });

  test("ProLockBadge ist im Trial-Status UN-sichtbar (alles unlocked)", async ({ page }) => {
    await seedLicenseState(page, "trial");

    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

    const mixerTab = page.getByRole("tab", { name: /Mixer/i }).first();
    if (await mixerTab.isVisible().catch(() => false)) {
      await mixerTab.click();
    }

    // Badge sollte NICHT existieren (ProLockBadge returnt null wenn unlocked).
    const badgeCount = await page.getByTestId("pro-lock-badge-usb-audio-in").count();
    expect(badgeCount).toBe(0);
  });

  test("Pro-Status → Lizenz-Section zeigt Deaktivieren-Button", async ({ page }) => {
    await seedLicenseState(page, "pro", {
      licenseKey: "fake-key-base64.fake-sig",
      activatedEmail: "tester@example.com",
    });
    await openSettingsLicenseSection(page);

    const status = page.getByTestId("settings-license-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/Pro/i);

    const deactivate = page.getByTestId("settings-license-deactivate");
    await expect(deactivate).toBeVisible();
  });
});
