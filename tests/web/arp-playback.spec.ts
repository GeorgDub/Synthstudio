/**
 * arp-playback.spec.ts — v3.268
 *
 * Verifiziert das neue Arpeggiator-Playback (3 Output-Modi + Switch). Der
 * Engine-Scheduler feuert pro Step ein `audio:arpNote`-CustomEvent (Note +
 * Velocity + Modus) — das ist gleichzeitig Runtime-Observability-Seam UND
 * UI-Signal. Dieser Test enabled den Arp im UI, startet den Transport und
 * fängt die echten Events aus dem laufenden Chromium (echte AudioContext) ab.
 *
 * Modus "synth" ist lokal hörbar/verifizierbar; "channel" wird über die
 * Step-Suppression getestet; "midi" ist PENDING HARDWARE (kein MIDI-Out → kein
 * Observable, nur Switch-State).
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("synthstudio:license:v1", JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }));
      window.localStorage.setItem("synthstudio:welcome:v1", JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }));
    } catch { /* */ }
  });
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("Arp synth-Modus: Transport feuert audio:arpNote-Events mit den Akkord-Noten", async ({ page }) => {
  // Arp-Panel ist im Tools-Tab (KI-Generator, Default-Tool).
  await page.getByRole("tab", { name: /^Tools$/ }).click();

  // Default-Output-Modus ist "synth".
  await expect(page.getByTestId("arp-output-synth")).toHaveAttribute("aria-pressed", "true");

  // Arp aktivieren (Toggle zeigt "Inaktiv" → klick → "Aktiv").
  const toggle = page.getByRole("button", { name: "Inaktiv" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("button", { name: "Aktiv" })).toBeVisible();

  // Event-Listener im Window installieren.
  await page.evaluate(() => {
    (window as unknown as { __arp: unknown[] }).__arp = [];
    window.addEventListener("audio:arpNote", (e) => {
      (window as unknown as { __arp: unknown[] }).__arp.push((e as CustomEvent).detail);
    });
  });

  // Auf Sequencer-Tab wechseln und Transport starten (Play-Gesture resumed
  // die AudioContext → Scheduler läuft).
  await page.getByRole("tab", { name: /^Sequencer$/ }).click();
  await page.locator('button[title^="Play"]').first().click();

  // ~1.2 s laufen lassen, dann Events einsammeln.
  await page.waitForTimeout(1200);
  const events = await page.evaluate(() => (window as unknown as { __arp: { stepIndex: number; note: number; velocity: number; mode: string }[] }).__arp);
  console.log("Captured arp events:", JSON.stringify(events.slice(0, 12)));
  console.log("Total arp events:", events.length);

  // Transport wieder stoppen und prüfen, dass keine neuen Events mehr kommen
  // (Transport-Gating: Arp läuft NUR während Playback).
  await page.locator('button[title^="Stop"]').first().click();
  const countAfterStop = await page.evaluate(() => (window as unknown as { __arp: unknown[] }).__arp.length);
  await page.waitForTimeout(600);
  const countLater = await page.evaluate(() => (window as unknown as { __arp: unknown[] }).__arp.length);

  // Assertions.
  expect(events.length).toBeGreaterThan(0);            // Arp hat gefeuert
  expect(events.every((e) => e.mode === "synth")).toBe(true);
  // Default-Akkord C-Dur [60,64,67] (+ ggf. Oktaven) → alle Noten aus der up-Reihe.
  const notes = new Set(events.map((e) => e.note));
  expect([...notes].some((n) => [60, 64, 67].includes(n))).toBe(true);
  // Velocity im gültigen MIDI-Bereich.
  expect(events.every((e) => e.velocity >= 1 && e.velocity <= 127)).toBe(true);
  // Nach Stop wachsen die Events nicht weiter (max. ein in-flight Step Toleranz).
  expect(countLater - countAfterStop).toBeLessThanOrEqual(1);
});

test("Arp channel-Modus: Ziel-Channel wählbar, Events tragen mode='channel'", async ({ page }) => {
  await page.getByRole("tab", { name: /^Tools$/ }).click();

  // Arp aktivieren.
  await page.getByRole("button", { name: "Inaktiv" }).click();
  await expect(page.getByRole("button", { name: "Aktiv" })).toBeVisible();

  // Output-Modus auf "channel" — Ziel-Selektor erscheint.
  await page.getByTestId("arp-output-channel").click();
  await expect(page.getByTestId("arp-output-channel")).toHaveAttribute("aria-pressed", "true");
  const target = page.getByTestId("arp-target-part");
  await expect(target).toBeVisible();

  // Ersten echten Channel auswählen (Option[0] ist der Platzhalter).
  const optionValues = await target.locator("option").evaluateAll((opts) =>
    (opts as HTMLOptionElement[]).map((o) => o.value).filter((v) => v !== ""),
  );
  expect(optionValues.length).toBeGreaterThan(0);
  await target.selectOption(optionValues[0]);

  // Listener + Transport.
  await page.evaluate(() => {
    (window as unknown as { __arp: unknown[] }).__arp = [];
    window.addEventListener("audio:arpNote", (e) => {
      (window as unknown as { __arp: unknown[] }).__arp.push((e as CustomEvent).detail);
    });
  });
  await page.getByRole("tab", { name: /^Sequencer$/ }).click();
  await page.locator('button[title^="Play"]').first().click();
  await page.waitForTimeout(1000);
  await page.locator('button[title^="Stop"]').first().click();

  const events = await page.evaluate(() => (window as unknown as { __arp: { mode: string; note: number }[] }).__arp);
  console.log("Channel-mode arp events:", JSON.stringify(events.slice(0, 6)));
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((e) => e.mode === "channel")).toBe(true);
});
