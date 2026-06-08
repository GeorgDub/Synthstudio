/**
 * pattern-variations.spec.ts — v3.269
 *
 * Das A/B/C/D-Variation-Slot-Feature (usePatternVariationsStore) war gebaut +
 * getestet, aber NIRGENDS gemountet (toter Store). Jetzt als PatternVariationsBar
 * im Patterns-Tab verdrahtet: anlegen → Slot füllen (Pattern kopieren) → switchen.
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("synthstudio:license:v1", JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }));
      window.localStorage.setItem("synthstudio:welcome:v1", JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }));
      window.localStorage.removeItem("ss-pattern-variations:v1");
    } catch { /* */ }
  });
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("Variation-Slots: anlegen → Slot B füllen → zwischen A/B switchen", async ({ page }) => {
  await page.getByRole("tab", { name: /^Patterns$/ }).click();
  await expect(page.getByTestId("pattern-variations-bar")).toBeVisible();

  // Noch kein Set → Anlegen-Button.
  const create = page.getByTestId("varslot-create");
  await expect(create).toBeVisible();
  await create.click();

  // Set angelegt: A aktiv (gefüllt), B/C/D leer.
  await expect(page.getByTestId("varslot-A")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("varslot-B")).toHaveAttribute("aria-pressed", "false");

  // Leeren Slot B klicken → aktuelles Pattern wird hineinkopiert + aktiv.
  await page.getByTestId("varslot-B").click();
  await expect(page.getByTestId("varslot-B")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("varslot-A")).toHaveAttribute("aria-pressed", "false");

  // Zurück auf A → Live-Switch (aktives Pattern wechselt zurück).
  await page.getByTestId("varslot-A").click();
  await expect(page.getByTestId("varslot-A")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("varslot-B")).toHaveAttribute("aria-pressed", "false");

  // Erneut auf B → Live-Switch zurück auf die Kopie (B wieder aktiv).
  await page.getByTestId("varslot-B").click();
  await expect(page.getByTestId("varslot-B")).toHaveAttribute("aria-pressed", "true");
});
