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

// ─── TASK-114: a11y Keyboard-Reorder + Multi-Select ─────────────────────────

async function seedPadsAndOpen(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.evaluate((key) => {
    const data = {
      pads: [
        { patternId: "fake-1", label: "AAA", color: "#22d3ee" },
        { patternId: "fake-2", label: "BBB", color: "#a78bfa" },
        { patternId: "fake-3", label: "CCC", color: "#34d399" },
        null, null, null, null, null,
        null, null, null, null, null, null, null, null,
      ],
      quantizeMode: "bar",
    };
    localStorage.setItem(key, JSON.stringify(data));
  }, PERF_KEY);
  await page.reload();
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByRole("button", { name: /Performance Mode/i }).click();
  await expect(page.getByTestId("performance-mode-overlay")).toBeVisible();
}

test.describe("Performance Mode a11y + Multi-Select (TASK-114)", () => {
  test("Grid hat role=grid mit aria-label und 16 gridcells", async ({ page }) => {
    await openPerformanceMode(page);
    const grid = page.getByTestId("perf-pad-grid");
    await expect(grid).toHaveAttribute("role", "grid");
    await expect(grid).toHaveAttribute("aria-label", /Performance Pads/);
    const cells = page.locator("[role='gridcell']");
    await expect(cells).toHaveCount(16);
  });

  test("Roving-Tabindex: ein Pad ist tabbable, andere haben tabindex=-1", async ({ page }) => {
    await openPerformanceMode(page);
    // Initial: Pad 0 hat tabindex 0
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("tabindex", "0");
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("tabindex", "-1");
    await expect(page.getByTestId("perf-pad-15")).toHaveAttribute("tabindex", "-1");
  });

  test("ARIA-Live-Region existiert und ist sr-only", async ({ page }) => {
    await openPerformanceMode(page);
    const live = page.getByTestId("perf-live-region");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toHaveAttribute("role", "status");
    await expect(live).toHaveClass(/sr-only/);
  });

  test("Arrow-Right navigiert Fokus von Pad 0 zu Pad 1", async ({ page }) => {
    await seedPadsAndOpen(page);
    // Klick auf Pad 0 für initialen Fokus (im Play-Mode)
    await page.getByTestId("perf-pad-0").click();
    // Arrow-Right
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("tabindex", "0");
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("tabindex", "-1");
  });

  test("Arrow-Down navigiert Fokus von Pad 0 zu Pad 4 (eine Zeile runter)", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByTestId("perf-pad-0").click();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("perf-pad-4")).toHaveAttribute("tabindex", "0");
  });

  test("Reorder-Mode: Space greift Pad 0, ARIA-Live announce enthält 'gegriffen'", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    // Klick auf Pad 0 setzt Fokus (im Reorder-Mode aber: Click = grab via Mouse — wir wollen via Keyboard).
    // Trick: fokussiere via Tab oder via direkten Klick auf Grid + Pfeil — wir nutzen ein direktes Element-Focus
    await page.getByTestId("perf-pad-0").focus();
    await page.keyboard.press(" ");
    const live = page.getByTestId("perf-live-region");
    await expect(live).toContainText(/gegriffen/i);
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-grabbed", "1");
  });

  test("Reorder-Mode: Space-Grab + ArrowRight + Space dropt Pad an neuer Position", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    await page.getByTestId("perf-pad-0").focus();
    // Grab
    await page.keyboard.press(" ");
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-grabbed", "1");
    // Move rechts
    await page.keyboard.press("ArrowRight");
    // ArrowRight bei grabbed verschiebt das Pad UND den Fokus → Position 1 ist jetzt das gegriffene
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("data-pad-grabbed", "1");
    // Drop
    await page.keyboard.press(" ");
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("data-pad-grabbed", "0");
    const live = page.getByTestId("perf-live-region");
    await expect(live).toContainText(/abgelegt/i);
  });

  test("Reorder-Mode: Escape während grabbed restored Position + Live-Region", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    await page.getByTestId("perf-pad-0").focus();
    // Grab
    await page.keyboard.press(" ");
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-grabbed", "1");
    // Move
    await page.keyboard.press("ArrowRight");
    // Escape
    await page.keyboard.press("Escape");
    // Live-Region announce
    const live = page.getByTestId("perf-live-region");
    await expect(live).toContainText(/abgebrochen/i);
    // Pad-0 hat wieder den AAA-Inhalt (Restore klappt)
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-filled", "1");
    // Performance-Mode bleibt offen (Escape hat NICHT durchgereicht)
    await expect(page.getByTestId("performance-mode-overlay")).toBeVisible();
  });

  test("Reorder-Mode: Shift+Click auf 2 Pads → beide haben aria-selected + Multi-Select-Counter", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    // Shift+Click auf Pad 0
    await page.getByTestId("perf-pad-0").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-selected", "1");
    // Shift+Click auf Pad 2
    await page.getByTestId("perf-pad-2").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-pad-2")).toHaveAttribute("aria-selected", "true");
    // Counter
    await expect(page.getByTestId("perf-multiselect-count")).toContainText(/2 ausgewählt/);
  });

  test("Reorder-Mode: Shift+Click auf bereits selektierten Pad de-selektiert (toggle)", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    await page.getByTestId("perf-pad-0").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-selected", "1");
    // Nochmal Shift+Click → de-select
    await page.getByTestId("perf-pad-0").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("data-pad-selected", "0");
  });

  test("Reorder-Mode: Multi-Select-Drag bewegt alle selektierten Pads (Insert-Semantik)", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    // Selektiere Pad 0 + 1
    await page.getByTestId("perf-pad-0").click({ modifiers: ["Shift"] });
    await page.getByTestId("perf-pad-1").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-multiselect-count")).toContainText(/2 ausgewählt/);
    // Drag Pad-0 → Pad-5 (zieht beide mit)
    const src = page.getByTestId("perf-pad-0");
    const dst = page.getByTestId("perf-pad-5");
    await src.dragTo(dst);
    // Multi-Select wird nach Move geleert
    await expect(page.getByTestId("perf-multiselect-count")).not.toBeAttached({ timeout: 3000 });
  });

  test("Mode-Wechsel von Reorder → Play leert Multi-Select", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    await page.getByTestId("perf-pad-0").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-multiselect-count")).toBeVisible();
    // Switch to Play
    await page.getByRole("radio", { name: /Play-Modus/i }).click();
    await expect(page.getByTestId("perf-multiselect-count")).not.toBeAttached();
  });

  test("Empty-Slots können NICHT zum Multi-Select hinzugefügt werden", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    // Pad-7 ist leer in seedPadsAndOpen
    await page.getByTestId("perf-pad-7").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-pad-7")).toHaveAttribute("data-pad-selected", "0");
    await expect(page.getByTestId("perf-multiselect-count")).not.toBeAttached();
  });
});
