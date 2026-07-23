/**
 * tests/web/loop-sampler.spec.ts
 *
 * Playwright-Smoke für die Loop-Sampler-Buttons in der DrumMachine-Toolbar:
 * pattern-unabhängige Melodie-Loops + Vocal-One-Shots (reuse des Audio-Track-
 * Systems). Der eigentliche Ingest ist Web-Audio (nicht headless testbar) —
 * hier verifizieren wir nur, dass die Einstiegspunkte gerendert + klickbar sind
 * und ein verstecktes Audio-File-Input existiert.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedActivation } from "./_seedApp";

async function openDrumMachine(page: Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
}

test.describe("Loop-Sampler Toolbar-Buttons", () => {
  test("Loop- + One-Shot-Button und das File-Input sind vorhanden", async ({
    page,
  }) => {
    await openDrumMachine(page);

    const loopBtn = page.getByTestId("add-loop-sampler-loop");
    const oneShotBtn = page.getByTestId("add-loop-sampler-oneshot");
    await expect(loopBtn).toBeVisible({ timeout: 10_000 });
    await expect(oneShotBtn).toBeVisible();
    await expect(loopBtn).toContainText("Loop-Sampler");
    await expect(oneShotBtn).toContainText("One-Shot");

    // Verstecktes Audio-File-Input existiert + akzeptiert Audio.
    const input = page.getByTestId("loop-sampler-input");
    await expect(input).toHaveAttribute("type", "file");
    await expect(input).toHaveAttribute("accept", /audio/);
  });
});
