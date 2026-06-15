/**
 * tests/features/lfo-mod-panel.test.ts (TASK-257-FOLLOWUP)
 *
 * Verifiziert die Store-Interaktionen, die das LfoModPanel auslöst:
 *   - "+ LFO" legt eine LFO mit HÖRBAREN Defaults an (enabled, depth > 0).
 *   - "+ Route" legt eine Route mit echtem Ziel-Part + amount > 0 an.
 *   - updateModRoute ändert Param/Ziel/Amount.
 *   - removeLfo räumt verwaiste Routes ab (Panel verlässt sich darauf).
 *
 * Bewusst auf Store-Ebene (kein jsdom-Render) — die Panel-Handler sind
 * dünne Wrapper um diese Store-Funktionen mit genau diesen Defaults.
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
Object.defineProperty(globalThis, "localStorage", {
  value: createLocalStorageMock(),
  writable: true,
  configurable: true,
});

import {
  addLfo,
  removeLfo,
  addModRoute,
  updateModRoute,
  removeModRoute,
  getLfos,
  getModRoutes,
  getActiveModRoutes,
  groupRoutesBySource,
  routeSource,
  __resetLfoModStoreForTests,
  type ModSource,
} from "@/store/useLfoModStore";
import { defaultEnvConfig } from "@/utils/modSource";

/** Spiegelt den "+ LFO"-Handler aus LfoModPanel. */
function addLfoLikePanel(existingCount: number): string {
  return addLfo({
    name: `LFO ${existingCount + 1}`,
    enabled: true,
    waveform: "sine",
    rateHz: 1,
    depth: 1,
    phase: 0,
  });
}

/** Spiegelt den "+ Route"-Handler aus LfoModPanel. */
function addRouteLikePanel(lfoId: string, partId: string, partName: string): string {
  return addModRoute({
    enabled: true,
    lfoId,
    targetPartId: partId,
    targetPartName: partName,
    param: "volume",
    amount: 0.5,
  });
}

describe("LfoModPanel ↔ useLfoModStore", () => {
  beforeEach(() => {
    __resetLfoModStoreForTests();
  });

  it('"+ LFO" legt eine LFO mit hörbaren Defaults an (Happy Path)', () => {
    const id = addLfoLikePanel(0);
    const lfos = getLfos();
    expect(lfos).toHaveLength(1);
    const lfo = lfos.find((l) => l.id === id)!;
    expect(lfo.name).toBe("LFO 1");
    expect(lfo.enabled).toBe(true);
    expect(lfo.waveform).toBe("sine");
    expect(lfo.rateHz).toBe(1);
    // HÖRBARKEIT: depth darf nie auf 0 defaulten.
    expect(lfo.depth).toBeGreaterThan(0);
  });

  it('"+ Route" verknüpft LFO mit echtem Part-Ziel + amount > 0 → aktiv', () => {
    const lfoId = addLfoLikePanel(0);
    const routeId = addRouteLikePanel(lfoId, "part-kick", "Kick");

    const routes = getModRoutes();
    expect(routes).toHaveLength(1);
    const route = routes.find((r) => r.id === routeId)!;
    expect(route.lfoId).toBe(lfoId);
    expect(route.targetPartId).toBe("part-kick");
    expect(route.targetPartName).toBe("Kick");
    expect(route.param).toBe("volume");
    // HÖRBARKEIT: amount darf nie auf 0 defaulten.
    expect(route.amount).toBeGreaterThan(0);

    // Route + LFO beide enabled → erscheint in getActiveModRoutes (Engine-Seam).
    const active = getActiveModRoutes();
    expect(active).toHaveLength(1);
    expect(active[0].route.id).toBe(routeId);
    expect(active[0].lfo.id).toBe(lfoId);
  });

  it("updateModRoute ändert Param, Ziel und Amount (Edit-Pfad)", () => {
    const lfoId = addLfoLikePanel(0);
    const routeId = addRouteLikePanel(lfoId, "part-1", "Part 1");

    updateModRoute(routeId, {
      param: "filterFreq",
      targetPartId: "part-2",
      targetPartName: "Part 2",
      amount: -0.75,
    });

    const route = getModRoutes().find((r) => r.id === routeId)!;
    expect(route.param).toBe("filterFreq");
    expect(route.targetPartId).toBe("part-2");
    expect(route.targetPartName).toBe("Part 2");
    expect(route.amount).toBe(-0.75);
  });

  it("removeLfo räumt verwaiste Routes ab (Edge Case)", () => {
    const lfoId = addLfoLikePanel(0);
    addRouteLikePanel(lfoId, "part-1", "Part 1");
    addRouteLikePanel(lfoId, "part-2", "Part 2");
    expect(getModRoutes()).toHaveLength(2);

    removeLfo(lfoId);

    expect(getLfos()).toHaveLength(0);
    // Routes, die auf die entfernte LFO zeigten, sind weg.
    expect(getModRoutes()).toHaveLength(0);
    expect(getActiveModRoutes()).toHaveLength(0);
  });

  it("deaktivierte Route erscheint nicht in getActiveModRoutes (Persistenz/Filter)", () => {
    const lfoId = addLfoLikePanel(0);
    const routeId = addRouteLikePanel(lfoId, "part-1", "Part 1");
    updateModRoute(routeId, { enabled: false });
    expect(getActiveModRoutes()).toHaveLength(0);
  });
});

// ─── TASK-270: Mod-Matrix – Route je Quelltyp anlegen/togglen/entfernen ───────

/**
 * Spiegelt den per-Quelltyp "+ X"-Handler aus dem LfoModPanel
 * (handleAddRouteForSource): hörbare Defaults + quelltyp-spezifische Sub-Felder.
 */
function addRouteForSourceLikePanel(
  source: ModSource,
  lfoId: string,
  partId: string,
  partName: string,
): string {
  return addModRoute({
    enabled: true,
    source,
    lfoId: source === "lfo" ? lfoId : "",
    macroIndex: source === "macro" ? 0 : undefined,
    env: source === "env" ? defaultEnvConfig() : undefined,
    targetPartId: partId,
    targetPartName: partName,
    param: "volume",
    amount: 0.5,
  });
}

describe("Mod-Matrix ↔ useLfoModStore (TASK-270)", () => {
  beforeEach(() => {
    __resetLfoModStoreForTests();
  });

  it("legt je Quelltyp (lfo/macro/env) eine Route mit passenden Sub-Defaults an", () => {
    const lfoId = addLfoLikePanel(0);
    const rLfo = addRouteForSourceLikePanel("lfo", lfoId, "p1", "P1");
    const rMacro = addRouteForSourceLikePanel("macro", "", "p1", "P1");
    const rEnv = addRouteForSourceLikePanel("env", "", "p1", "P1");

    const byId = (id: string) => getModRoutes().find((r) => r.id === id)!;
    expect(byId(rLfo).source).toBe("lfo");
    expect(byId(rLfo).lfoId).toBe(lfoId);
    expect(byId(rMacro).source).toBe("macro");
    expect(byId(rMacro).macroIndex).toBe(0);
    expect(byId(rEnv).source).toBe("env");
    expect(byId(rEnv).env).toEqual(defaultEnvConfig());

    // HÖRBARKEIT: amount > 0 je Quelltyp.
    for (const id of [rLfo, rMacro, rEnv]) {
      expect(byId(id).amount).toBeGreaterThan(0);
    }
  });

  it("groupRoutesBySource verteilt die drei Routen in die richtigen Gruppen", () => {
    const lfoId = addLfoLikePanel(0);
    addRouteForSourceLikePanel("lfo", lfoId, "p1", "P1");
    addRouteForSourceLikePanel("macro", "", "p1", "P1");
    addRouteForSourceLikePanel("env", "", "p1", "P1");

    const groups = groupRoutesBySource(getModRoutes());
    expect(groups.lfo).toHaveLength(1);
    expect(groups.macro).toHaveLength(1);
    expect(groups.env).toHaveLength(1);
    expect(routeSource(groups.macro[0])).toBe("macro");
  });

  it("enable-Toggle je Quelltyp wirkt auf getActiveModRoutes", () => {
    const lfoId = addLfoLikePanel(0);
    const rMacro = addRouteForSourceLikePanel("macro", "", "p1", "P1");
    const rEnv = addRouteForSourceLikePanel("env", "", "p1", "P1");
    // lfo + macro + env alle aktiv (lfo enabled).
    addRouteForSourceLikePanel("lfo", lfoId, "p1", "P1");
    expect(getActiveModRoutes()).toHaveLength(3);

    updateModRoute(rMacro, { enabled: false });
    expect(getActiveModRoutes()).toHaveLength(2);
    updateModRoute(rEnv, { enabled: false });
    expect(getActiveModRoutes()).toHaveLength(1);
  });

  it("remove je Quelltyp entfernt nur die gewählte Route", () => {
    const lfoId = addLfoLikePanel(0);
    const rLfo = addRouteForSourceLikePanel("lfo", lfoId, "p1", "P1");
    const rMacro = addRouteForSourceLikePanel("macro", "", "p1", "P1");
    const rEnv = addRouteForSourceLikePanel("env", "", "p1", "P1");
    expect(getModRoutes()).toHaveLength(3);

    removeModRoute(rMacro);
    let groups = groupRoutesBySource(getModRoutes());
    expect(groups.macro).toHaveLength(0);
    expect(groups.lfo).toHaveLength(1);
    expect(groups.env).toHaveLength(1);

    removeModRoute(rLfo);
    removeModRoute(rEnv);
    expect(getModRoutes()).toHaveLength(0);
  });
});
