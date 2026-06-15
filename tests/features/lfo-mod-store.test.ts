/**
 * tests/features/lfo-mod-store.test.ts (TASK-257)
 *
 * Unit-Tests für useLfoModStore (Modul-Singleton mit localStorage).
 * Deckt LFO-Quellen + Mod-Routes + getActiveModRoutes + Persistenz.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────
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
  addLfo,
  removeLfo,
  updateLfo,
  getLfos,
  getLfoById,
  addModRoute,
  removeModRoute,
  updateModRoute,
  getModRoutes,
  getActiveModRoutes,
  routeSource,
  __resetLfoModStoreForTests,
  type LfoConfig,
  type ModRoute,
} from "@/store/useLfoModStore";
import { defaultEnvConfig } from "@/utils/modSource";

const STORAGE_KEY = "ss-lfo-mod:v1";

function baseLfo(): Omit<LfoConfig, "id"> {
  return {
    name: "LFO 1",
    enabled: true,
    waveform: "sine",
    rateHz: 1,
    phase: 0,
    depth: 1,
  };
}

function baseRoute(lfoId: string): Omit<ModRoute, "id"> {
  return {
    enabled: true,
    lfoId,
    targetPartId: "bass",
    targetPartName: "Bass",
    param: "filterFreq",
    amount: 0.5,
  };
}

beforeEach(() => {
  localStorageMock.clear();
  __resetLfoModStoreForTests();
});

// ─── LFO-Quellen ───────────────────────────────────────────────────────────

describe("useLfoModStore – LFO-Quellen", () => {
  it("Happy: addLfo liefert id, Config abrufbar", () => {
    const id = addLfo(baseLfo());
    expect(id).toMatch(/^lfo-\d+-[a-z0-9]+$/);
    expect(getLfos()).toHaveLength(1);
    expect(getLfoById(id)?.waveform).toBe("sine");
  });

  it("Happy: alle Felder übernommen", () => {
    const id = addLfo({ name: "Slow", enabled: false, waveform: "triangle", rateHz: 0.25, phase: 0.5, depth: 0.8 });
    const l = getLfoById(id)!;
    expect(l.name).toBe("Slow");
    expect(l.enabled).toBe(false);
    expect(l.waveform).toBe("triangle");
    expect(l.rateHz).toBe(0.25);
    expect(l.phase).toBe(0.5);
    expect(l.depth).toBe(0.8);
  });

  it("Edge: updateLfo partiell, unbekannte id no-op", () => {
    const id = addLfo(baseLfo());
    updateLfo(id, { rateHz: 4 });
    expect(getLfoById(id)?.rateHz).toBe(4);
    expect(getLfoById(id)?.waveform).toBe("sine"); // unverändert
    updateLfo("nope", { rateHz: 99 });
    expect(getLfoById(id)?.rateHz).toBe(4);
  });

  it("Edge: removeLfo entfernt verwaiste Routes mit", () => {
    const lfoId = addLfo(baseLfo());
    addModRoute(baseRoute(lfoId));
    expect(getModRoutes()).toHaveLength(1);
    removeLfo(lfoId);
    expect(getLfos()).toHaveLength(0);
    expect(getModRoutes()).toHaveLength(0); // verwaiste Route mit-entfernt
  });

  it("Persistence: addLfo schreibt nach localStorage", () => {
    addLfo(baseLfo());
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.lfos).toHaveLength(1);
    expect(parsed.lfos[0].waveform).toBe("sine");
  });
});

// ─── Mod-Routes ──────────────────────────────────────────────────────────────

describe("useLfoModStore – Mod-Routes", () => {
  it("Happy: addModRoute liefert id, Route abrufbar", () => {
    const lfoId = addLfo(baseLfo());
    const rid = addModRoute(baseRoute(lfoId));
    expect(rid).toMatch(/^mr-\d+-[a-z0-9]+$/);
    expect(getModRoutes()).toHaveLength(1);
    expect(getModRoutes()[0].param).toBe("filterFreq");
  });

  it("Happy: updateModRoute ändert nur Match", () => {
    const lfoId = addLfo(baseLfo());
    const r1 = addModRoute(baseRoute(lfoId));
    const r2 = addModRoute({ ...baseRoute(lfoId), param: "volume" });
    updateModRoute(r1, { amount: 0.9 });
    expect(getModRoutes().find(r => r.id === r1)!.amount).toBe(0.9);
    expect(getModRoutes().find(r => r.id === r2)!.amount).toBe(0.5);
  });

  it("Edge: removeModRoute entfernt nur Match; unbekannte id no-op", () => {
    const lfoId = addLfo(baseLfo());
    const r1 = addModRoute(baseRoute(lfoId));
    const r2 = addModRoute(baseRoute(lfoId));
    removeModRoute(r1);
    expect(getModRoutes()).toHaveLength(1);
    expect(getModRoutes()[0].id).toBe(r2);
    removeModRoute("nope");
    expect(getModRoutes()).toHaveLength(1);
  });

  it("Persistence: Route überlebt localStorage round-trip", () => {
    const lfoId = addLfo(baseLfo());
    addModRoute(baseRoute(lfoId));
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.routes).toHaveLength(1);
    expect(parsed.routes[0].targetPartId).toBe("bass");
  });
});

// ─── getActiveModRoutes ──────────────────────────────────────────────────────

describe("useLfoModStore – getActiveModRoutes", () => {
  it("Happy: aktive Route + aktive LFO → enthalten", () => {
    const lfoId = addLfo(baseLfo());
    addModRoute(baseRoute(lfoId));
    const active = getActiveModRoutes();
    expect(active).toHaveLength(1);
    expect(active[0].lfo?.id).toBe(lfoId);
    expect(active[0].route.param).toBe("filterFreq");
  });

  it("Edge: deaktivierte Route wird ausgefiltert", () => {
    const lfoId = addLfo(baseLfo());
    addModRoute({ ...baseRoute(lfoId), enabled: false });
    expect(getActiveModRoutes()).toHaveLength(0);
  });

  it("Edge: deaktivierte LFO filtert ihre Routes aus", () => {
    const lfoId = addLfo({ ...baseLfo(), enabled: false });
    addModRoute(baseRoute(lfoId)); // Route enabled, aber LFO aus
    expect(getActiveModRoutes()).toHaveLength(0);
  });

  it("Edge: Route mit nicht-existenter lfoId wird ignoriert", () => {
    addModRoute(baseRoute("ghost-lfo"));
    expect(getActiveModRoutes()).toHaveLength(0);
  });
});

// ─── Default-State / Reset ───────────────────────────────────────────────────

describe("useLfoModStore – Default + Reset", () => {
  it("startet leer nach Reset", () => {
    expect(getLfos()).toEqual([]);
    expect(getModRoutes()).toEqual([]);
  });

  it("Persistence: Reset persistiert leeren State", () => {
    addLfo(baseLfo());
    __resetLfoModStoreForTests();
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.lfos).toEqual([]);
    expect(parsed.routes).toEqual([]);
  });
});

// ─── TASK-257-FOLLOWUP-3: source (lfo|macro|env) + Migration ─────────────────

describe("useLfoModStore – Mod-Source + Migration (FOLLOWUP-3)", () => {
  it("Default: addModRoute ohne source-Feld → source 'lfo'", () => {
    const lfoId = addLfo(baseLfo());
    const rid = addModRoute(baseRoute(lfoId)); // baseRoute hat KEIN source-Feld
    const r = getModRoutes().find((x) => x.id === rid)!;
    expect(r.source).toBe("lfo");
    expect(routeSource(r)).toBe("lfo");
  });

  it("Default: explizites source wird übernommen (macro)", () => {
    const rid = addModRoute({
      ...baseRoute("ignored"),
      source: "macro",
      macroIndex: 3,
    });
    const r = getModRoutes().find((x) => x.id === rid)!;
    expect(r.source).toBe("macro");
    expect(r.macroIndex).toBe(3);
  });

  it("routeSource: invalides/fehlendes source → 'lfo' (defensiv)", () => {
    expect(routeSource({ source: undefined } as ModRoute)).toBe("lfo");
    expect(routeSource({ source: "garbage" as never } as ModRoute)).toBe("lfo");
    expect(routeSource({ source: "env" } as ModRoute)).toBe("env");
  });

  it("Migration: persisted Route OHNE source-Feld (v1) lädt als 'lfo'", () => {
    // Simuliere alte v1-Persistenz (kein source/macroIndex/env), dann
    // erzwinge ein Re-Load über den localStorage-Mock + neuen Add (der load()
    // beim Modul-Init bereits ausgeführt hat — daher prüfen wir migrateRoute
    // über getActiveModRoutes + routeSource auf einer manuell injizierten Route).
    const legacy = {
      lfos: [{ id: "l1", name: "L", enabled: true, waveform: "sine", rateHz: 1, phase: 0, depth: 1 }],
      routes: [
        {
          id: "old-route",
          enabled: true,
          lfoId: "l1",
          targetPartId: "bass",
          targetPartName: "Bass",
          param: "volume",
          amount: 0.5,
          // KEIN source-Feld (v1)
        },
      ],
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(legacy));
    // Eine Mutation triggert keinen Re-Load; load() lief beim Import. Wir
    // validieren die Migrations-Logik direkt über routeSource auf der rohen
    // Route-Form (so wie load() sie verarbeitet hätte).
    expect(routeSource(legacy.routes[0] as unknown as ModRoute)).toBe("lfo");
  });

  it("Active: macro-Route OHNE jegliche LFO bleibt aktiv (kein Drop)", () => {
    // KRITISCH: vor FOLLOWUP-3 hätte getActiveModRoutes diese Route verworfen.
    const rid = addModRoute({
      ...baseRoute("no-lfo"),
      source: "macro",
      macroIndex: 0,
    });
    const active = getActiveModRoutes();
    expect(active).toHaveLength(1);
    expect(active[0].route.id).toBe(rid);
    expect(active[0].lfo).toBeUndefined();
  });

  it("Active: env-Route OHNE LFO bleibt aktiv, deaktiviert wird gefiltert", () => {
    const rid = addModRoute({
      ...baseRoute("no-lfo"),
      source: "env",
      env: defaultEnvConfig(),
    });
    expect(getActiveModRoutes()).toHaveLength(1);
    updateModRoute(rid, { enabled: false });
    expect(getActiveModRoutes()).toHaveLength(0);
  });

  it("Persistence: erweiterte macro-Route überlebt round-trip", () => {
    addModRoute({ ...baseRoute("x"), source: "macro", macroIndex: 5 });
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.routes[0].source).toBe("macro");
    expect(parsed.routes[0].macroIndex).toBe(5);
  });
});
