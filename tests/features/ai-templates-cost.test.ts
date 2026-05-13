/**
 * tests/features/ai-templates-cost.test.ts
 *
 * Unit-Tests für AI Welle 4:
 *  - Template-Definitionen + Grouping (utils/aiScriptTemplates)
 *  - Cost-Tracking-Store (store/useAiCostStore): record / roll-month / cap
 *
 * Tests sind pure-logic; kein React-DOM oder Network nötig.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  AI_SCRIPT_TEMPLATES,
  groupTemplatesByCategory,
  findTemplate,
} from "../../client/src/utils/aiScriptTemplates";
import {
  recordAiCall,
  setMonthlyCap,
  resetMonth,
  getProviderUsage,
  maybeRollMonth,
} from "../../client/src/store/useAiCostStore";

// ─── aiScriptTemplates ───────────────────────────────────────────────────────

describe("AI_SCRIPT_TEMPLATES", () => {
  it("enthält mindestens 10 Templates", () => {
    expect(AI_SCRIPT_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it("alle Templates haben unique IDs", () => {
    const ids = AI_SCRIPT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("alle Templates haben non-empty Pflichtfelder", () => {
    for (const t of AI_SCRIPT_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.prompt.length).toBeGreaterThan(10);
    }
  });

  it("alle Kategorien sind aus der erlaubten Liste", () => {
    const allowedCategories = new Set(["Transport", "Macros", "Pattern", "Performance", "Beispiel"]);
    for (const t of AI_SCRIPT_TEMPLATES) {
      expect(allowedCategories.has(t.category)).toBe(true);
    }
  });
});

describe("groupTemplatesByCategory", () => {
  it("liefert ein Objekt mit Kategorien als Keys", () => {
    const grouped = groupTemplatesByCategory();
    const keys = Object.keys(grouped);
    expect(keys.length).toBeGreaterThan(0);
    for (const cat of keys) {
      expect(Array.isArray(grouped[cat])).toBe(true);
      expect(grouped[cat].length).toBeGreaterThan(0);
    }
  });

  it("Total-Count über alle Kategorien matched AI_SCRIPT_TEMPLATES", () => {
    const grouped = groupTemplatesByCategory();
    const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(AI_SCRIPT_TEMPLATES.length);
  });
});

describe("findTemplate", () => {
  it("findet existierendes Template per ID", () => {
    const t = findTemplate("bpm-ramp");
    expect(t).toBeDefined();
    expect(t?.id).toBe("bpm-ramp");
  });

  it("returnt undefined für unbekannte ID", () => {
    expect(findTemplate("nicht-da")).toBeUndefined();
  });
});

// ─── useAiCostStore ──────────────────────────────────────────────────────────

describe("useAiCostStore — recordAiCall", () => {
  beforeEach(() => {
    localStorageMock.clear();
    resetMonth("anthropic");
    resetMonth("openai");
    setMonthlyCap("anthropic", null);
    setMonthlyCap("openai", null);
  });

  it("Default-State: 0 Tokens, kein Cap, keine Calls", () => {
    const u = getProviderUsage("anthropic");
    expect(u.total).toBe(0);
    expect(u.input).toBe(0);
    expect(u.output).toBe(0);
    expect(u.cap).toBeNull();
    expect(u.capExceeded).toBe(false);
    expect(u.callCount).toBe(0);
  });

  it("recordAiCall akkumuliert input + output Tokens", () => {
    recordAiCall("anthropic", 100, 200);
    recordAiCall("anthropic", 50, 75);
    const u = getProviderUsage("anthropic");
    expect(u.input).toBe(150);
    expect(u.output).toBe(275);
    expect(u.total).toBe(425);
    expect(u.callCount).toBe(2);
  });

  it("recordAiCall floor't negative Werte auf 0 ab", () => {
    recordAiCall("anthropic", -10, -5);
    const u = getProviderUsage("anthropic");
    expect(u.input).toBe(0);
    expect(u.output).toBe(0);
  });

  it("recordAiCall floor't Fließkomma-Werte zu Integers", () => {
    recordAiCall("anthropic", 100.7, 200.3);
    const u = getProviderUsage("anthropic");
    expect(u.input).toBe(100);
    expect(u.output).toBe(200);
  });

  it("Provider sind isoliert (anthropic vs openai)", () => {
    recordAiCall("anthropic", 100, 200);
    recordAiCall("openai", 500, 600);
    expect(getProviderUsage("anthropic").total).toBe(300);
    expect(getProviderUsage("openai").total).toBe(1100);
  });
});

describe("useAiCostStore — Cap", () => {
  beforeEach(() => {
    localStorageMock.clear();
    resetMonth("anthropic");
    setMonthlyCap("anthropic", null);
  });

  it("setMonthlyCap setzt den Cap", () => {
    setMonthlyCap("anthropic", 10000);
    expect(getProviderUsage("anthropic").cap).toBe(10000);
  });

  it("capExceeded ist true wenn total >= cap", () => {
    setMonthlyCap("anthropic", 1000);
    recordAiCall("anthropic", 500, 400); // total: 900, unter cap
    expect(getProviderUsage("anthropic").capExceeded).toBe(false);
    recordAiCall("anthropic", 50, 50); // total: 1000, == cap
    expect(getProviderUsage("anthropic").capExceeded).toBe(true);
  });

  it("Cap null bedeutet kein Limit", () => {
    setMonthlyCap("anthropic", null);
    recordAiCall("anthropic", 999999, 999999);
    expect(getProviderUsage("anthropic").capExceeded).toBe(false);
  });

  it("setMonthlyCap mit invaliden Werten setzt null", () => {
    setMonthlyCap("anthropic", -100);
    expect(getProviderUsage("anthropic").cap).toBeNull();
    setMonthlyCap("anthropic", NaN);
    expect(getProviderUsage("anthropic").cap).toBeNull();
  });
});

describe("useAiCostStore — Monats-Reset", () => {
  beforeEach(() => {
    localStorageMock.clear();
    resetMonth("anthropic");
  });

  it("maybeRollMonth tut nichts wenn currentMonth aktuell ist", () => {
    recordAiCall("anthropic", 100, 200);
    const before = getProviderUsage("anthropic");
    maybeRollMonth("anthropic");
    const after = getProviderUsage("anthropic");
    expect(after.total).toBe(before.total);
  });

  it("maybeRollMonth resettet wenn Monat sich geändert hat", () => {
    recordAiCall("anthropic", 100, 200);
    expect(getProviderUsage("anthropic").total).toBe(300);
    // 2 Monate in der Zukunft simulieren
    const future = new Date();
    future.setMonth(future.getMonth() + 2);
    maybeRollMonth("anthropic", future);
    expect(getProviderUsage("anthropic").total).toBe(0);
    expect(getProviderUsage("anthropic").callCount).toBe(0);
  });

  it("resetMonth setzt counter zurück, Cap bleibt erhalten", () => {
    setMonthlyCap("anthropic", 5000);
    recordAiCall("anthropic", 100, 200);
    resetMonth("anthropic");
    const u = getProviderUsage("anthropic");
    expect(u.total).toBe(0);
    expect(u.callCount).toBe(0);
    expect(u.cap).toBe(5000);
  });
});
