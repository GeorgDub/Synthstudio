/**
 * tests/web/layout-double-header.spec.ts
 *
 * Regression-Tests für TASK-101 / BUG-008 — Doppelte Header in DrumMachine-Floating-Panels.
 *
 * Ursache (vor Fix):
 *   - ResizableDrumPanel hatte einen eigenen Header mit title + Close-Button (X)
 *   - Die gewrappten Inner-Panels (PatternMorph, NoteRepeat, Envelope Follower,
 *     Macro, Granular, Polyrhythm) hatten ebenfalls einen eigenen Header
 *   - Beide Header waren gleichzeitig sichtbar → "Layout verzogen"
 *
 * Fix:
 *   - DrumMachine.tsx übergibt nicht mehr `title="..."` an ResizableDrumPanel
 *   - Inner-Panels bekommen kein onClose mehr (das X kommt vom Outer-Wrapper)
 *   - Resultat: Ein Title-Block (mit Status-Info aus Inner-Panel), ein X (vom Outer).
 *
 * Diese Tests stellen sicher, dass der Fix nicht revertiert wird.
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByRole("tab", { name: "Sequencer" }).click();
});

test.describe("BUG-008: kein doppelter Header in DrumMachine-Floating-Panels", () => {
  test("Pattern Morph: nur EIN 'Pattern Morph'-Header sichtbar", async ({ page }) => {
    await page.locator('button[title="Pattern Morph"]').click();
    // Warten bis das Panel offen ist (Slider erscheint)
    await expect(page.getByLabel("Morph-Menge")).toBeVisible();

    // Innerer Header ("Pattern Morph" mit Status-Info "0% → A") MUSS sichtbar sein.
    // Suche per case-insensitive Regex.
    const matches = await page.getByText(/^pattern morph$/i).count();
    expect(matches, "Pattern Morph header should appear exactly ONCE").toBe(1);
  });

  test("Note Repeat: nur EIN 'Note Repeat'-Header sichtbar", async ({ page }) => {
    await page.locator('button[title="Note Repeat (MPC-Style)"]').click();
    await expect(page.getByLabel("Note Repeat umschalten")).toBeVisible();
    const matches = await page.getByText(/^note repeat$/i).count();
    expect(matches, "Note Repeat header should appear exactly ONCE").toBe(1);
  });

  test("Envelope Follower: nur EIN 'Envelope Follower'-Header sichtbar", async ({ page }) => {
    await page.locator('button[title="Envelope Follower"]').click();
    await expect(page.getByRole("button", { name: /\+ Follower/i })).toBeVisible();
    const matches = await page.getByText(/^envelope follower$/i).count();
    expect(matches, "Envelope Follower header should appear exactly ONCE").toBe(1);
  });

  test("Pattern Morph: nur EIN Close-Button im Panel-Container", async ({ page }) => {
    await page.locator('button[title="Pattern Morph"]').click();
    await expect(page.getByLabel("Morph-Menge")).toBeVisible();

    // Anzahl aller Close-Buttons im DOM zählen.
    // Vor-Fix: 2 (eines vom Outer, eines vom Inner Panel).
    // Nach-Fix: 1.
    // Da andere Tabs/Buttons evtl. ebenfalls Close-Buttons haben, prüfen wir
    // konkret im Panel-Container.
    const total = await page.getByRole("button", { name: "Close" }).count();
    // total schließt auch ggf. den ChatPanel etc. ein — wir erlauben max 1
    // Close-Button im Sequencer ohne weiteren offenen Modal.
    expect(total, "Genau 1 Close-Button für das offene Morph-Panel").toBe(1);
  });

  test("Note Repeat: nur EIN Close-Button im Panel-Container", async ({ page }) => {
    await page.locator('button[title="Note Repeat (MPC-Style)"]').click();
    await expect(page.getByLabel("Note Repeat umschalten")).toBeVisible();
    const total = await page.getByRole("button", { name: "Close" }).count();
    expect(total, "Genau 1 Close-Button für das offene Note-Repeat-Panel").toBe(1);
  });

  test("Envelope Follower: nur EIN Close-Button im Panel-Container", async ({ page }) => {
    await page.locator('button[title="Envelope Follower"]').click();
    await expect(page.getByRole("button", { name: /\+ Follower/i })).toBeVisible();
    const total = await page.getByRole("button", { name: "Close" }).count();
    expect(total, "Genau 1 Close-Button für das offene Envelope-Follower-Panel").toBe(1);
  });

  test("Outer-Close in ResizableDrumPanel schließt das Panel korrekt", async ({ page }) => {
    await page.locator('button[title="Pattern Morph"]').click();
    await expect(page.getByLabel("Morph-Menge")).toBeVisible();
    const closeBtn = page.getByRole("button", { name: "Close" }).first();
    await closeBtn.click();
    await expect(page.getByLabel("Morph-Menge")).toHaveCount(0);
  });
});
