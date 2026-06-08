/**
 * arp-toolbar.spec.ts — v3.270
 *
 * Zwei Fixes:
 *  1. Arpeggiator-Bedienung war zu versteckt (nur Tools→KI-Generator) → jetzt
 *     als kompaktes Cluster (ARP-Toggle + ⚙-Panel) direkt neben dem Metronom
 *     in der DrumMachine-Toolbar.
 *  2. Arp-State wurde bei "Neues Projekt" NICHT zurückgesetzt (leckte ins neue
 *     Projekt) → resetArp() jetzt in doFullProjectReset.
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("Arp-Toggle + Settings-Panel sind in der Toolbar (neben Metronom) erreichbar", async ({ page }) => {
  const toggle = page.getByTestId("arp-toolbar-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Einschalten via Toolbar.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // ⚙ öffnet das Arp-Panel (Popover).
  await page.getByTestId("arp-toolbar-settings").click();
  await expect(page.getByTestId("arp-toolbar-panel")).toBeVisible();
  await expect(page.getByText("Arpeggiator", { exact: true })).toBeVisible();
});

test("Neues Projekt setzt den Arp zurück (Fix: vorher leckte der State)", async ({ page }) => {
  // Arp einschalten.
  const toggle = page.getByTestId("arp-toolbar-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // "Neu" klicken (ProjectManager). Falls ein Save-Confirm erscheint, ablehnen/
  // bestätigen, dann den NewProjectDialog bestätigen.
  await page.getByRole("button", { name: "Neu", exact: true }).click();

  // Optionaler Save-Confirm (custom ConfirmDialog) — wenn da, "verwerfen"/bestätigen.
  const confirmBtn = page.getByTestId("confirm-dialog-confirm");
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
  }

  // NewProjectDialog → "Projekt erstellen".
  await page.getByRole("button", { name: "Projekt erstellen" }).click();

  // Arp ist jetzt zurückgesetzt → Toggle inaktiv.
  await expect(toggle).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });
});
