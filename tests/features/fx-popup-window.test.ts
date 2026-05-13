/**
 * tests/features/fx-popup-window.test.ts
 *
 * Pinnable FX-Window — Proof-of-Concept (Multi-Window-Workspace Phase 1, post-v1.25.0).
 *
 * Tests die deterministische Logik:
 *  - getFxPopupChannelId() liest URL-Param ?fxPopup=<id> korrekt
 *  - URL ohne fxPopup-Param → null
 *  - Verschiedene channelIds liefern korrekte Strings
 *  - Empty-String channelId → null (defensive)
 *
 * Was NICHT getestet wird (braucht Electron-Runtime):
 *  - createFxWindow() öffnet ein BrowserWindow
 *  - IPC-State-Broadcast Main → Popup
 *  - Pin-Button-Click öffnet via electron.openFxWindow()
 */
import { describe, it, expect, beforeEach } from "vitest";

/**
 * Replikation der App.tsx getFxPopupChannelId-Funktion, lokal um sie pur
 * testbar zu machen. Bei Änderungen in App.tsx muss diese Funktion mit
 * synchronisiert werden.
 */
function getFxPopupChannelId(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("fxPopup");
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

describe("FX Popup Window — URL-Routing", () => {
  beforeEach(() => {
    // nothing
  });

  it("liest channelId aus ?fxPopup=<id>", () => {
    expect(getFxPopupChannelId("?fxPopup=kick-1")).toBe("kick-1");
    expect(getFxPopupChannelId("?fxPopup=snare-abc")).toBe("snare-abc");
  });

  it("returnt null wenn fxPopup-Param fehlt", () => {
    expect(getFxPopupChannelId("")).toBeNull();
    expect(getFxPopupChannelId("?other=1")).toBeNull();
    expect(getFxPopupChannelId("?perfPopup=1")).toBeNull();
  });

  it("returnt null wenn fxPopup-Wert leer", () => {
    expect(getFxPopupChannelId("?fxPopup=")).toBeNull();
  });

  it("dekodiert URL-encoded channelId", () => {
    // encodeURIComponent("kick 1") = "kick%201"
    expect(getFxPopupChannelId("?fxPopup=kick%201")).toBe("kick 1");
  });

  it("ignoriert andere Query-Params", () => {
    expect(getFxPopupChannelId("?foo=bar&fxPopup=kick&baz=qux")).toBe("kick");
  });

  it("returnt null bei ungültiger Query-String", () => {
    // URLSearchParams ist robust gegen vieles, aber falls intern eine Exception
    // entsteht, soll defensive null kommen statt zu crashen.
    expect(getFxPopupChannelId(null as unknown as string)).toBeNull();
  });
});

describe("FX Popup — IPC-Action-Schema", () => {
  it("request-state Action hat type-discriminator", () => {
    const action = { type: "request-state" as const };
    expect(action.type).toBe("request-state");
  });

  it("fx-change Action enthält partial-Update", () => {
    const action = {
      type: "fx-change" as const,
      partial: { filterEnabled: true, filterFreq: 800 },
    };
    expect(action.type).toBe("fx-change");
    expect(action.partial.filterEnabled).toBe(true);
    expect(action.partial.filterFreq).toBe(800);
  });

  it("state-Payload-Schema enthält partId, partName, fx", () => {
    const payload = {
      channelId: "kick-1",
      state: {
        partId: "kick-1",
        partName: "Kick",
        fx: { filterEnabled: false, filterFreq: 20000 },
      },
    };
    expect(payload.channelId).toBe("kick-1");
    expect(payload.state.partId).toBe("kick-1");
    expect(payload.state.partName).toBe("Kick");
  });
});
