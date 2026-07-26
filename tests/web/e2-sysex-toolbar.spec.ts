/**
 * e2-sysex-toolbar.spec.ts — v3.268.0
 *
 * Smoke für die beiden neuen Live-Sysex-Buttons im Sequencer:
 * „⬇ Von Korg" holt das Pattern per natives Korg-Sysex (F0 42 …) vom Gerät,
 * „⬆ Zur Korg" schickt das aktive Pattern in dessen Edit-Buffer.
 *
 * Ohne angeschlossene Hardware kann hier nur die Erreichbarkeit geprüft werden
 * plus das Fehlerverhalten: ohne Web-MIDI/Port muss ein verständlicher Toast
 * erscheinen statt eines stillen Fehlschlags oder eines Crashes.
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("beide Sysex-Buttons sind in der Sequencer-Toolbar sichtbar", async ({ page }) => {
  const load = page.getByTestId("e2-sysex-load");
  const send = page.getByTestId("e2-sysex-send");

  await expect(load).toBeVisible();
  await expect(send).toBeVisible();

  // Beschriftung + Tooltip erklären die Richtung eindeutig.
  await expect(load).toContainText("Von Korg");
  await expect(send).toContainText("Zur Korg");
  await expect(send).toHaveAttribute("title", /Edit-Buffer/);
});

test("ohne Web-MIDI meldet der Laden-Button einen verständlichen Fehler statt still zu scheitern", async ({ page }) => {
  // Web MIDI hart abschalten, damit der Fehlerpfad deterministisch greift.
  // `delete navigator.requestMIDIAccess` genügt NICHT — die Methode liegt auf
  // Navigator.prototype, nicht auf der Instanz. Also mit einer eigenen
  // undefined-Property überschatten.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: undefined,
      configurable: true,
    });
  });
  await page.reload();
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

  await page.getByTestId("e2-sysex-load").click();

  // Irgendein sichtbarer Hinweis auf fehlendes MIDI — kein stiller Abbruch.
  await expect(page.getByText(/Web MIDI nicht verfügbar|MIDI-Ausgang/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
