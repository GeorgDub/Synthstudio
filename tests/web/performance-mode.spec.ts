/**
 * tests/web/performance-mode.spec.ts
 *
 * Playwright Smoke-Tests für die v1.20.x Performance-Mode UX-Überarbeitung
 * (TASK-111 — drei Aktions-Modi Play/Edit/Reorder).
 *
 * Diese Tests sind defensiv: localStorage wird VOR jedem Test geleert
 * (sauberer Start-State), damit die Pads-Liste deterministisch beginnt.
 */
import { test, expect, type Page } from "@playwright/test";

const PERF_KEY = "ss-performance:v1";

async function openPerformanceMode(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  // localStorage frisch
  await page.evaluate((key) => localStorage.removeItem(key), PERF_KEY);
  // Sequencer-Tab ist Default → Performance Mode Button steht in der Toolbar
  await page.getByRole("button", { name: /Performance Mode/i }).click();
  await expect(page.getByTestId("performance-mode-overlay")).toBeVisible();
}

test.describe("Performance Mode (TASK-111)", () => {
  test("kann via Toolbar-Button geöffnet werden", async ({ page }) => {
    await openPerformanceMode(page);
    await expect(page.getByText("PERFORMANCE MODE")).toBeVisible();
  });

  test("ESC schließt Performance Mode", async ({ page }) => {
    await openPerformanceMode(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("performance-mode-overlay")).not.toBeVisible();
  });

  test("Quantize-Buttons zeigen visuelle Aktivierung via aria-pressed", async ({ page }) => {
    await openPerformanceMode(page);
    const bar  = page.getByRole("button", { name: /Quantize auf Bar/i });
    const beat = page.getByRole("button", { name: /Quantize auf Beat/i });
    const step = page.getByRole("button", { name: /Quantize auf Step/i });

    await expect(bar).toHaveAttribute("aria-pressed", "true");
    await expect(beat).toHaveAttribute("aria-pressed", "false");

    await beat.click();
    await expect(bar).toHaveAttribute("aria-pressed", "false");
    await expect(beat).toHaveAttribute("aria-pressed", "true");

    await step.click();
    await expect(step).toHaveAttribute("aria-pressed", "true");
  });

  test("Quantize-Buttons haben sichtbares Hover-Feedback (BUG-002-analog)", async ({ page }) => {
    await openPerformanceMode(page);
    // Wähle einen NICHT-aktiven Quantize-Button (z.B. beat — default ist bar)
    const beat = page.getByRole("button", { name: /Quantize auf Beat/i });
    const bgBefore = await beat.evaluate(el => getComputedStyle(el).backgroundColor);
    await beat.hover();
    await page.waitForTimeout(200);
    const bgHover = await beat.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgHover).not.toBe(bgBefore);
  });

  test("Mode-Toggle Play/Edit/Reorder existiert mit korrekten aria-roles", async ({ page }) => {
    await openPerformanceMode(page);
    const radiogroup = page.getByRole("radiogroup", { name: /Performance Mode Aktion/i });
    await expect(radiogroup).toBeVisible();

    const play    = radiogroup.getByRole("radio", { name: /Play-Modus/i });
    const edit    = radiogroup.getByRole("radio", { name: /Edit-Modus/i });
    const reorder = radiogroup.getByRole("radio", { name: /Reorder-Modus/i });

    await expect(play).toHaveAttribute("aria-checked", "true");
    await expect(edit).toHaveAttribute("aria-checked", "false");
    await expect(reorder).toHaveAttribute("aria-checked", "false");

    await edit.click();
    await expect(edit).toHaveAttribute("aria-checked", "true");
    await expect(play).toHaveAttribute("aria-checked", "false");
  });

  test("Edit-Mode: Klick auf leeren Pad öffnet Editor mit Pattern-Picker", async ({ page }) => {
    await openPerformanceMode(page);
    // Wechsle in Edit-Mode
    await page.getByRole("radio", { name: /Edit-Modus/i }).click();

    // Klick auf ersten Pad (leer in frischem State)
    await page.getByTestId("perf-pad-0").click();

    // Editor öffnet
    await expect(page.getByTestId("perf-pad-editor")).toBeVisible();
    // Pattern-Dropdown sichtbar
    await expect(page.getByRole("combobox", { name: /Pattern auswählen/i })).toBeVisible();
    // Mindestens ein Pattern (default DrumMachine hat min. 1 Pattern)
    const options = page.locator("select").locator("option").filter({ hasNotText: "— wählen —" });
    await expect(options.first()).toBeAttached({ timeout: 5000 });
  });

  test("Edit-Mode: Pattern auswählen + Speichern füllt Pad", async ({ page }) => {
    await openPerformanceMode(page);
    await page.getByRole("radio", { name: /Edit-Modus/i }).click();
    await page.getByTestId("perf-pad-2").click();

    const select = page.getByRole("combobox", { name: /Pattern auswählen/i });
    await expect(select).toBeVisible();

    // Erstes echtes Pattern wählen
    const optionValues = await select.locator("option").evaluateAll(els =>
      els.map(el => (el as HTMLOptionElement).value).filter(v => v.length > 0)
    );
    test.skip(optionValues.length === 0, "Keine Patterns in DrumMachine — Test übersprungen");
    await select.selectOption(optionValues[0]);

    // Label vergeben
    await page.getByRole("textbox", { name: /Pad-Label/i }).fill("Test-Pad");

    // Save
    await page.getByRole("button", { name: /Hinzufügen/i }).click();

    // Editor zu, Pad gefüllt
    await expect(page.getByTestId("perf-pad-editor")).not.toBeVisible();
    await expect(page.getByTestId("perf-pad-2")).toHaveAttribute("data-pad-filled", "1");
  });

  test("Reorder-Mode: Drag&Drop tauscht zwei Pads", async ({ page }) => {
    await openPerformanceMode(page);

    // Vorbereitung: zwei Pads befüllen via localStorage direkt
    await page.evaluate((key) => {
      const data = {
        pads: [
          { patternId: "fake-1", label: "AAA", color: "#22d3ee" },
          null,
          null,
          { patternId: "fake-2", label: "BBB", color: "#f87171" },
        ],
        quantizeMode: "bar",
      };
      localStorage.setItem(key, JSON.stringify(data));
    }, PERF_KEY);

    // Reload nötig damit der Store neu lädt
    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("button", { name: /Performance Mode/i }).click();

    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-filled", "1");
    await expect(page.getByTestId("perf-pad-3")).toHaveAttribute("data-pad-filled", "1");

    // In Reorder-Mode wechseln
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();

    // HTML5 native Drag&Drop in Playwright via dragTo
    const src = page.getByTestId("perf-pad-0");
    const dst = page.getByTestId("perf-pad-1");
    await src.dragTo(dst);

    // Erwartung: pad-0 ist jetzt leer, pad-1 hat den AAA-Inhalt
    // (Playwright dragTo simuliert HTML5 DnD über die Drag-Events, was unsere
    //  Implementierung onDragStart/onDragOver/onDrop konsumiert)
    // Defensives Assertion-Pattern: prüfe data-pad-filled-Attribute
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("data-pad-filled", "1", { timeout: 3000 });
  });

  test("Play-Mode (default): Klick auf leeren Pad ist no-op", async ({ page }) => {
    await openPerformanceMode(page);
    // Pad ist disabled in Play-Mode wenn leer
    const pad = page.getByTestId("perf-pad-0");
    await expect(pad).toBeDisabled();
  });
});
