/**
 * tests/features/scenes.test.ts
 *
 * Unit-Tests fuer useSceneStore: addScene, updateScene, removeScene,
 * setActiveScene, reorderScene.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  addScene,
  updateScene,
  removeScene,
  setActiveScene,
  reorderScene,
  SCENE_COLORS,
  useSceneStore,
} from "../../client/src/store/useSceneStore";

const STORAGE_KEY = "ss-scenes:v1";

// Helper: liest den persistierten State direkt aus localStorage (deterministisch,
// haengt nicht von Hook-Subscription ab)
function readState(): { scenes: Array<{ id: string; name: string; patternId: string; color: string }>; activeSceneId: string | null } {
  const raw = localStorageMock.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : { scenes: [], activeSceneId: null };
}

// Helper: leert alle Scenes via removeScene (Singleton-Store hat keinen __reset)
function clearAllScenes() {
  let state = readState();
  while (state.scenes.length > 0) {
    removeScene(state.scenes[0].id);
    state = readState();
  }
  setActiveScene(null);
}

describe("useSceneStore", () => {
  beforeEach(() => {
    // Erst Store leeren, dann localStorage clearen (Reihenfolge wichtig:
    // Singleton-State im Modul muss konsistent mit localStorage bleiben)
    clearAllScenes();
    localStorageMock.clear();
  });

  it("exportiert SCENE_COLORS mit 8 Farben", () => {
    expect(SCENE_COLORS).toHaveLength(8);
  });

  it("addScene legt neue Scene an und vergibt eine ID", () => {
    const id = addScene("Intro", "pattern-1");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    const state = readState();
    expect(state.scenes).toHaveLength(1);
    expect(state.scenes[0]).toMatchObject({
      id,
      name: "Intro",
      patternId: "pattern-1",
    });
    expect(state.scenes[0].color).toBe(SCENE_COLORS[0]);
  });

  it("addScene rotiert Farben aus SCENE_COLORS", () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(addScene(`Scene ${i}`, `pat-${i}`));
    }
    const state = readState();
    expect(state.scenes).toHaveLength(10);
    // Scene 8 muss wieder bei Farbe 0 anfangen (Modulo)
    expect(state.scenes[8].color).toBe(SCENE_COLORS[0]);
    expect(state.scenes[0].color).toBe(SCENE_COLORS[0]);
  });

  it("updateScene aendert Name und/oder patternId", () => {
    const id = addScene("Old", "pat-a");
    updateScene(id, { name: "New", patternId: "pat-b" });
    const state = readState();
    expect(state.scenes[0].name).toBe("New");
    expect(state.scenes[0].patternId).toBe("pat-b");
  });

  it("updateScene ignoriert unbekannte IDs (kein Crash)", () => {
    addScene("X", "pat-x");
    updateScene("nonexistent-id", { name: "Y" });
    const state = readState();
    expect(state.scenes).toHaveLength(1);
    expect(state.scenes[0].name).toBe("X");
  });

  it("removeScene entfernt Scene anhand der ID", () => {
    const a = addScene("A", "pat-a");
    const b = addScene("B", "pat-b");
    removeScene(a);
    const state = readState();
    expect(state.scenes).toHaveLength(1);
    expect(state.scenes[0].id).toBe(b);
  });

  it("removeScene loescht aktive Scene → activeSceneId wird null", () => {
    const id = addScene("Active", "pat-act");
    setActiveScene(id);
    expect(readState().activeSceneId).toBe(id);
    removeScene(id);
    expect(readState().activeSceneId).toBeNull();
  });

  it("setActiveScene setzt und nullt activeSceneId", () => {
    const id = addScene("S", "pat-s");
    setActiveScene(id);
    expect(readState().activeSceneId).toBe(id);
    setActiveScene(null);
    expect(readState().activeSceneId).toBeNull();
  });

  it("reorderScene verschiebt Scene innerhalb der Liste", () => {
    const a = addScene("A", "pa");
    const b = addScene("B", "pb");
    const c = addScene("C", "pc");
    // Reihenfolge: [A, B, C] → reorder(0, 2) → [B, C, A]
    reorderScene(0, 2);
    const state = readState();
    expect(state.scenes.map((s) => s.id)).toEqual([b, c, a]);
  });

  it("exportiert useSceneStore Hook-Funktion", () => {
    expect(typeof useSceneStore).toBe("function");
  });
});
