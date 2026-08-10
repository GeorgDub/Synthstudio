/**
 * e2-sysex-toolbar.spec.ts — v3.268.0, umgeschrieben in v3.319.0
 *
 * Smoke für das Pattern-Paar in der Sequencer-Toolbar:
 * „⬇ Von Korg" holt das aktive Pattern per nativem Korg-Sysex (F0 42 …) vom
 * Gerät, „⬆ Zur Korg" schickt es in dessen Edit-Buffer.
 *
 * ★ v3.319: Es gab bis dahin ZWEI Paare für denselben Vorgang — dieses hier
 * (`e2-sysex-load`/`e2-sysex-send`) und ein zweites, im eingeklappten
 * I/O-Cluster verstecktes (`e2s-pull-pattern`/`e2s-push-pattern`). Der Bug vom
 * 2026-08-10 steckte in beiden Pfaden und musste zweimal behoben werden. Geblieben
 * ist ein Paar unter den `e2s-*`-Testids; dieser Smoke zeigt auf das
 * verbliebene.
 *
 * Ohne angeschlossene Hardware ist prüfbar: Erreichbarkeit, eindeutige
 * Beschriftung — und dass die Buttons ohne verbundenes Gerät **gesperrt** sind
 * statt in einen Fehlschlag zu laufen. Das ersetzt den früheren
 * Fehler-Toast-Test: die Sperre ist die neue, bessere Antwort auf „kein Gerät".
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("beide Sysex-Buttons sind in der Sequencer-Toolbar sichtbar", async ({
  page,
}) => {
  const load = page.getByTestId("e2s-pull-pattern");
  const send = page.getByTestId("e2s-push-pattern");

  await expect(load).toBeVisible();
  await expect(send).toBeVisible();

  // Beschriftung + Tooltip erklären die Richtung eindeutig.
  await expect(load).toContainText("Von Korg");
  await expect(send).toContainText("Zur Korg");
});

test("es gibt nur EIN Paar — die alten Zwillinge sind weg", async ({ page }) => {
  await expect(page.getByTestId("e2-sysex-load")).toHaveCount(0);
  await expect(page.getByTestId("e2-sysex-send")).toHaveCount(0);
});

test("ohne verbundenes Gerät sind beide Buttons gesperrt statt still zu scheitern", async ({
  page,
}) => {
  const load = page.getByTestId("e2s-pull-pattern");
  const send = page.getByTestId("e2s-push-pattern");

  await expect(load).toBeDisabled();
  await expect(send).toBeDisabled();
  await expect(load).toHaveAttribute("title", /im E2S-Tab verbinden/);
});
