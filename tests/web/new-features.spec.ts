/**
 * tests/web/new-features.spec.ts
 *
 * Playwright Smoke-Tests für die in Sprint 17+ implementierten UI-Features:
 *   - Multi-Sample Mode (KeyboardSamplerPanel)
 *   - Envelope Follower Button + Panel
 *   - Time-Stretch Slider
 *   - Public Relay Server Panel
 *   - Audio Workbench (Stem Separator)
 *
 * Diese Tests verifizieren die Sichtbarkeit + Klickbarkeit der UI –
 * NICHT die Audio-Korrektheit (wäre nur in echten Browsern mit AudioContext testbar).
 */
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Warten bis die Haupt-Tabbar gerendert ist
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test.describe("Tools-Tab Navigation", () => {
  test("kann zu allen Tool-Tabs navigieren", async ({ page }) => {
    await page.getByRole("tab", { name: "Tools" }).click();

    // Sub-Tab Buttons
    await expect(page.getByRole("button", { name: /KI-Generator/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Algorithmisch/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Akkorde/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sampler/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Workbench/i })).toBeVisible();
  });
});

test.describe("Multi-Sample Mode (Keyboard Sampler)", () => {
  test("öffnet das KeyboardSamplerPanel", async ({ page }) => {
    await page.getByRole("tab", { name: "Tools" }).click();
    await page.getByRole("button", { name: /Sampler/i }).click();
    await expect(page.getByText("Keyboard Sampler")).toBeVisible();
  });
});

test.describe("Audio Workbench (Stem Separator)", () => {
  test("öffnet das Workbench-Panel mit Import-Bereich", async ({ page }) => {
    await page.getByRole("tab", { name: "Tools" }).click();
    await page.getByRole("button", { name: /Workbench/i }).click();
    await expect(page.getByText("Audio Workbench")).toBeVisible();
    await expect(page.getByText(/Audio-Datei hierher ziehen/i)).toBeVisible();
  });

  test("Frequenz-Stems-Button ist initial nicht sichtbar (kein Buffer)", async ({ page }) => {
    await page.getByRole("tab", { name: "Tools" }).click();
    await page.getByRole("button", { name: /Workbench/i }).click();
    await expect(page.getByRole("button", { name: /Frequenz-Stems trennen/i })).toHaveCount(0);
  });
});

test.describe("Envelope Follower (Sequencer-Tab)", () => {
  test("EF-Toggle-Button ist im Sequencer-Tab vorhanden", async ({ page }) => {
    // Sequencer ist Standard-Tab; falls nicht aktiv: klicken
    await page.getByRole("tab", { name: "Sequencer" }).click();
    const efBtn = page.locator('button[title="Envelope Follower"]');
    await expect(efBtn).toBeVisible({ timeout: 5000 });
  });

  test("Toggle öffnet das Envelope-Follower-Panel", async ({ page }) => {
    await page.getByRole("tab", { name: "Sequencer" }).click();
    await page.locator('button[title="Envelope Follower"]').click();
    await expect(page.getByText(/Envelope Follower/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /\+ Follower/i })).toBeVisible();
  });
});

test.describe("Public Relay (Kollaboration-Tab)", () => {
  test("RelayPanel ist im Kollaboration-Tab sichtbar", async ({ page }) => {
    await page.getByRole("tab", { name: "Kollaboration" }).click();
    await expect(page.getByText("WAN Relay")).toBeVisible();
  });

  test("Verbinden-Button ist initial sichtbar", async ({ page }) => {
    await page.getByRole("tab", { name: "Kollaboration" }).click();
    await expect(page.getByRole("button", { name: /^Verbinden$/ })).toBeVisible();
  });
});

test.describe("Time-Stretch (Sequencer-Tab Footer-Toolbar)", () => {
  test("Stretch-Slider erscheint wenn Part ausgewählt", async ({ page }) => {
    await page.getByRole("tab", { name: "Sequencer" }).click();
    await expect(page.getByText("Stretch:").first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── v2.54: TASK-129 Welle 4 — Direct-Mode-Switch via Badge ───────────────────

test.describe("Source-Type-Badge Switch (TASK-129 Welle 4)", () => {
  test("Default-Pattern hat Source-Type-Badges mit data-source-type='sample'", async ({ page }) => {
    await page.getByRole("tab", { name: "Sequencer" }).click();
    // Default-Pattern hat 9 Parts; jeder ChannelStrip rendert das Badge.
    const badges = page.locator("[data-testid^='channel-source-type-']");
    const first = badges.first();
    await expect(first).toBeVisible({ timeout: 5000 });
    await expect(first).toHaveAttribute("data-source-type", "sample");
  });

  test("Klick auf Badge öffnet das Mode-Switch-Menu mit 4 Optionen", async ({ page }) => {
    await page.getByRole("tab", { name: "Sequencer" }).click();
    const firstBadge = page.locator("[data-testid^='channel-source-type-']").first();
    await firstBadge.click();
    // Menu sollte sichtbar sein und 4 Mode-Optionen anbieten
    const menu = page.locator("[data-testid^='channel-source-type-menu-']").first();
    await expect(menu).toBeVisible();
    // Alle vier Modi sind als menuitem da
    await expect(menu.getByText("Sample-Player")).toBeVisible();
    await expect(menu.getByText("Wavetable-Synth")).toBeVisible();
    await expect(menu.getByText("FM-Synth")).toBeVisible();
    await expect(menu.getByText("Granular-Synth")).toBeVisible();
  });

  test("Wechsel auf 'fm' aktualisiert das Badge auf 'FM' + data-source-type='fm'", async ({ page }) => {
    await page.getByRole("tab", { name: "Sequencer" }).click();
    const firstBadge = page.locator("[data-testid^='channel-source-type-']").first();
    await firstBadge.click();
    // FM-Option auswählen (via genauer testid)
    const menu = page.locator("[data-testid^='channel-source-type-menu-']").first();
    await menu.locator("[data-testid$='-fm']").click();
    // Badge sollte jetzt FM zeigen
    await expect(firstBadge).toHaveAttribute("data-source-type", "fm");
    await expect(firstBadge).toContainText("FM");
  });
});
