/**
 * midi-filter-bar.spec.ts — v3.269.0
 *
 * Smoke für den MIDI-Eingangsfilter und das Korg-Remote-Panel im Sequencer.
 *
 * Ohne angeschlossene Hardware gibt es keine MIDI-Eingänge, also auch keine
 * Gerätechips — prüfbar sind hier die dauerhafte Erreichbarkeit auf dem
 * Home-Screen, das Umschalten der Nachrichtenklassen inklusive Persistenz
 * über einen Reload, und dass das Korg-Remote-Panel aufgeht.
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("Eingangsfilter ist ohne Aufklappen im Sequencer sichtbar", async ({ page }) => {
  const bar = page.getByTestId("midi-filter-bar");
  await expect(bar).toBeVisible();

  // Der Not-Aus und die Klassen-Chips sind direkt anklickbar — genau darum
  // sitzt die Leiste auf dem Home-Screen und nicht in den Einstellungen.
  await expect(page.getByTestId("midi-filter-master")).toBeVisible();
  await expect(bar.getByTestId("midi-filter-class").first()).toBeVisible();
});

test("Klassen-Chip schaltet um und überlebt einen Reload", async ({ page }) => {
  const progChip = page.getByTestId("midi-filter-class").filter({ hasText: "Prog" });
  await expect(progChip).toHaveAttribute("aria-pressed", "false");

  await progChip.click();
  await expect(progChip).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await expect(
    page.getByTestId("midi-filter-class").filter({ hasText: "Prog" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Not-Aus schaltet den gesamten Eingang stumm und wieder frei", async ({ page }) => {
  const master = page.getByTestId("midi-filter-master");
  await expect(master).toHaveAttribute("aria-pressed", "false");

  await master.click();
  await expect(master).toHaveAttribute("aria-pressed", "true");

  // Der Reset-Knopf erscheint erst, wenn wirklich etwas gefiltert wird —
  // sonst wäre er im Normalbetrieb nur Rauschen.
  const reset = page.getByTestId("midi-filter-reset");
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(master).toHaveAttribute("aria-pressed", "false");
  await expect(reset).toHaveCount(0);
});

test("Korg-Remote-Panel öffnet sich und bietet den MIDImix-Schnellstart", async ({ page }) => {
  await page.getByTestId("toggle-korg-remote").click();

  const panel = page.getByTestId("korg-remote-panel");
  await expect(panel).toBeVisible();

  // Default ist AUS — eine Fernsteuerung darf nicht ungefragt an fremde
  // Hardware senden.
  await expect(page.getByTestId("korg-remote-enable")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("korg-remote-preset-faders").click();
  await expect(page.getByTestId("korg-remote-rule")).toHaveCount(8);

  await page.getByTestId("korg-remote-clear").click();
  await expect(page.getByTestId("korg-remote-rule")).toHaveCount(0);
});
