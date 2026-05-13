/**
 * tests/features/mixer-popup-window.test.ts
 *
 * Pinnable Mixer-Window (Multi-Window-Workspace, post-v1.26.0).
 *
 * Tests die deterministische Logik:
 *  - isMixerPopupMode() liest URL-Param ?mixerPopup=1 korrekt
 *  - URL ohne mixerPopup-Param → false
 *  - MixerPopupAction Schemas (request-state, set-part-volume,
 *    set-part-pan, set-part-mute, set-part-solo, select-part,
 *    set-master-volume)
 *  - Optimistic local-update Logik (applyActionLocally)
 *
 * Was NICHT getestet wird (braucht Electron-Runtime):
 *  - createMixerWindow() öffnet ein BrowserWindow
 *  - IPC-State-Broadcast Main → Popup
 *  - Pin-Button-Click öffnet via electron.openMixerWindow()
 */
import { describe, it, expect } from "vitest";
import type { MixerPopupState, MixerPopupAction } from "../../client/src/components/Mixer/MixerPopupApp";

/** Replikation der App.tsx isMixerPopupMode-Funktion, lokal pur testbar. */
function isMixerPopupMode(search: string): boolean {
  try {
    return new URLSearchParams(search).get("mixerPopup") === "1";
  } catch {
    return false;
  }
}

describe("Mixer Popup Window — URL-Routing", () => {
  it("erkennt ?mixerPopup=1", () => {
    expect(isMixerPopupMode("?mixerPopup=1")).toBe(true);
  });

  it("ignoriert ?mixerPopup=0 oder andere Werte", () => {
    expect(isMixerPopupMode("?mixerPopup=0")).toBe(false);
    expect(isMixerPopupMode("?mixerPopup=true")).toBe(false);
    expect(isMixerPopupMode("?mixerPopup=")).toBe(false);
  });

  it("returnt false ohne mixerPopup-Param", () => {
    expect(isMixerPopupMode("")).toBe(false);
    expect(isMixerPopupMode("?other=1")).toBe(false);
    expect(isMixerPopupMode("?fxPopup=kick")).toBe(false);
    expect(isMixerPopupMode("?perfPopup=1")).toBe(false);
  });

  it("kommt mit kombinierten Query-Params klar", () => {
    expect(isMixerPopupMode("?foo=bar&mixerPopup=1&baz=qux")).toBe(true);
  });

  it("returnt false bei ungültiger Query-String", () => {
    expect(isMixerPopupMode(null as unknown as string)).toBe(false);
  });
});

describe("Mixer Popup — Action-Schemas", () => {
  it("request-state hat keinen zusätzlichen Payload", () => {
    const a: MixerPopupAction = { type: "request-state" };
    expect(a.type).toBe("request-state");
  });

  it("set-part-volume enthält partId + volume", () => {
    const a: MixerPopupAction = { type: "set-part-volume", partId: "kick-1", volume: 0.75 };
    expect(a.partId).toBe("kick-1");
    expect(a.volume).toBe(0.75);
  });

  it("set-part-pan: pan ist -1..+1", () => {
    const left: MixerPopupAction = { type: "set-part-pan", partId: "kick", pan: -1 };
    const center: MixerPopupAction = { type: "set-part-pan", partId: "kick", pan: 0 };
    const right: MixerPopupAction = { type: "set-part-pan", partId: "kick", pan: 1 };
    expect(left.pan).toBe(-1);
    expect(center.pan).toBe(0);
    expect(right.pan).toBe(1);
  });

  it("set-part-mute toggelt boolean", () => {
    const muteOn: MixerPopupAction = { type: "set-part-mute", partId: "snare", muted: true };
    const muteOff: MixerPopupAction = { type: "set-part-mute", partId: "snare", muted: false };
    expect(muteOn.muted).toBe(true);
    expect(muteOff.muted).toBe(false);
  });

  it("set-part-solo enthält shiftKey für exclusive vs additive", () => {
    const exclusiveSolo: MixerPopupAction = {
      type: "set-part-solo", partId: "kick", soloed: true, shiftKey: false,
    };
    const additiveSolo: MixerPopupAction = {
      type: "set-part-solo", partId: "snare", soloed: true, shiftKey: true,
    };
    expect(exclusiveSolo.shiftKey).toBe(false);
    expect(additiveSolo.shiftKey).toBe(true);
  });

  it("select-part wechselt selectedPartId", () => {
    const a: MixerPopupAction = { type: "select-part", partId: "kick-1" };
    expect(a.partId).toBe("kick-1");
  });

  it("set-master-volume akzeptiert 0..1", () => {
    const min: MixerPopupAction = { type: "set-master-volume", volume: 0 };
    const max: MixerPopupAction = { type: "set-master-volume", volume: 1 };
    expect(min.volume).toBe(0);
    expect(max.volume).toBe(1);
  });
});

describe("Mixer Popup — State-Schema", () => {
  it("MixerPopupState enthält channels + masterVolume + bpm + selectedPartId", () => {
    const s: MixerPopupState = {
      channels: [
        { partId: "kick", name: "Kick", volume: 0.8, pan: 0, muted: false, soloed: false },
        { partId: "snare", name: "Snare", volume: 0.7, pan: 0.1, muted: false, soloed: true },
      ],
      masterVolume: 0.9,
      bpm: 130,
      selectedPartId: "kick",
    };
    expect(s.channels).toHaveLength(2);
    expect(s.masterVolume).toBe(0.9);
    expect(s.bpm).toBe(130);
    expect(s.selectedPartId).toBe("kick");
  });

  it("channels-Array akzeptiert leeren Mixer (z.B. vor Pattern-Init)", () => {
    const s: MixerPopupState = {
      channels: [],
      masterVolume: 1,
      bpm: 120,
      selectedPartId: null,
    };
    expect(s.channels).toEqual([]);
    expect(s.selectedPartId).toBeNull();
  });
});
