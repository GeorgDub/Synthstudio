/**
 * tests/features/welcome-wizard.test.ts
 *
 * v3.22.0: Unit-Tests fuer useWelcomeStore + Try-It-Helpers.
 *
 * @vitest-environment jsdom
 *
 * Coverage:
 *  - First-Run-Detection (firstRun=true bei frischer Installation)
 *  - shouldAutoShowWelcome() Logik (firstRun && !dismissed)
 *  - markFirstRunComplete() persistiert firstRun=false
 *  - dismissWelcomeWizard() persistiert firstRun=false + dismissed=true
 *  - resetWelcomeWizard() setzt beides zurück
 *  - localStorage-Persistenz: state überlebt module-reload
 *  - dispatchWelcomeTryIt() feuert CustomEvent mit korrektem detail.target
 *  - buildWelcomeTryItDetail() reine Datenstruktur
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock (jsdom hat eines, aber wir resetten zwischen Tests) ──
function clearLocalStorage(): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  }
}

// Helper: re-import the module after clearing storage to test fresh-load path.
async function freshImport() {
  vi.resetModules();
  return await import("../../client/src/store/useWelcomeStore");
}

beforeEach(() => {
  clearLocalStorage();
  vi.resetModules();
});

describe("useWelcomeStore — First-Run-Detection", () => {
  it("firstRun=true bei frischer Installation (kein localStorage)", async () => {
    const mod = await freshImport();
    const s = mod.getWelcomeState();
    expect(s.firstRun).toBe(true);
    expect(s.dismissed).toBe(false);
  });

  it("shouldAutoShowWelcome() === true wenn firstRun && !dismissed", async () => {
    const mod = await freshImport();
    expect(mod.shouldAutoShowWelcome()).toBe(true);
  });

  it("shouldAutoShowWelcome() === false nach markFirstRunComplete()", async () => {
    const mod = await freshImport();
    mod.markFirstRunComplete();
    expect(mod.getWelcomeState().firstRun).toBe(false);
    expect(mod.shouldAutoShowWelcome()).toBe(false);
  });

  it("shouldAutoShowWelcome() === false wenn dismissed=true", async () => {
    const mod = await freshImport();
    mod.dismissWelcomeWizard();
    const s = mod.getWelcomeState();
    expect(s.firstRun).toBe(false);
    expect(s.dismissed).toBe(true);
    expect(mod.shouldAutoShowWelcome()).toBe(false);
  });
});

describe("useWelcomeStore — Persistenz", () => {
  it("dismissWelcomeWizard() persistiert in localStorage", async () => {
    const mod = await freshImport();
    mod.dismissWelcomeWizard();
    const raw = localStorage.getItem("synthstudio:welcome:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.firstRun).toBe(false);
    expect(parsed.dismissed).toBe(true);
  });

  it("Persistierter dismissed=true überlebt module-reload", async () => {
    // 1. Erst-Lauf: dismiss
    const m1 = await freshImport();
    m1.dismissWelcomeWizard();
    expect(m1.shouldAutoShowWelcome()).toBe(false);

    // 2. Modul neu importieren — sollte aus localStorage lesen
    const m2 = await freshImport();
    expect(m2.getWelcomeState().firstRun).toBe(false);
    expect(m2.getWelcomeState().dismissed).toBe(true);
    expect(m2.shouldAutoShowWelcome()).toBe(false);
  });

  it("markFirstRunComplete() überlebt module-reload", async () => {
    const m1 = await freshImport();
    m1.markFirstRunComplete();

    const m2 = await freshImport();
    expect(m2.getWelcomeState().firstRun).toBe(false);
    expect(m2.getWelcomeState().dismissed).toBe(false);
    // dismissed=false → manuelles Re-Open ist erlaubt
  });

  it("Korrupter localStorage-Inhalt fällt auf defaults zurück", async () => {
    localStorage.setItem("synthstudio:welcome:v1", "{this is not valid json");
    const mod = await freshImport();
    const s = mod.getWelcomeState();
    expect(s.firstRun).toBe(true);
    expect(s.dismissed).toBe(false);
  });

  it("resetWelcomeWizard() macht firstRun=true UND dismissed=false", async () => {
    const mod = await freshImport();
    mod.dismissWelcomeWizard();
    expect(mod.getWelcomeState().dismissed).toBe(true);

    mod.resetWelcomeWizard();
    expect(mod.getWelcomeState().firstRun).toBe(true);
    expect(mod.getWelcomeState().dismissed).toBe(false);
    expect(mod.shouldAutoShowWelcome()).toBe(true);
  });
});

describe("useWelcomeStore — Try-It-Now Event-Dispatch", () => {
  it("buildWelcomeTryItDetail() liefert { target }", async () => {
    const mod = await freshImport();
    const d = mod.buildWelcomeTryItDetail("korg-bank-editor");
    expect(d).toEqual({ target: "korg-bank-editor" });
  });

  it("dispatchWelcomeTryIt() feuert CustomEvent auf window mit korrektem detail", async () => {
    const mod = await freshImport();
    const received: Array<{ target: string }> = [];
    const handler = (e: Event): void => {
      const ce = e as CustomEvent<{ target: string }>;
      if (ce.detail) received.push(ce.detail);
    };
    window.addEventListener(mod.WELCOME_EVENT_NAME, handler as EventListener);

    mod.dispatchWelcomeTryIt("midi-settings");
    mod.dispatchWelcomeTryIt("sample-slicer");
    mod.dispatchWelcomeTryIt("settings");

    window.removeEventListener(mod.WELCOME_EVENT_NAME, handler as EventListener);

    expect(received).toHaveLength(3);
    expect(received[0].target).toBe("midi-settings");
    expect(received[1].target).toBe("sample-slicer");
    expect(received[2].target).toBe("settings");
  });

  it("WELCOME_EVENT_NAME ist stabiler String", async () => {
    const mod = await freshImport();
    expect(typeof mod.WELCOME_EVENT_NAME).toBe("string");
    expect(mod.WELCOME_EVENT_NAME.length).toBeGreaterThan(0);
    expect(mod.WELCOME_EVENT_NAME).toContain("welcome");
  });
});

describe("useWelcomeStore — Edge Cases", () => {
  it("markFirstRunComplete() idempotent — zweiter Call ändert nichts", async () => {
    const mod = await freshImport();
    mod.markFirstRunComplete();
    const s1 = { ...mod.getWelcomeState() };
    mod.markFirstRunComplete();
    const s2 = mod.getWelcomeState();
    expect(s2).toEqual(s1);
  });

  it("dismissWelcomeWizard() idempotent", async () => {
    const mod = await freshImport();
    mod.dismissWelcomeWizard();
    const s1 = { ...mod.getWelcomeState() };
    mod.dismissWelcomeWizard();
    expect(mod.getWelcomeState()).toEqual(s1);
  });

  it("__resetWelcomeStoreForTests() löscht localStorage UND state", async () => {
    const mod = await freshImport();
    mod.dismissWelcomeWizard();
    expect(localStorage.getItem("synthstudio:welcome:v1")).not.toBeNull();

    mod.__resetWelcomeStoreForTests();
    expect(localStorage.getItem("synthstudio:welcome:v1")).toBeNull();
    expect(mod.getWelcomeState().firstRun).toBe(true);
    expect(mod.getWelcomeState().dismissed).toBe(false);
  });
});
