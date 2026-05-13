/**
 * tests/features/sample-browser-popup-window.test.ts
 *
 * Pinnable Sample-Browser-Window (Multi-Window-Workspace, post-v1.27.0).
 *
 * Tests die deterministische Logik:
 *  - isSampleBrowserPopupMode() liest URL-Param ?sampleBrowserPopup=1 korrekt
 *  - SampleBrowserPopupAction Schemas (request-state, assign-sample-to-active-channel)
 *  - State-Schema mit samples + activeChannelName
 *  - filterSamples() Filter-Logik (Suche + Kategorie)
 *
 * Was NICHT getestet wird (braucht Electron-Runtime):
 *  - createSampleBrowserWindow() öffnet ein BrowserWindow
 *  - IPC-State-Broadcast Main → Popup
 *  - Pin-Button-Click öffnet via electron.openSampleBrowserWindow()
 *  - dm.setPartSample bei assign-Action
 */
import { describe, it, expect } from "vitest";
import type {
  SampleBrowserPopupState,
  SampleBrowserPopupAction,
  SamplePopupItem,
} from "../../client/src/components/SampleBrowser/SampleBrowserPopupApp";

/** Replikation der App.tsx isSampleBrowserPopupMode-Funktion, lokal pur testbar. */
function isSampleBrowserPopupMode(search: string): boolean {
  try {
    return new URLSearchParams(search).get("sampleBrowserPopup") === "1";
  } catch {
    return false;
  }
}

/** Replikation der Filter-Logik im SampleBrowserPopupApp für Test-Coverage. */
function filterSamples(
  samples: SamplePopupItem[],
  searchQuery: string,
  categoryFilter: string,
): SamplePopupItem[] {
  const q = searchQuery.trim().toLowerCase();
  return samples.filter((s) => {
    if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
    if (q && !s.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

describe("Sample Browser Popup Window — URL-Routing", () => {
  it("erkennt ?sampleBrowserPopup=1", () => {
    expect(isSampleBrowserPopupMode("?sampleBrowserPopup=1")).toBe(true);
  });

  it("ignoriert andere Werte", () => {
    expect(isSampleBrowserPopupMode("?sampleBrowserPopup=0")).toBe(false);
    expect(isSampleBrowserPopupMode("?sampleBrowserPopup=true")).toBe(false);
    expect(isSampleBrowserPopupMode("?sampleBrowserPopup=")).toBe(false);
  });

  it("returnt false ohne Param", () => {
    expect(isSampleBrowserPopupMode("")).toBe(false);
    expect(isSampleBrowserPopupMode("?other=1")).toBe(false);
    expect(isSampleBrowserPopupMode("?mixerPopup=1")).toBe(false);
    expect(isSampleBrowserPopupMode("?fxPopup=kick")).toBe(false);
  });

  it("kommt mit kombinierten Query-Params klar", () => {
    expect(isSampleBrowserPopupMode("?foo=bar&sampleBrowserPopup=1&baz=qux")).toBe(true);
  });

  it("returnt false bei ungültiger Query-String", () => {
    expect(isSampleBrowserPopupMode(null as unknown as string)).toBe(false);
  });
});

describe("Sample Browser Popup — Action-Schemas", () => {
  it("request-state hat keinen zusätzlichen Payload", () => {
    const a: SampleBrowserPopupAction = { type: "request-state" };
    expect(a.type).toBe("request-state");
  });

  it("assign-sample-to-active-channel enthält sampleId", () => {
    const a: SampleBrowserPopupAction = {
      type: "assign-sample-to-active-channel",
      sampleId: "smp-123",
    };
    expect(a.type).toBe("assign-sample-to-active-channel");
    expect(a.sampleId).toBe("smp-123");
  });
});

describe("Sample Browser Popup — State-Schema", () => {
  it("enthält samples + activeChannelName", () => {
    const s: SampleBrowserPopupState = {
      samples: [
        { id: "1", name: "kick.wav", category: "kicks", size: 12345 },
        { id: "2", name: "snare.wav", category: "snares", size: 8000 },
      ],
      activeChannelName: "Kick",
    };
    expect(s.samples).toHaveLength(2);
    expect(s.activeChannelName).toBe("Kick");
  });

  it("activeChannelName kann null sein wenn kein Kanal aktiv", () => {
    const s: SampleBrowserPopupState = {
      samples: [],
      activeChannelName: null,
    };
    expect(s.activeChannelName).toBeNull();
  });

  it("size ist optional", () => {
    const item: SamplePopupItem = { id: "x", name: "y.wav", category: "fx" };
    expect(item.size).toBeUndefined();
  });
});

describe("Sample Browser Popup — Filter-Logik", () => {
  const samples: SamplePopupItem[] = [
    { id: "1", name: "kick-deep.wav", category: "kicks" },
    { id: "2", name: "kick-tight.wav", category: "kicks" },
    { id: "3", name: "snare-fat.wav", category: "snares" },
    { id: "4", name: "hat-closed.wav", category: "hihats" },
    { id: "5", name: "perc-loop.wav", category: "percussion" },
  ];

  it("category=all + leere Suche → alle Samples", () => {
    expect(filterSamples(samples, "", "all")).toHaveLength(5);
  });

  it("category=kicks filtert nur kicks", () => {
    const out = filterSamples(samples, "", "kicks");
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.category === "kicks")).toBe(true);
  });

  it("Suche filtert nach Name (case-insensitive)", () => {
    expect(filterSamples(samples, "kick", "all")).toHaveLength(2);
    expect(filterSamples(samples, "KICK", "all")).toHaveLength(2);
    expect(filterSamples(samples, "Snare", "all")).toHaveLength(1);
  });

  it("Suche + Kategorie kombinieren mit UND", () => {
    expect(filterSamples(samples, "tight", "kicks")).toHaveLength(1);
    expect(filterSamples(samples, "tight", "snares")).toHaveLength(0);
  });

  it("trimmt Whitespace in der Suche", () => {
    expect(filterSamples(samples, "  kick  ", "all")).toHaveLength(2);
  });

  it("leerer Suche-String wirkt wie kein Filter", () => {
    expect(filterSamples(samples, "", "all")).toHaveLength(5);
    expect(filterSamples(samples, "   ", "all")).toHaveLength(5);
  });

  it("returnt leeres Array wenn nichts matcht", () => {
    expect(filterSamples(samples, "xyz123notfound", "all")).toHaveLength(0);
  });
});
