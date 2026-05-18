// @vitest-environment jsdom
/**
 * omnitribe-panel-wiring.test.ts — Tests fuer das v3.17.0 OmniTribe-Wiring.
 *
 * SoT: SYNTHSTUDIO_INTEGRATION.md §5 Mapping-Tabelle.
 *
 * Coverage:
 *   - omniTribeWiring.ts helpers (clampPartIndex, uiToMidi, buildParamLow,
 *     decodeParamLow, granularPidToKey, sendGranularParam,
 *     sendWavetableParam, uploadWavetable, sendEuclideanParam)
 *   - omniTribeThrottle.ts (leading-edge + trailing-edge coalesce)
 *   - Connected-Gate: setParam wird NICHT gerufen wenn disconnected
 *   - paramChange-CustomEvent → korrekte Adress-Decodierung
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  OMNITRIBE_GRANULAR,
  OMNITRIBE_WAVETABLE,
  OMNITRIBE_EUCLIDEAN,
  buildParamLow,
  clampPartIndex,
  decodeParamLow,
  granularPidToKey,
  midiToUi,
  sendEuclideanParam,
  sendGranularParam,
  sendNrpn,
  sendWavetableParam,
  uiToMidi,
  uploadWavetable,
  wavetablePidToKey,
  __flushOmniTribeSends,
  __cancelOmniTribeSends,
} from "../../client/src/utils/omniTribeWiring";
import { makeThrottledSender } from "../../client/src/utils/omniTribeThrottle";
import { omniTribeBridge } from "../../client/src/audio/OmniTribeBridge";

// ─── Bridge-Mocks ───────────────────────────────────────────────────────────

let setParamCalls: Array<[number, number, number, number]> = [];
let uploadCalls: Array<[number, Float32Array[]]> = [];
let connectedFlag = false;

beforeEach(() => {
  setParamCalls = [];
  uploadCalls = [];
  connectedFlag = false;

  // Singleton-Spy ohne den ganzen Bridge-Init-Pfad zu durchlaufen
  vi.spyOn(omniTribeBridge, "setParam").mockImplementation(
    (part: number, ph: number, pl: number, value: number) => {
      setParamCalls.push([part, ph, pl, value]);
    },
  );
  vi.spyOn(omniTribeBridge, "uploadWavetable").mockImplementation(
    (slot: number, frames: Float32Array[]) => {
      uploadCalls.push([slot, frames]);
    },
  );
  vi.spyOn(omniTribeBridge, "isConnected", "get").mockImplementation(() => connectedFlag);

  __cancelOmniTribeSends();
});

afterEach(() => {
  vi.restoreAllMocks();
  __cancelOmniTribeSends();
});

// ─── Pure Helpers ────────────────────────────────────────────────────────────

describe("omniTribeWiring helpers", () => {
  it("clampPartIndex klemmt auf 0..15", () => {
    expect(clampPartIndex(0)).toBe(0);
    expect(clampPartIndex(7)).toBe(7);
    expect(clampPartIndex(15)).toBe(15);
    expect(clampPartIndex(16)).toBe(15);
    expect(clampPartIndex(-1)).toBe(0);
    expect(clampPartIndex(NaN)).toBe(0);
    expect(clampPartIndex(3.9)).toBe(3);
  });

  it("uiToMidi mapped linear 0..1 → 0..127, NaN→0, geklemmt", () => {
    expect(uiToMidi(0, 0, 1)).toBe(0);
    expect(uiToMidi(1, 0, 1)).toBe(127);
    expect(uiToMidi(0.5, 0, 1)).toBe(64);
    expect(uiToMidi(2, 0, 1)).toBe(127);     // ueberlauf clamp
    expect(uiToMidi(-1, 0, 1)).toBe(0);
    expect(uiToMidi(NaN)).toBe(0);
    expect(uiToMidi(100, 0, 200)).toBe(64);  // alternative range
  });

  it("midiToUi ist die Umkehrung von uiToMidi (auf gerundete MIDI-Werte)", () => {
    for (let v = 0; v <= 127; v += 8) {
      const ui = midiToUi(v, 0, 1);
      const round = uiToMidi(ui, 0, 1);
      expect(round).toBe(v);
    }
  });

  it("buildParamLow packt part (Bits 7..4, MIDI 7-bit-clamp) und pid (Bits 3..0)", () => {
    expect(buildParamLow(0x00, 0)).toBe(0x00);
    expect(buildParamLow(0x05, 0)).toBe(0x05);
    expect(buildParamLow(0x00, 1)).toBe(0x10);
    expect(buildParamLow(0x05, 1)).toBe(0x15);
    expect(buildParamLow(0x03, 7)).toBe(0x73);
    // MIDI-Daten-Byte ist 7-bit → top-bit wird gemaskt. Part-Index >7
    // verliert das MSB, was die NRPN-Adress-Konvention im Sysex-Frame
    // mit der Bridge konsistent haelt (siehe OmniTribeBridge.setParam mask
    // paramLow & 0x7F). Der dedizierte 'part'-Arg wird separat als
    // u4 im Sysex-Payload uebertragen, daher kein Adress-Konflikt.
    expect(buildParamLow(0x05, 16)).toBe(0x75);   // part=16→15, 0xF5 masked → 0x75
    expect(buildParamLow(0x05, 8)).toBe(0x05);    // part=8: 0x85 masked → 0x05 (bit 7 dropped)
  });

  it("decodeParamLow ist die Umkehrung von buildParamLow fuer part 0..7", () => {
    // Nur fuer part 0..7 ist die Round-Trip-Eigenschaft erfuellt — Parts
    // 8..15 brauchen den separaten 'part'-Arg im Sysex-Frame um eindeutig
    // dekodierbar zu sein. Panels nutzen diesen separaten Arg via
    // CustomEvent.detail.part, nicht decodeParamLow.
    for (let part = 0; part < 8; part++) {
      for (let pid = 0; pid < 16; pid++) {
        const pl = buildParamLow(pid, part);
        expect(decodeParamLow(pl)).toEqual({ pid, part });
      }
    }
  });

  it("granularPidToKey + wavetablePidToKey decodieren bekannte PIDs", () => {
    expect(granularPidToKey(OMNITRIBE_GRANULAR.GRAIN_SIZE)).toBe("grainSize");
    expect(granularPidToKey(OMNITRIBE_GRANULAR.DENSITY)).toBe("density");
    expect(granularPidToKey(OMNITRIBE_GRANULAR.PITCH_SCATTER)).toBe("pitchScatter");
    expect(granularPidToKey(OMNITRIBE_GRANULAR.POSITION)).toBe("position");
    expect(granularPidToKey(OMNITRIBE_GRANULAR.SPRAY)).toBe("spray");
    expect(granularPidToKey(OMNITRIBE_GRANULAR.FEEDBACK)).toBe("feedback");
    expect(granularPidToKey(0x0E)).toBeNull();
    expect(wavetablePidToKey(OMNITRIBE_WAVETABLE.FRAME_POSITION)).toBe("framePosition");
    expect(wavetablePidToKey(OMNITRIBE_WAVETABLE.MORPH_SPEED)).toBe("morphSpeed");
    expect(wavetablePidToKey(0x0E)).toBeNull();
  });
});

// ─── Connected-Gate ──────────────────────────────────────────────────────────

describe("Connected-Gate: NO-OP wenn nicht connected", () => {
  it("sendNrpn ruft nicht setParam wenn isConnected=false", () => {
    connectedFlag = false;
    sendNrpn(0, 0x19, 0x00, 64);
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(0);
  });

  it("sendGranularParam ruft nicht setParam wenn isConnected=false", () => {
    connectedFlag = false;
    sendGranularParam(0, "grainSize", 100);
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(0);
  });

  it("uploadWavetable ist NO-OP wenn isConnected=false", () => {
    connectedFlag = false;
    uploadWavetable(3, [new Float32Array([0, 0.5, 1.0])]);
    expect(uploadCalls).toHaveLength(0);
  });
});

// ─── sendGranularParam: korrekte NRPN-Adresse ───────────────────────────────

describe("sendGranularParam", () => {
  it("Slider-Change ruft setParam mit korrektem paramHigh=0x19 + paramLow", () => {
    connectedFlag = true;
    sendGranularParam(0, "grainSize", 100);     // UI 100ms in [10..500] → midi ~23
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(1);
    const [part, ph, pl, value] = setParamCalls[0];
    expect(part).toBe(0);
    expect(ph).toBe(OMNITRIBE_GRANULAR.PARAM_HIGH);
    expect(pl).toBe(buildParamLow(OMNITRIBE_GRANULAR.GRAIN_SIZE, 0));
    // (100-10)/(500-10) = 90/490 ≈ 0.1837 * 127 ≈ 23
    expect(value).toBe(23);
  });

  it("part-Index landet in paramLow Bits 7..4", () => {
    connectedFlag = true;
    sendGranularParam(7, "density", 25);   // 25 in [1..50] → ~62
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(1);
    const [part, ph, pl] = setParamCalls[0];
    expect(part).toBe(7);
    expect(ph).toBe(OMNITRIBE_GRANULAR.PARAM_HIGH);
    expect(pl).toBe(buildParamLow(OMNITRIBE_GRANULAR.DENSITY, 7));
    // (25-1)/(50-1) = 24/49 ≈ 0.4898 * 127 ≈ 62
    expect(setParamCalls[0][3]).toBe(62);
  });

  it("position/spray nutzen die 0..1 Range direkt", () => {
    connectedFlag = true;
    sendGranularParam(2, "position", 0.5);
    sendGranularParam(2, "spray", 0.0);
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(2);
    expect(setParamCalls[0][3]).toBe(64);
    expect(setParamCalls[1][3]).toBe(0);
  });
});

// ─── sendWavetableParam ──────────────────────────────────────────────────────

describe("sendWavetableParam", () => {
  it("Frame-Position-Change → NRPN 0x07/0x01", () => {
    connectedFlag = true;
    sendWavetableParam(0, "framePosition", 1.0);
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(1);
    const [part, ph, pl, value] = setParamCalls[0];
    expect(part).toBe(0);
    expect(ph).toBe(OMNITRIBE_WAVETABLE.PARAM_HIGH);
    expect(pl).toBe(buildParamLow(OMNITRIBE_WAVETABLE.FRAME_POSITION, 0));
    expect(value).toBe(127);
  });

  it("Morph-Speed @ part=3 packt korrekt", () => {
    connectedFlag = true;
    sendWavetableParam(3, "morphSpeed", 0.5);
    __flushOmniTribeSends();
    const [, ph, pl, value] = setParamCalls[0];
    expect(ph).toBe(OMNITRIBE_WAVETABLE.PARAM_HIGH);
    expect(pl).toBe(buildParamLow(OMNITRIBE_WAVETABLE.MORPH_SPEED, 3));
    expect(value).toBe(64);
  });

  it("uploadWavetable ruft bridge.uploadWavetable mit slot+frames", () => {
    connectedFlag = true;
    const f0 = new Float32Array([0, 0.5, 1.0]);
    uploadWavetable(5, [f0]);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0][0]).toBe(5);
    expect(uploadCalls[0][1]).toHaveLength(1);
    expect(uploadCalls[0][1][0]).toBe(f0);
  });
});

// ─── sendEuclideanParam ──────────────────────────────────────────────────────

describe("sendEuclideanParam", () => {
  it("apply n=16, k=4 sendet 4 setParam-Calls mit korrekter Adresse", () => {
    connectedFlag = true;
    sendEuclideanParam(0, "nSteps", 16);
    sendEuclideanParam(0, "kHits", 4);
    sendEuclideanParam(0, "rotation", 0);
    sendEuclideanParam(0, "enable", 1);
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(4);
    const phs = new Set(setParamCalls.map(c => c[1]));
    expect(phs).toEqual(new Set([OMNITRIBE_EUCLIDEAN.PARAM_HIGH]));
    const pls = setParamCalls.map(c => c[2]);
    expect(pls).toContain(buildParamLow(OMNITRIBE_EUCLIDEAN.N_STEPS, 0));
    expect(pls).toContain(buildParamLow(OMNITRIBE_EUCLIDEAN.K_HITS, 0));
    expect(pls).toContain(buildParamLow(OMNITRIBE_EUCLIDEAN.ROTATION, 0));
    expect(pls).toContain(buildParamLow(OMNITRIBE_EUCLIDEAN.ENABLE, 0));
  });

  it("Werte werden geklemmt auf 0..127 und gerundet", () => {
    connectedFlag = true;
    sendEuclideanParam(0, "kHits", 200);
    sendEuclideanParam(0, "rotation", -5);
    sendEuclideanParam(0, "nSteps", 7.6);
    __flushOmniTribeSends();
    expect(setParamCalls).toHaveLength(3);
    expect(setParamCalls[0][3]).toBe(127);   // 200 → clamp 127
    expect(setParamCalls[1][3]).toBe(0);     // -5 → clamp 0
    expect(setParamCalls[2][3]).toBe(8);     // 7.6 → round 8
  });
});

// ─── paramChange-Event Decodierung (in-Module-Sanity-Check) ──────────────────

describe("paramChange-Event decode for Granular", () => {
  it("decodeParamLow + granularPidToKey liefern korrekte UI-Key fuer matching part", () => {
    // simuliere ein paramChange-detail mit part=2 + grainSize-PID
    const part = 2;
    const pl = buildParamLow(OMNITRIBE_GRANULAR.GRAIN_SIZE, part);
    const dec = decodeParamLow(pl);
    expect(dec.part).toBe(2);
    expect(granularPidToKey(dec.pid)).toBe("grainSize");
  });

  it("paramChange fuer andere part wird per Part-Check ignoriert", () => {
    // Panel rendert fuer part=0. Event kommt fuer part=5 → muss ignoriert werden.
    const localPart = 0;
    const incomingPart = 5;
    const pl = buildParamLow(OMNITRIBE_GRANULAR.DENSITY, incomingPart);
    const dec = decodeParamLow(pl);
    expect(dec.part).toBe(incomingPart);
    expect(dec.part === localPart).toBe(false);   // panel-side guard
  });
});

// ─── Throttle ────────────────────────────────────────────────────────────────

describe("makeThrottledSender (omniTribeThrottle)", () => {
  it("leading-edge: erster Call sendet sofort", () => {
    const sent: number[] = [];
    const { send } = makeThrottledSender<[number]>(([v]) => sent.push(v));
    send("k", [1]);
    expect(sent).toEqual([1]);
  });

  it("trailing-edge: rapide Calls coalescen zum letzten Wert + werden geflushed", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const { send } = makeThrottledSender<[number]>(([v]) => sent.push(v), { minIntervalMs: 16 });
    send("k", [1]);   // leading immediate
    send("k", [2]);   // coalesced
    send("k", [3]);   // coalesced — sollte letzten Wert (3) trailing senden
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(20);
    expect(sent).toEqual([1, 3]);
    vi.useRealTimers();
  });

  it("flush(key) liefert pending immediately", () => {
    const sent: number[] = [];
    const { send, flush } = makeThrottledSender<[number]>(([v]) => sent.push(v), { minIntervalMs: 50 });
    send("k", [1]);
    send("k", [2]);
    flush("k");
    expect(sent).toEqual([1, 2]);
  });

  it("cancel(key) verwirft pending ohne fn-Call", () => {
    const sent: number[] = [];
    const { send, cancel } = makeThrottledSender<[number]>(([v]) => sent.push(v), { minIntervalMs: 50 });
    send("k", [1]);
    send("k", [2]);
    cancel("k");
    expect(sent).toEqual([1]);   // nur das leading
  });

  it("verschiedene Keys teilen sich keinen Slot", () => {
    const sent: Array<[string, number]> = [];
    const { send } = makeThrottledSender<[string, number]>(
      ([k, v]) => sent.push([k, v]),
      { minIntervalMs: 16 },
    );
    send("a", ["a", 1]);
    send("b", ["b", 2]);
    expect(sent).toEqual([["a", 1], ["b", 2]]);
  });
});
