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

test("FX-Zuweisungs-Formular ist im Korg-Remote-Panel erreichbar", async ({ page }) => {
  await page.getByTestId("toggle-korg-remote").click();

  // Eingeklappt by default — es ist eine Sonderaktion, kein Live-Handgriff.
  await expect(page.getByTestId("korg-map-fx-form")).toHaveCount(0);

  await page.getByTestId("toggle-map-fx-form").click();
  await expect(page.getByTestId("korg-map-fx-form")).toBeVisible();

  // Default ist der X-Regler auf Map-Slot 0 — der übliche Einstieg.
  await expect(page.getByTestId("korg-map-fx-source")).toHaveValue("fxEditX");
  await expect(page.getByTestId("korg-map-fx-mapslot")).toHaveValue("0");
  await expect(page.getByTestId("korg-map-fx-send")).toBeEnabled();
});

test("RAM-Werkzeug warnt, sperrt Schreiben und validiert die Adresse", async ({ page }) => {
  await page.getByTestId("toggle-ram-tool").click();

  const panel = page.getByTestId("hacktribe-ram-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("ram-panel-warning")).toBeVisible();

  // Schreiben ist gesperrt, solange nicht beide Bestätigungen gesetzt sind.
  const writeBtn = page.getByTestId("ram-write");
  await expect(writeBtn).toBeDisabled();

  await page.getByTestId("ram-write-input").fill("00 11 22");
  await expect(writeBtn).toBeDisabled();
  await page.getByTestId("ram-confirm-stopped").check();
  await expect(writeBtn).toBeDisabled();
  await page.getByTestId("ram-confirm-understood").check();
  await expect(writeBtn).toBeEnabled();

  // Der Boot-Loader-Bereich wird schon im Formular abgelehnt, nicht erst am Gerät.
  await page.getByTestId("ram-addr-input").fill("0x80000000");
  await expect(page.getByTestId("ram-range-error")).toBeVisible();
  await expect(page.getByTestId("ram-read")).toBeDisabled();
});

test("RAM-Werkzeug übernimmt Adresse und Länge aus der Struktur-Karte", async ({ page }) => {
  await page.getByTestId("toggle-ram-tool").click();

  // Default: IFX-Preset, Slot 0.
  await expect(page.getByTestId("ram-addr-input")).toHaveValue("0xC00A80F0");
  await expect(page.getByTestId("ram-len-input")).toHaveValue("524");

  // Slot 1 verschiebt um genau eine Struktur (0x20C).
  await page.getByTestId("ram-slot-input").fill("1");
  await expect(page.getByTestId("ram-addr-input")).toHaveValue("0xC00A82FC");

  // Struktur-Wechsel setzt Adresse UND Länge neu.
  await page.getByTestId("ram-map-select").selectOption("groove");
  await expect(page.getByTestId("ram-addr-input")).toHaveValue("0xC0143B00");
  await expect(page.getByTestId("ram-len-input")).toHaveValue("320");
});

test("RAM-Werkzeug: FX-Preset-Ansicht erscheint erst nach einem Lesevorgang", async ({ page }) => {
  // Web MIDI hart abschalten, damit der Fehlerpfad deterministisch greift.
  // Headless Chromium bringt Web MIDI durchaus mit, die Anfrage bleibt dann
  // aber ohne Nutzergeste hängen — ohne diesen Schalter hinge der Test 10 s
  // und prüfte am Ende die Laune des Browsers statt unseren Code.
  // `delete navigator.requestMIDIAccess` genügt NICHT: die Methode liegt auf
  // Navigator.prototype, nicht auf der Instanz.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: undefined,
      configurable: true,
    });
  });
  await page.reload();
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

  await page.getByTestId("toggle-ram-tool").click();

  // Default ist der IFX-Preset-Slot mit voller Preset-Länge — die Ansicht ist
  // trotzdem leer, weil noch nichts gelesen wurde. Ein Dekodier-Bereich ohne
  // Daten wäre eine Behauptung über ein Gerät, das gar nicht geantwortet hat.
  await expect(page.getByTestId("ram-len-input")).toHaveValue("524");
  await expect(page.getByTestId("fx-preset-view")).toHaveCount(0);

  await page.getByTestId("ram-read").click();
  await expect(page.getByText(/Web MIDI nicht verfügbar/i).first())
    .toBeVisible({ timeout: 10_000 });
  // Kein Absturz, keine halb gefüllte Tabelle.
  await expect(page.getByTestId("fx-preset-view")).toHaveCount(0);
});
