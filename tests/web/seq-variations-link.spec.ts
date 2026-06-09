/**
 * seq-variations-link.spec.ts — v3.270
 *
 * Die A/B/C/D-Buttons im Sequenzer nutzten bisher lokalen, nicht-persistierten
 * State (varSlots) — getrennt vom gestern gebauten usePatternVariationsStore
 * (Patterns-Tab-Bar). Jetzt teilen beide DENSELBEN Store. Dieser Test beweist
 * die Verknüpfung: im Sequenzer angelegte/aktivierte Slots erscheinen 1:1 in
 * der Patterns-Tab-Bar und umgekehrt.
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.addInitScript(() => {
    try { window.localStorage.removeItem("ss-pattern-variations:v1"); } catch { /* */ }
  });
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("Sequenzer-A/B/C/D nutzen den persistierten Store + sind mit der Patterns-Bar verknüpft", async ({ page }) => {
  // Sequencer ist Default-Tab → Variation-Buttons in der Toolbar.
  const seqA = page.getByTestId("seq-var-slot-A");
  const seqB = page.getByTestId("seq-var-slot-B");
  await expect(seqA).toBeVisible();
  await expect(seqA).toHaveAttribute("aria-pressed", "false");

  // A klicken → legt das Set an, A wird aktiv.
  await seqA.click();
  await expect(seqA).toHaveAttribute("aria-pressed", "true");

  // B klicken → aktuelles Pattern in Slot B kopieren + aktiv.
  await seqB.click();
  await expect(seqB).toHaveAttribute("aria-pressed", "true");
  await expect(seqA).toHaveAttribute("aria-pressed", "false");

  // VERKNÜPFUNG: Patterns-Tab zeigt dasselbe Set (kein "anlegen" mehr, B aktiv).
  await page.getByRole("tab", { name: /^Patterns$/ }).click();
  await expect(page.getByTestId("pattern-variations-bar")).toBeVisible();
  await expect(page.getByTestId("varslot-create")).toHaveCount(0); // Set existiert bereits
  await expect(page.getByTestId("varslot-B")).toHaveAttribute("aria-pressed", "true");

  // Bidirektional: in der Patterns-Bar auf A wechseln …
  await page.getByTestId("varslot-A").click();
  await expect(page.getByTestId("varslot-A")).toHaveAttribute("aria-pressed", "true");

  // … zurück im Sequenzer ist A aktiv (geteilter Store).
  await page.getByRole("tab", { name: /^Sequencer$/ }).click();
  await expect(page.getByTestId("seq-var-slot-A")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("seq-var-slot-B")).toHaveAttribute("aria-pressed", "false");
});
