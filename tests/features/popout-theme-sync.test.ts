/**
 * tests/features/popout-theme-sync.test.ts
 *
 * Unit-Tests für utils/popoutThemeSync.ts (MIG-3C).
 *
 * Wir testen NICHT die echten dockview-popouts (das macht der E2E-Test) sondern
 * die pure data-theme-Propagations-Logik. Document + window werden inline gemockt
 * damit das ohne jsdom in der Node-Test-Env läuft.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── Document-Mock fürs Hauptfenster ─────────────────────────────────────────
function createMockDocument() {
  const headChildren: Array<{ id: string; textContent: string; remove(): void }> = [];
  const html = {
    _attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) { this._attrs[k] = v; },
    removeAttribute(k: string) { delete this._attrs[k]; },
    getAttribute(k: string) { return this._attrs[k] ?? null; },
  };
  return {
    documentElement: html,
    readyState: "complete" as DocumentReadyState,
    head: {
      appendChild: (el: { id: string; textContent: string; remove(): void }) => { headChildren.push(el); },
    },
    getElementById: (id: string) => headChildren.find(e => e.id === id) ?? null,
    createElement: (_tag: string) => {
      const el = {
        id: "",
        textContent: "",
        remove() {
          const idx = headChildren.indexOf(el);
          if (idx >= 0) headChildren.splice(idx, 1);
        },
      };
      return el;
    },
    _headChildren: headChildren,
  };
}

// Module-Mock-Setup: globalThis.document wird vor Imports gesetzt
const mainDoc = createMockDocument();
(globalThis as unknown as { document: unknown }).document = mainDoc;

// Mock-Window für Popouts
function createMockWindow() {
  const doc = createMockDocument();
  return {
    document: doc as unknown as Document,
    closed: false,
    _unloadHandlers: [] as Array<() => void>,
    addEventListener(evt: string, fn: () => void) {
      if (evt === "unload") this._unloadHandlers.push(fn);
    },
    removeEventListener(_evt: string, _fn: () => void) {},
    _triggerUnload() {
      for (const fn of this._unloadHandlers) fn();
    },
    _doc: doc,
  };
}

describe("popoutThemeSync", () => {
  beforeEach(() => {
    // Reset main document state
    mainDoc.documentElement.removeAttribute("data-theme");
    const existing = mainDoc.getElementById("ss-custom-theme-style");
    if (existing) existing.remove();
  });

  it("registerPopoutWindow synct das aktuelle data-theme initial", async () => {
    mainDoc.documentElement.setAttribute("data-theme", "neon");
    const win = createMockWindow();
    const { registerPopoutWindow } = await import("../../client/src/utils/popoutThemeSync");

    registerPopoutWindow(win as unknown as Window);

    expect(win._doc.documentElement._attrs["data-theme"]).toBe("neon");
  });

  it("registerPopoutWindow ohne data-theme setzt kein Attribut", async () => {
    const win = createMockWindow();
    const { registerPopoutWindow } = await import("../../client/src/utils/popoutThemeSync");

    registerPopoutWindow(win as unknown as Window);

    expect(win._doc.documentElement._attrs["data-theme"]).toBeUndefined();
  });

  it("broadcastThemeToPopouts updated alle registrierten Fenster", async () => {
    const win1 = createMockWindow();
    const win2 = createMockWindow();
    const { registerPopoutWindow, broadcastThemeToPopouts } = await import("../../client/src/utils/popoutThemeSync");

    registerPopoutWindow(win1 as unknown as Window);
    registerPopoutWindow(win2 as unknown as Window);

    mainDoc.documentElement.setAttribute("data-theme", "sonnenuntergang");
    broadcastThemeToPopouts();

    expect(win1._doc.documentElement._attrs["data-theme"]).toBe("sonnenuntergang");
    expect(win2._doc.documentElement._attrs["data-theme"]).toBe("sonnenuntergang");
  });

  it("getPopoutCount reflektiert registrierte Fenster", async () => {
    const { registerPopoutWindow, getPopoutCount } = await import("../../client/src/utils/popoutThemeSync");
    const before = getPopoutCount();
    const win = createMockWindow();
    registerPopoutWindow(win as unknown as Window);
    expect(getPopoutCount()).toBe(before + 1);
  });

  it("cleanup-Function unregistert das Popout", async () => {
    const { registerPopoutWindow, getPopoutCount } = await import("../../client/src/utils/popoutThemeSync");
    const win = createMockWindow();
    const before = getPopoutCount();
    const cleanup = registerPopoutWindow(win as unknown as Window);
    expect(getPopoutCount()).toBe(before + 1);
    cleanup();
    expect(getPopoutCount()).toBe(before);
  });

  it("closed window wird beim Broadcast entfernt", async () => {
    const { registerPopoutWindow, broadcastThemeToPopouts, getPopoutCount } = await import("../../client/src/utils/popoutThemeSync");
    const win = createMockWindow();
    const before = getPopoutCount();
    registerPopoutWindow(win as unknown as Window);
    expect(getPopoutCount()).toBe(before + 1);

    win.closed = true;
    broadcastThemeToPopouts();
    expect(getPopoutCount()).toBe(before);
  });

  it("Custom-Theme <style> wird ins Popout geklont", async () => {
    const sourceStyle = mainDoc.createElement("style");
    sourceStyle.id = "ss-custom-theme-style";
    sourceStyle.textContent = ":root { --ss-bg-base: #000; }";
    mainDoc.head.appendChild(sourceStyle);

    const win = createMockWindow();
    const { registerPopoutWindow } = await import("../../client/src/utils/popoutThemeSync");
    registerPopoutWindow(win as unknown as Window);

    const clone = win._doc.getElementById("ss-custom-theme-style");
    expect(clone).not.toBeNull();
    expect(clone?.textContent).toBe(":root { --ss-bg-base: #000; }");
  });

  it("unload event auto-unregistert das Fenster", async () => {
    const { registerPopoutWindow, getPopoutCount } = await import("../../client/src/utils/popoutThemeSync");
    const win = createMockWindow();
    const before = getPopoutCount();
    registerPopoutWindow(win as unknown as Window);
    expect(getPopoutCount()).toBe(before + 1);

    win._triggerUnload();
    expect(getPopoutCount()).toBe(before);
  });
});
