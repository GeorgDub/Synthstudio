/**
 * tests/features/morph-store.test.ts (TASK-CVG-MORPH-STORE / v2.64)
 *
 * Unit-Tests für useMorphStore (Modul-Singleton mit sessionStorage-Persistenz).
 * sessionStorage wird gestubt — initMorphFromStorage liest beim ersten Mount,
 * daher pro Test komplett resetten.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── sessionStorage Mock (vor Store-Import) ──────────────────────────────────

function createSessionMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const sessionStorageMock = createSessionMock();
Object.defineProperty(globalThis, "sessionStorage", {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
});

import {
  setAmount,
  setPatternA,
  setPatternB,
  setActive,
  toggleAutoMorph,
  setAutoMorphBars,
  resetMorph,
  getMorphState,
  initMorphFromStorage,
  __resetMorphForTests,
} from "@/store/useMorphStore";

const STORAGE_KEY = "ss-morph";

describe("useMorphStore – Default-State", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    __resetMorphForTests();
  });

  it("amount=0 initial", () => {
    expect(getMorphState().amount).toBe(0);
  });

  it("patternAId und patternBId sind null", () => {
    const s = getMorphState();
    expect(s.patternAId).toBeNull();
    expect(s.patternBId).toBeNull();
  });

  it("isActive=false, autoMorphActive=false, autoMorphBars=4", () => {
    const s = getMorphState();
    expect(s.isActive).toBe(false);
    expect(s.autoMorphActive).toBe(false);
    expect(s.autoMorphBars).toBe(4);
  });
});

describe("useMorphStore – setAmount mit Clamping", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    __resetMorphForTests();
  });

  it("0.5 wird übernommen", () => {
    setAmount(0.5);
    expect(getMorphState().amount).toBe(0.5);
  });

  it("über 1 → clamp auf 1", () => {
    setAmount(2);
    expect(getMorphState().amount).toBe(1);
  });

  it("unter 0 → clamp auf 0", () => {
    setAmount(-0.5);
    expect(getMorphState().amount).toBe(0);
  });
});

describe("useMorphStore – Pattern-A/B-Setter", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    __resetMorphForTests();
  });

  it("setPatternA + setPatternB persistieren", () => {
    setPatternA("pat-1");
    setPatternB("pat-2");
    const s = getMorphState();
    expect(s.patternAId).toBe("pat-1");
    expect(s.patternBId).toBe("pat-2");
  });

  it("setPatternA(null) leert die Slot-A", () => {
    setPatternA("pat-1");
    setPatternA(null);
    expect(getMorphState().patternAId).toBeNull();
  });
});

describe("useMorphStore – setActive + toggleAutoMorph", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    __resetMorphForTests();
  });

  it("setActive(true) → isActive=true", () => {
    setActive(true);
    expect(getMorphState().isActive).toBe(true);
  });

  it("toggleAutoMorph flippt autoMorphActive", () => {
    toggleAutoMorph();
    expect(getMorphState().autoMorphActive).toBe(true);
    toggleAutoMorph();
    expect(getMorphState().autoMorphActive).toBe(false);
  });

  it("setAutoMorphBars setzt direkt", () => {
    setAutoMorphBars(8);
    expect(getMorphState().autoMorphBars).toBe(8);
  });
});

describe("useMorphStore – resetMorph", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    __resetMorphForTests();
  });

  it("setzt alle Felder auf Default zurück", () => {
    setAmount(0.7);
    setPatternA("a");
    setPatternB("b");
    setActive(true);
    toggleAutoMorph();
    setAutoMorphBars(12);
    resetMorph();
    const s = getMorphState();
    expect(s.amount).toBe(0);
    expect(s.patternAId).toBeNull();
    expect(s.patternBId).toBeNull();
    expect(s.isActive).toBe(false);
    expect(s.autoMorphActive).toBe(false);
    expect(s.autoMorphBars).toBe(4);
  });
});

describe("useMorphStore – sessionStorage-Persistenz", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    __resetMorphForTests();
  });

  it("setAmount(0.5) schreibt in sessionStorage", () => {
    setAmount(0.5);
    const raw = sessionStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.amount).toBe(0.5);
  });

  it("setPatternA schreibt in sessionStorage", () => {
    setPatternA("xyz");
    const parsed = JSON.parse(sessionStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.patternAId).toBe("xyz");
  });

  it("initMorphFromStorage stellt einen persistierten State wieder her", () => {
    sessionStorageMock.setItem(STORAGE_KEY, JSON.stringify({
      amount: 0.8,
      patternAId: "pat-X",
      patternBId: "pat-Y",
      isActive: true,
      autoMorphActive: true,
      autoMorphBars: 8,
    }));
    const restored = initMorphFromStorage();
    expect(restored.amount).toBe(0.8);
    expect(restored.patternAId).toBe("pat-X");
    expect(restored.autoMorphBars).toBe(8);
  });

  it("initMorphFromStorage clampt invalidierte amounts beim Read", () => {
    sessionStorageMock.setItem(STORAGE_KEY, JSON.stringify({ amount: 5 }));
    const restored = initMorphFromStorage();
    expect(restored.amount).toBe(1);
  });

  it("initMorphFromStorage ohne sessionStorage-Entry → Defaults", () => {
    sessionStorageMock.clear();
    const restored = initMorphFromStorage();
    expect(restored.amount).toBe(0);
    expect(restored.autoMorphBars).toBe(4);
  });

  it("initMorphFromStorage mit invalid-JSON → silent fallback auf Defaults", () => {
    sessionStorageMock.setItem(STORAGE_KEY, "not-json{");
    const restored = initMorphFromStorage();
    expect(restored.amount).toBe(0);
  });
});

describe("useMorphStore – Immutability via getMorphState", () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    __resetMorphForTests();
  });

  it("getMorphState liefert eine Kopie — keine Mutation des intern Zustands", () => {
    const snapshot = getMorphState();
    snapshot.amount = 0.99;
    // intern unverändert (0)
    expect(getMorphState().amount).toBe(0);
  });
});
