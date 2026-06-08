/**
 * tests/web/macros.spec.ts (TASK-126)
 *
 * Playwright-Smoke für die App.tsx-Wiring-Kette des Macro-Hold-Modes:
 *
 *   MacroButton.mouseDown  →  triggerMacroButton(macro.index)
 *                             → window.dispatchEvent('macro:button:trigger')
 *                             → App.tsx onTrigger
 *                             → startHoldLoop(macroIndex, runScriptOnce, 200ms)
 *   MacroButton.mouseUp    →  triggerMacroButtonRelease(macro.index)
 *                             → window.dispatchEvent('macro:button:release')
 *                             → App.tsx onRelease
 *                             → stopHoldLoop(macroIndex)
 *
 * Die TASK-118 Unit-Tests decken den macroHoldLoop-Helper isoliert ab; die hier
 * geprüfte Wiring-Schicht (DOM-Event → CustomEvent → App-Listener → Loop) hat
 * bisher keine E2E-Coverage gehabt.
 *
 * Strategie:
 *   1. localStorage pre-seeden mit:
 *      • einem Macro (Index 0) im Button-Mode + Hold-Trigger-Mode + scriptId
 *      • einem Script mit demselben scriptId (enabled, einfacher No-op-Code)
 *   2. App öffnen, "M1–8" Toggle klicken → MacroPanel sichtbar
 *   3. Auf `window` Event-Counter installieren für trigger + release
 *   4. mousedown auf den Macro-Button → trigger-Event MUSS feuern (triggerMode='hold')
 *   5. 500ms warten
 *   6. mouseup → release-Event MUSS feuern
 *   7. Counter prüfen
 *
 * Browser-only: läuft via pnpm test:web gegen Vite-Dev-Server.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedActivation } from "./_seedApp";

const MACRO_INDEX = 0;
const SCRIPT_ID = "test-hold-script";

const SEEDED_SCRIPT = {
  id: SCRIPT_ID,
  name: "Hold-Mode Test Script",
  code: "// no-op for hold-mode wiring test",
  enabled: true,
  maxRuntimeMs: 1000,
  scope: "app",
};

/**
 * Pre-seed localStorage with a fully configured Macro + Script.
 *
 * Macro-Schema entspricht aktuellem useMacroStore: index, label, value,
 * bindings[], color, mode, triggerKind, triggerMode, scriptId.
 * Script-Schema entspricht aktuellem useScriptStore: id, name, code,
 * enabled, maxRuntimeMs, scope.
 */
async function seedStorage(page: Page) {
  await page.addInitScript(
    ({ macroIndex, scriptId, script }) => {
      try {
        // 8 Default-Macros, Index 0 ist button + hold + scriptId verlinkt.
        const macros = Array.from({ length: 8 }, (_, i) => ({
          index: i,
          label: `Macro ${i + 1}`,
          value: 0,
          bindings: [],
          color: "#f59e0b",
          mode: i === macroIndex ? "button" : "knob",
          triggerKind: "script",
          triggerMode: i === macroIndex ? "hold" : "edge",
          scriptId: i === macroIndex ? scriptId : undefined,
        }));
        window.localStorage.setItem("ss-macros:v1", JSON.stringify(macros));
        // Scripts: nur das eine Test-Skript
        window.localStorage.setItem("ss-scripts:v1", JSON.stringify([script]));
      } catch {
        /* ignore */
      }
    },
    { macroIndex: MACRO_INDEX, scriptId: SCRIPT_ID, script: SEEDED_SCRIPT },
  );
}

async function openMacroPanel(page: Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  // DrumMachine ist Default-Tab — der Macro-Toggle ist direkt sichtbar.
  // Falls Tab-Routing einen anderen Default hat: explizit klicken.
  const toggle = page.getByTestId("toggle-macro-panel");
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();
}

async function installEventCounters(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __macroTriggerEvents: Array<{ macroIndex: number; triggerMode?: string; triggerKind?: string; scriptId?: string }>;
      __macroReleaseEvents: Array<{ macroIndex: number }>;
    };
    w.__macroTriggerEvents = [];
    w.__macroReleaseEvents = [];
    window.addEventListener("macro:button:trigger", (ev) => {
      const detail = (ev as CustomEvent).detail;
      if (detail) w.__macroTriggerEvents.push(detail);
    });
    window.addEventListener("macro:button:release", (ev) => {
      const detail = (ev as CustomEvent).detail;
      if (detail) w.__macroReleaseEvents.push(detail);
    });
  });
}

test.describe("Macro Hold-Mode UI-Wiring (TASK-126)", () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page);
  });

  test("MacroButton mit triggerMode='hold' zeigt das Hold-Indikator-Attribut", async ({ page }) => {
    await openMacroPanel(page);
    const macroBtn = page.getByTestId(`macro-button-${MACRO_INDEX}`);
    await expect(macroBtn).toBeVisible();
    await expect(macroBtn).toHaveAttribute("data-macro-trigger-mode", "hold");
    await expect(macroBtn).toHaveAttribute("data-macro-trigger-kind", "script");
    // aria-label enthält "Hold-Mode" Marker
    await expect(macroBtn).toHaveAttribute("aria-label", /Hold-Mode/);
  });

  test("mouseDown auf Hold-Button feuert trigger-Event mit triggerMode='hold'", async ({ page }) => {
    await openMacroPanel(page);
    await installEventCounters(page);
    const macroBtn = page.getByTestId(`macro-button-${MACRO_INDEX}`);

    // mouseDown ohne mouseUp: das löst nur den trigger aus
    const box = await macroBtn.boundingBox();
    if (!box) throw new Error("Macro button has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Kleines Warten, damit das Event durch den React-Tick durchläuft
    await page.waitForTimeout(50);

    const triggers = await page.evaluate(() => (window as unknown as {
      __macroTriggerEvents: Array<{ macroIndex: number; triggerMode?: string; triggerKind?: string; scriptId?: string }>;
    }).__macroTriggerEvents);

    expect(triggers.length).toBeGreaterThanOrEqual(1);
    expect(triggers[0].macroIndex).toBe(MACRO_INDEX);
    expect(triggers[0].triggerMode).toBe("hold");
    expect(triggers[0].triggerKind).toBe("script");
    expect(triggers[0].scriptId).toBe(SCRIPT_ID);

    // mouseUp am Ende — sonst hängt der Hold-Loop für die nächste Test-Run-Iteration
    await page.mouse.up();
  });

  test("mouseUp nach Hold feuert release-Event mit korrektem macroIndex", async ({ page }) => {
    await openMacroPanel(page);
    await installEventCounters(page);
    const macroBtn = page.getByTestId(`macro-button-${MACRO_INDEX}`);

    const box = await macroBtn.boundingBox();
    if (!box) throw new Error("Macro button has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    // Kurze Pause für Event-Propagation
    await page.waitForTimeout(50);

    const releases = await page.evaluate(() => (window as unknown as {
      __macroReleaseEvents: Array<{ macroIndex: number }>;
    }).__macroReleaseEvents);

    expect(releases.length).toBeGreaterThanOrEqual(1);
    expect(releases[0].macroIndex).toBe(MACRO_INDEX);
  });

  test("Vollständiger 500ms-Hold: trigger fires once, release fires once, keine weiteren triggers nach release", async ({ page }) => {
    await openMacroPanel(page);
    await installEventCounters(page);
    const macroBtn = page.getByTestId(`macro-button-${MACRO_INDEX}`);

    const box = await macroBtn.boundingBox();
    if (!box) throw new Error("Macro button has no bounding box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 500ms gedrückt halten — die HOLD-Loop läuft im App.tsx-Handler ab,
    // dispatcht aber KEINE neuen trigger-Events (Loop ist intern).
    await page.waitForTimeout(500);
    await page.mouse.up();
    // Weitere 300ms warten + verifizieren dass danach KEINE neuen triggers kommen
    const triggersAtRelease = await page.evaluate(() => (window as unknown as {
      __macroTriggerEvents: Array<unknown>;
    }).__macroTriggerEvents.length);
    await page.waitForTimeout(300);
    const triggersAfter = await page.evaluate(() => (window as unknown as {
      __macroTriggerEvents: Array<unknown>;
    }).__macroTriggerEvents.length);

    expect(triggersAtRelease).toBe(1);
    expect(triggersAfter).toBe(1); // KEIN weiteres trigger-Event nach release

    const releases = await page.evaluate(() => (window as unknown as {
      __macroReleaseEvents: Array<unknown>;
    }).__macroReleaseEvents.length);
    expect(releases).toBe(1);
  });
});

// ─── TASK-126 Welle 2 (v2.59) — Pad-Hold-Mode E2E ────────────────────────────
//
// Spiegelt das Script-Hold-Setup oben, aber mit triggerKind="pad" + einer
// Performance-Pad-Seed. Verifiziert die App.tsx-Wiring-Kette:
//
//   MacroButton.mouseDown (triggerKind=pad)
//                          →  triggerMacroButton(macro.index)
//                             → window.dispatchEvent('macro:button:trigger',
//                                   { macroIndex, triggerKind:'pad', padIndex, triggerMode:'hold' })
//                             → App.tsx onTrigger
//                             → startHoldLoop(macroIndex, () => runPadOnce(padIndex), 100ms)
//
// Der pad-hold-Pfad (App.tsx Z.975–984) ist Unit-getestet (macros.test.ts
// Pad-Schema-Tests + macroHoldLoop.test.ts Loop-Mechanik), aber die End-to-End
// Wire-Coverage über DOM + CustomEvent + Listener war bisher nur für script-hold da.

const PAD_MACRO_INDEX = 1;
const PAD_INDEX = 0;

async function seedPadHoldStorage(page: Page) {
  await page.addInitScript(
    ({ macroIndex, padIndex }) => {
      try {
        const macros = Array.from({ length: 8 }, (_, i) => ({
          index: i,
          label: `Macro ${i + 1}`,
          value: 0,
          bindings: [],
          color: "#a78bfa",
          mode: i === macroIndex ? "button" : "knob",
          triggerKind: i === macroIndex ? "pad" : "script",
          triggerMode: i === macroIndex ? "hold" : "edge",
          padIndex: i === macroIndex ? padIndex : undefined,
        }));
        window.localStorage.setItem("ss-macros:v1", JSON.stringify(macros));
        // Mindestens ein Performance-Pad mit patternId, damit runPadOnce kein
        // Early-Return macht (pad.patternId-Check in App.tsx Z.957).
        const perf = {
          pads: [
            { patternId: "seeded-pattern", label: "PAD0", color: "#22d3ee" },
            null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
          ],
          quantizeMode: "bar",
        };
        window.localStorage.setItem("ss-performance:v1", JSON.stringify(perf));
      } catch {
        /* ignore */
      }
    },
    { macroIndex: PAD_MACRO_INDEX, padIndex: PAD_INDEX },
  );
}

test.describe("Macro Pad-Hold-Mode UI-Wiring (TASK-126 Welle 2)", () => {
  test.beforeEach(async ({ page }) => {
    await seedPadHoldStorage(page);
  });

  test("MacroButton zeigt data-macro-trigger-kind='pad' + 'hold'", async ({ page }) => {
    await openMacroPanel(page);
    const macroBtn = page.getByTestId(`macro-button-${PAD_MACRO_INDEX}`);
    await expect(macroBtn).toBeVisible();
    await expect(macroBtn).toHaveAttribute("data-macro-trigger-kind", "pad");
    await expect(macroBtn).toHaveAttribute("data-macro-trigger-mode", "hold");
  });

  test("mouseDown auf Pad-Hold-Button feuert trigger-Event mit padIndex", async ({ page }) => {
    await openMacroPanel(page);
    await installEventCounters(page);
    const macroBtn = page.getByTestId(`macro-button-${PAD_MACRO_INDEX}`);

    const box = await macroBtn.boundingBox();
    if (!box) throw new Error("Macro button has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    const triggers = await page.evaluate(() => (window as unknown as {
      __macroTriggerEvents: Array<{ macroIndex: number; triggerMode?: string; triggerKind?: string; padIndex?: number }>;
    }).__macroTriggerEvents);

    expect(triggers.length).toBeGreaterThanOrEqual(1);
    expect(triggers[0].macroIndex).toBe(PAD_MACRO_INDEX);
    expect(triggers[0].triggerKind).toBe("pad");
    expect(triggers[0].triggerMode).toBe("hold");
    expect(triggers[0].padIndex).toBe(PAD_INDEX);

    await page.mouse.up();
  });

  test("Pad-Hold 500ms: trigger fires once, release fires once, keine extra triggers", async ({ page }) => {
    await openMacroPanel(page);
    await installEventCounters(page);
    const macroBtn = page.getByTestId(`macro-button-${PAD_MACRO_INDEX}`);

    const box = await macroBtn.boundingBox();
    if (!box) throw new Error("Macro button has no bounding box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 500ms gedrückt — die 100ms-Hold-Loop läuft App.tsx-intern, dispatcht
    // aber KEINE neuen trigger-Events (genau wie beim script-hold).
    await page.waitForTimeout(500);
    await page.mouse.up();

    const triggersAtRelease = await page.evaluate(() => (window as unknown as {
      __macroTriggerEvents: Array<unknown>;
    }).__macroTriggerEvents.length);
    await page.waitForTimeout(200);
    const triggersAfter = await page.evaluate(() => (window as unknown as {
      __macroTriggerEvents: Array<unknown>;
    }).__macroTriggerEvents.length);

    expect(triggersAtRelease).toBe(1);
    expect(triggersAfter).toBe(1);

    const releases = await page.evaluate(() => (window as unknown as {
      __macroReleaseEvents: Array<unknown>;
    }).__macroReleaseEvents.length);
    expect(releases).toBe(1);
  });
});
