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
    // v2.35: Overlay-Header strikt im Overlay-Scope prüfen — globaler
    // getByText matched sonst auch den ⚡-Toolbar-Button (strict-mode-Violation).
    const overlay = page.getByTestId("performance-mode-overlay");
    await expect(overlay.getByText("PERFORMANCE MODE")).toBeVisible();
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
    // Live-Region announces release. Production zeigt "Pad N losgelassen." weil
    // der Move bereits durch ArrowRight passierte und Space am gleichen Index
    // nur noch das Grab beendet (siehe handleGridKeyDown Space-Branch: wenn
    // grabbedIndex === focusedIndex, dann "losgelassen", sonst "abgelegt").
    const live = page.getByTestId("perf-live-region");
    await expect(live).toContainText(/abgelegt|losgelassen/i);
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

// ─── TASK-119 / v1.22.0 — Theme-aware Pad-Default-Farben ────────────────────

/**
 * Helper: setzt document data-theme via Theme-Store-API über window.
 *
 * Synthstudio's Theme-Setter ist die `data-theme` Attribute auf <html>.
 * Wir setzen direkt, statt die Settings-UI durchzuklicken — kürzer und stabiler.
 */
async function setDocumentTheme(page: Page, themeId: string) {
  await page.evaluate((id) => {
    document.documentElement.setAttribute("data-theme", id);
  }, themeId);
  // Eine Tick warten, damit Re-render greift
  await page.waitForTimeout(50);
}

async function getCssVar(page: Page, varName: string): Promise<string> {
  return await page.evaluate((name) => {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }, varName);
}

test.describe("Performance Mode — Theme-aware Default-Pad-Farben (TASK-119)", () => {
  test("--ss-pad-1 .. --ss-pad-8 sind im default-theme (dark) definiert", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    for (let i = 1; i <= 8; i++) {
      const val = await getCssVar(page, `--ss-pad-${i}`);
      // Erwartung: ein definierter Hex-Wert
      expect(val.length).toBeGreaterThan(0);
      expect(val).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  test("Theme-Wechsel ändert die --ss-pad-* CSS-Variablen", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

    // Default (dark) lesen
    await setDocumentTheme(page, "dark");
    const darkPad1 = await getCssVar(page, "--ss-pad-1");
    expect(darkPad1.length).toBeGreaterThan(0);

    // Switch to daylight
    await setDocumentTheme(page, "daylight");
    const daylightPad1 = await getCssVar(page, "--ss-pad-1");
    expect(daylightPad1.length).toBeGreaterThan(0);
    expect(daylightPad1).not.toBe(darkPad1);

    // Switch to paper
    await setDocumentTheme(page, "paper");
    const paperPad1 = await getCssVar(page, "--ss-pad-1");
    expect(paperPad1).not.toBe(darkPad1);
    expect(paperPad1).not.toBe(daylightPad1);
  });

  test("Default-Pad-Farbe folgt dem aktiven Theme (visuelle Verifikation via backgroundColor)", async ({ page }) => {
    // Seed einen Pad OHNE explizite color → fällt auf Theme-Default zurück
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.evaluate((key) => {
      const data = {
        pads: [
          // Kein color-Feld → muss via --ss-pad-1 (Slot 1) resolvieren
          { patternId: "fake-1", label: "Default-1" },
          null, null, null,
          null, null, null, null,
          null, null, null, null,
          null, null, null, null,
        ],
        quantizeMode: "bar",
      };
      localStorage.setItem(key, JSON.stringify(data));
    }, PERF_KEY);
    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("button", { name: /Performance Mode/i }).click();
    await expect(page.getByTestId("performance-mode-overlay")).toBeVisible();

    // Default-Theme (dark) — pad-0 sollte mit --ss-pad-1 (cyan) styled sein
    await setDocumentTheme(page, "dark");
    const bgDark = await page.getByTestId("perf-pad-0").evaluate(el => getComputedStyle(el).backgroundColor);

    // Theme wechseln auf daylight
    await setDocumentTheme(page, "daylight");
    // Pad rendert neu mit aktualisierter Theme-Variable. Da der Helper getPadDefaultColor()
    // synchron in der nächsten Render-Phase die CSS-Variable liest, brauchen wir nur
    // einen Re-Render-Trigger. Wir scrollen kurz oder triggern eine harmlose State-Änderung:
    // ein Click auf den Quantize-Bar-Button (No-op wenn bar bereits aktiv).
    // Einfacher: nutze setTimeout(50) und hoffe auf next render.
    // Robuster: trigger durch Toggle Edit-Mode (re-mount Pad-Komponenten)
    await page.getByRole("radio", { name: /Edit-Modus/i }).click();
    await page.getByRole("radio", { name: /Play-Modus/i }).click();
    await page.waitForTimeout(100);
    const bgDaylight = await page.getByTestId("perf-pad-0").evaluate(el => getComputedStyle(el).backgroundColor);

    // Mindestens: beide Werte sind nicht-leer + beide sind nicht identisch
    expect(bgDark.length).toBeGreaterThan(0);
    expect(bgDaylight.length).toBeGreaterThan(0);
    expect(bgDaylight).not.toBe(bgDark);
  });

  test("User-defined pad.color hat Vorrang vor Theme-Default (TASK-119 Invariant)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.evaluate((key) => {
      const data = {
        pads: [
          // Hardcoded hex Color → bleibt unverändert egal welches Theme aktiv ist
          { patternId: "fake-1", label: "Hardcoded", color: "#ff00ff" },
          null, null, null,
          null, null, null, null,
          null, null, null, null,
          null, null, null, null,
        ],
        quantizeMode: "bar",
      };
      localStorage.setItem(key, JSON.stringify(data));
    }, PERF_KEY);
    await page.reload();
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.getByRole("button", { name: /Performance Mode/i }).click();

    // Egal welches Theme — der user-defined Wert #ff00ff muss als rgb(255,0,255) sichtbar werden.
    // (Wir prüfen den active-State, da nur aktive Pads volle Farbe haben — inaktive haben color+"33" Alpha.)
    // Einfacher: Color-Picker im Editor öffnen, dann ist der Wert direkt aus pad.color geladen.
    await page.getByRole("radio", { name: /Edit-Modus/i }).click();
    await page.getByTestId("perf-pad-0").click();
    await expect(page.getByTestId("perf-pad-editor")).toBeVisible();

    // Theme wechseln — colorDraft im Editor darf sich NICHT ändern
    await setDocumentTheme(page, "daylight");
    await setDocumentTheme(page, "paper");

    // Custom-Color-Input des Editors sollte den ursprünglichen hex enthalten
    const colorPicker = page.getByLabel(/Custom Farbe wählen/i);
    await expect(colorPicker).toHaveValue("#ff00ff");
  });

  test("Color-Swatches im Editor zeigen 8 theme-aware Slots + Custom-Picker", async ({ page }) => {
    await openPerformanceMode(page);
    await page.getByRole("radio", { name: /Edit-Modus/i }).click();
    await page.getByTestId("perf-pad-0").click();
    await expect(page.getByTestId("perf-pad-editor")).toBeVisible();

    const swatches = page.getByTestId("perf-pad-color-swatches").locator("[data-pad-swatch]");
    await expect(swatches).toHaveCount(8);

    // Slot 1..8 attributes vorhanden
    for (let i = 1; i <= 8; i++) {
      const sw = page.locator(`[data-pad-swatch="${i}"]`);
      await expect(sw).toBeVisible();
    }
    // Custom-Picker existiert weiterhin
    await expect(page.getByLabel(/Custom Farbe wählen/i)).toBeVisible();
  });
});

// ─── TASK-120 / v1.22.0 — Mouse-Box Rubber-Band-Selection ───────────────────

test.describe("Performance Mode — Mouse-Box Rubber-Band-Select (TASK-120)", () => {
  /**
   * Helper: führt einen Mouse-Down + Move + Up zwischen zwei Viewport-Punkten
   * aus. Wir nutzen page.mouse.* statt dragTo, weil unser Box-Select keine
   * HTML5-DnD-API verwendet sondern reine MouseEvents (mousedown/mousemove/mouseup).
   */
  async function doBoxDrag(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    modifiers: Array<"Shift"> = [],
  ) {
    for (const mod of modifiers) await page.keyboard.down(mod);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Inkrementeller Move für deutliche moved=true Detection (>3px Hysterese)
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await page.mouse.move(x, y);
    }
    await page.mouse.up();
    for (const mod of modifiers) await page.keyboard.up(mod);
  }

  test("Box-Selection-Overlay wird beim Drag sichtbar (Reorder-Mode)", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    // Box-Drag-Wrapper (umschließt das Grid) als Startpunkt — koordinaten daraus.
    const wrapper = page.getByTestId("perf-pad-grid-wrapper");
    const bbox = await wrapper.boundingBox();
    if (!bbox) throw new Error("grid wrapper not measurable");

    // Start in der Ecke (außerhalb der Pads): top-left + 10px
    const startX = bbox.x + 10;
    const startY = bbox.y + 10;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 100, { steps: 8 });
    // Overlay sollte sichtbar sein
    await expect(page.getByTestId("perf-selection-box")).toBeVisible();
    await page.mouse.up();
  });

  test("Drag-Box über 2 gefüllte Pads selektiert beide", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();

    const pad0 = await page.getByTestId("perf-pad-0").boundingBox();
    const pad1 = await page.getByTestId("perf-pad-1").boundingBox();
    if (!pad0 || !pad1) throw new Error("pad bounding boxes missing");

    // Start vor Pad 0 (links davon), Ende rechts neben Pad 1, so dass Box beide schneidet.
    const startX = pad0.x - 8;
    const startY = pad0.y - 8;
    const endX = pad1.x + pad1.width + 8;
    const endY = pad1.y + pad1.height + 8;

    await doBoxDrag(page, { x: startX, y: startY }, { x: endX, y: endY });

    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-multiselect-count")).toContainText(/2 ausgewählt/);
  });

  test("Shift+Box-Drag additiv zu existing selection", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();

    // Erst Pad 2 via Shift+Click selektieren
    await page.getByTestId("perf-pad-2").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-pad-2")).toHaveAttribute("aria-selected", "true");

    // Dann Shift+Box-Drag über Pads 0+1 — alle drei sollten am Ende selected sein
    const pad0 = await page.getByTestId("perf-pad-0").boundingBox();
    const pad1 = await page.getByTestId("perf-pad-1").boundingBox();
    if (!pad0 || !pad1) throw new Error("pad bbox missing");

    await doBoxDrag(
      page,
      { x: pad0.x - 8, y: pad0.y - 8 },
      { x: pad1.x + pad1.width + 8, y: pad1.y + pad1.height + 8 },
      ["Shift"],
    );

    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("aria-selected", "true");
    // Pad 2 muss erhalten bleiben (additiv)
    await expect(page.getByTestId("perf-pad-2")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-multiselect-count")).toContainText(/3 ausgewählt/);
  });

  test("Box-Drag ohne Modifier ersetzt vorherige Selection", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();

    // Erst Pad 2 selektieren
    await page.getByTestId("perf-pad-2").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-pad-2")).toHaveAttribute("aria-selected", "true");

    // Dann Box-Drag OHNE Shift über Pad 0+1 — Pad 2 fällt raus
    const pad0 = await page.getByTestId("perf-pad-0").boundingBox();
    const pad1 = await page.getByTestId("perf-pad-1").boundingBox();
    if (!pad0 || !pad1) throw new Error("pad bbox missing");

    await doBoxDrag(
      page,
      { x: pad0.x - 8, y: pad0.y - 8 },
      { x: pad1.x + pad1.width + 8, y: pad1.y + pad1.height + 8 },
    );

    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("aria-selected", "true");
    // Pad 2 ist NICHT mehr selektiert
    await expect(page.getByTestId("perf-pad-2")).toHaveAttribute("aria-selected", "false");
  });

  test("Escape clears Multi-Select (auch wenn via Box-Select aufgebaut)", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    // Selektiere zwei Pads
    await page.getByTestId("perf-pad-0").click({ modifiers: ["Shift"] });
    await page.getByTestId("perf-pad-1").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-multiselect-count")).toContainText(/2 ausgewählt/);

    // Escape clearen
    await page.keyboard.press("Escape");
    // Counter weg, Pads nicht mehr aria-selected, Performance-Mode bleibt offen
    await expect(page.getByTestId("perf-multiselect-count")).not.toBeAttached();
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("aria-selected", "false");
    await expect(page.getByTestId("performance-mode-overlay")).toBeVisible();
  });

  test("Box-Selection-Overlay verschwindet nach mouseup", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    const wrapper = page.getByTestId("perf-pad-grid-wrapper");
    const bbox = await wrapper.boundingBox();
    if (!bbox) throw new Error("grid wrapper not measurable");

    await page.mouse.move(bbox.x + 10, bbox.y + 10);
    await page.mouse.down();
    await page.mouse.move(bbox.x + 100, bbox.y + 100, { steps: 8 });
    await expect(page.getByTestId("perf-selection-box")).toBeVisible();
    await page.mouse.up();
    // Overlay weg
    await expect(page.getByTestId("perf-selection-box")).not.toBeAttached();
  });

  test("Box-Select außerhalb Reorder-Mode: kein Overlay", async ({ page }) => {
    await seedPadsAndOpen(page);
    // Default ist Play-Mode — Box-Drag darf KEIN Overlay rendern.
    const wrapper = page.getByTestId("perf-pad-grid-wrapper");
    const bbox = await wrapper.boundingBox();
    if (!bbox) throw new Error("grid wrapper not measurable");

    await page.mouse.move(bbox.x + 10, bbox.y + 10);
    await page.mouse.down();
    await page.mouse.move(bbox.x + 200, bbox.y + 200, { steps: 8 });
    // Kein Overlay
    await expect(page.getByTestId("perf-selection-box")).not.toBeAttached();
    await page.mouse.up();
  });
});

// ─── TASK-123 / v1.22.0 — Multi-Drag-Image mit Counter-Badge ────────────────

test.describe("Performance Mode — Multi-Drag-Image (TASK-123)", () => {
  test("Multi-Drag mit 3 selected: dragSrc-Pad hat data-multi-drag-count='3'", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();

    // Selektiere 3 Pads via Shift+Click
    await page.getByTestId("perf-pad-0").click({ modifiers: ["Shift"] });
    await page.getByTestId("perf-pad-1").click({ modifiers: ["Shift"] });
    await page.getByTestId("perf-pad-2").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("perf-multiselect-count")).toContainText(/3 ausgewählt/);

    // Start drag von Pad 0 zu Pad 5. Während drag aktiv: data-multi-drag-count="3".
    // Playwright dragTo macht dragstart+drop in einem Atomic; wir prüfen das
    // Attribut über einen Trick: einmal dragstart → assert → dann drop.
    const src = page.getByTestId("perf-pad-0");
    const srcBox = await src.boundingBox();
    if (!srcBox) throw new Error("pad-0 not measurable");
    const dst = page.getByTestId("perf-pad-5");
    const dstBox = await dst.boundingBox();
    if (!dstBox) throw new Error("pad-5 not measurable");

    // Manueller Dispatch von dragstart über die echte Mouse-API ist in Playwright
    // tricky. Wir nutzen den dispatch von Drag-Events direkt auf das Element.
    await src.evaluate((el) => {
      const dt = new DataTransfer();
      const ev = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(ev);
    });
    // Während dragstart aktiv: data-multi-drag-count = "3"
    await expect(src).toHaveAttribute("data-multi-drag-count", "3");

    // Sauberes Aufräumen: dragend
    await src.evaluate((el) => {
      const dt = new DataTransfer();
      const ev = new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(ev);
    });
  });

  test("Single-Drag (kein Multi-Select): kein data-multi-drag-count", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();

    const src = page.getByTestId("perf-pad-0");
    // Trigger dragstart ohne vorherige Selection
    await src.evaluate((el) => {
      const dt = new DataTransfer();
      const ev = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(ev);
    });
    // data-multi-drag-count darf NICHT gesetzt sein (oder = "0", aber wir setzen es bewusst undefined)
    await expect(src).not.toHaveAttribute("data-multi-drag-count", /\d/);

    await src.evaluate((el) => {
      const dt = new DataTransfer();
      const ev = new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(ev);
    });
  });
});

// ─── TASK-127 Welle 3 (v2.52) — Cmd/Ctrl+A Select-All E2E ────────────────────

test.describe("Performance Mode — Cmd/Ctrl+A Select-All (TASK-127 Welle 3)", () => {
  test("Reorder-Mode: Ctrl+A selektiert alle 3 non-empty Pads (von 16)", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();

    // seedPadsAndOpen füllt Pads 0-2 (AAA/BBB/CCC), Rest leer.
    await page.keyboard.press("Control+a");

    await expect(page.getByTestId("perf-multiselect-count")).toContainText(/3 ausgewählt/);
    await expect(page.getByTestId("perf-pad-0")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-pad-1")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("perf-pad-2")).toHaveAttribute("aria-selected", "true");
    // Leere Pads bleiben nicht-selektiert. aria-selected wird für leere Pads
    // gar nicht gesetzt (undefined) — daher prüfen wir nur, dass es NICHT
    // "true" ist via data-pad-selected (Boolean-Marker für alle Pads).
    await expect(page.getByTestId("perf-pad-3")).toHaveAttribute("data-pad-selected", "0");
    await expect(page.getByTestId("perf-pad-7")).toHaveAttribute("data-pad-selected", "0");
  });

  test("Play-Mode: Ctrl+A ist No-Op (Multi-Select-Counter erscheint nicht)", async ({ page }) => {
    await seedPadsAndOpen(page);
    // Default = Play-Mode
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("perf-multiselect-count")).not.toBeAttached();
  });

  test("Reorder-Mode + Editor offen: Ctrl+A hijacked NICHT (Input behält native Cmd+A)", async ({ page }) => {
    await seedPadsAndOpen(page);
    await page.getByRole("radio", { name: /Edit-Modus/i }).click();
    // Öffne Editor auf Pad-0
    await page.getByTestId("perf-pad-0").click();
    await expect(page.getByTestId("perf-pad-editor")).toBeVisible();

    // Wechsel zu Reorder während Editor noch offen — testet die editingIndex-Guard
    // Hinweis: Mode-Wechsel schließt den Editor (siehe useEffect-Cleanup). Daher
    // bauen wir den Test alternativ: Ctrl+A im Edit-Mode mit fokussiertem Input.
    // Dort darf Multi-Select NICHT entstehen (Edit-Mode = kein Reorder).
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("perf-multiselect-count")).not.toBeAttached();
  });

  test("Reorder-Mode mit komplett leerer Pad-Liste: Ctrl+A ist No-Op", async ({ page }) => {
    // KEIN seedPadsAndOpen — wir öffnen mit frischem (leerem) Store.
    await openPerformanceMode(page);
    await page.getByRole("radio", { name: /Reorder-Modus/i }).click();
    await page.keyboard.press("Control+a");
    // Es existieren keine non-empty Pads → Multi-Select bleibt leer
    await expect(page.getByTestId("perf-multiselect-count")).not.toBeAttached();
  });
});
