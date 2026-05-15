/**
 * Synthstudio – useInspectorFloatStore Tests (v2.46)
 */
import { describe, it, expect, beforeEach } from "vitest";

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// Import muss NACH dem localStorage-Mock kommen, damit loadInitial() den Mock sieht.
import {
  openInspectorFloat,
  closeInspectorFloat,
  toggleInspectorFloat,
  getInspectorFloatOpen,
  __resetInspectorFloatStoreForTests,
} from "../../client/src/store/useInspectorFloatStore";

beforeEach(() => {
  localStorageMock.clear();
  __resetInspectorFloatStoreForTests();
});

describe("useInspectorFloatStore (v2.46)", () => {
  it("Initial-State: open=false", () => {
    expect(getInspectorFloatOpen()).toBe(false);
  });

  it("openInspectorFloat setzt open=true", () => {
    openInspectorFloat();
    expect(getInspectorFloatOpen()).toBe(true);
  });

  it("openInspectorFloat ist idempotent", () => {
    openInspectorFloat();
    openInspectorFloat();
    expect(getInspectorFloatOpen()).toBe(true);
  });

  it("closeInspectorFloat setzt open=false", () => {
    openInspectorFloat();
    closeInspectorFloat();
    expect(getInspectorFloatOpen()).toBe(false);
  });

  it("closeInspectorFloat aus geschlossenem State ist No-Op", () => {
    expect(getInspectorFloatOpen()).toBe(false);
    closeInspectorFloat();
    expect(getInspectorFloatOpen()).toBe(false);
  });

  it("toggleInspectorFloat wechselt", () => {
    toggleInspectorFloat();
    expect(getInspectorFloatOpen()).toBe(true);
    toggleInspectorFloat();
    expect(getInspectorFloatOpen()).toBe(false);
  });

  it("Persistierung: nach openInspectorFloat ist localStorage gesetzt", () => {
    openInspectorFloat();
    const raw = localStorageMock.getItem("ss-inspector-float:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.open).toBe(true);
  });

  it("Persistierung: nach closeInspectorFloat ist localStorage gesetzt", () => {
    openInspectorFloat();
    closeInspectorFloat();
    const raw = localStorageMock.getItem("ss-inspector-float:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.open).toBe(false);
  });
});
