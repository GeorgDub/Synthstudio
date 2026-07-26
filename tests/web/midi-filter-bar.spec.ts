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

test("NRPN-Ziele sind wählbar und weisen auf die Hacktribe-Voraussetzung hin", async ({ page }) => {
  await page.getByTestId("toggle-korg-remote").click();
  await expect(page.getByTestId("korg-remote-panel")).toBeVisible();

  // Ohne NRPN-Regel kein Hinweis — sonst wäre er im CC-Betrieb nur Rauschen.
  await expect(page.getByTestId("korg-remote-hacktribe-hint")).toHaveCount(0);

  // Der Panel-Schnellstart legt NRPN-Regeln an (Taster → Part-Mute am Gerät).
  await page.getByTestId("korg-remote-preset-mutes").click();
  await expect(page.getByTestId("korg-remote-rule")).toHaveCount(8);
  await expect(page.getByTestId("korg-remote-hacktribe-hint")).toBeVisible();

  // Panel-Regeln kommen mit Wertebereich 0..1 — ein Taster, kein Fader.
  // Über den Titel adressiert, nicht über die Feldreihenfolge: Panel-Ziele
  // bringen ein eigenes Pad-Feld mit, das vor dem Bereich steht.
  const firstRule = page.getByTestId("korg-remote-rule").first();
  await expect(firstRule.locator('input[title*="ganz unten"]')).toHaveValue("0");
  await expect(firstRule.locator('input[title*="ganz oben"]')).toHaveValue("1");

  await page.getByTestId("korg-remote-clear").click();
  await expect(page.getByTestId("korg-remote-hacktribe-hint")).toHaveCount(0);
});

test("Learn-Zeile wechselt die Ziel-Art und zeigt passende Felder", async ({ page }) => {
  await page.getByTestId("toggle-korg-remote").click();

  const kind = page.getByTestId("korg-remote-learn-kind");
  // Default ist das Hacktribe-freie CC-Ziel mit Parameter-Auswahl.
  await expect(kind).toHaveValue("cc");
  await expect(page.getByTestId("korg-remote-learn-cc-param")).toBeVisible();

  await kind.selectOption("panel");
  await expect(page.getByTestId("korg-remote-learn-cc-param")).toHaveCount(0);
  await expect(page.getByTestId("korg-remote-learn-panel-mode")).toBeVisible();

  // Learn lässt sich starten und per zweitem Klick wieder abbrechen.
  const learn = page.getByTestId("korg-remote-learn");
  await learn.click();
  await expect(learn).toContainText("Regler bewegen");
  await learn.click();
  await expect(learn).toHaveText("Learn");
});
