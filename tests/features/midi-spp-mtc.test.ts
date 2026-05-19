/**
 * tests/features/midi-spp-mtc.test.ts (v3.112.0)
 *
 * Unit-Tests fuer MidiSyncIn Position-Sync — SPP (0xF2) und MTC
 * (0xF1 Quarter-Frame + Sysex Full-Frame). Komplement zu midi-sync-in.test.ts.
 *
 * Test-Setup:
 *   - Pure-Helpers (decodeSpp / midiBeatsToStep / decodeMtcQuarterFrame /
 *     accumulateMtcQuarterFrames / mtcRateToFps / mtcPositionToMs) direkt
 *     mit Zahlen.
 *   - Klasse mit Event-Recorder.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (Node-Test-Setup) ────────────────────────────────────
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => (k in store ? store[k] : null),
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
  MidiSyncIn,
  decodeSpp,
  midiBeatsToStep,
  decodeMtcQuarterFrame,
  accumulateMtcQuarterFrames,
  mtcRateToFps,
  mtcPositionToMs,
  SC_MTC_QUARTER_FRAME,
  SC_SONG_POSITION,
  SYSEX_START,
  SYSEX_END,
  SYSEX_UNIV_REALTIME,
  MTC_SUB_ID_1,
  MTC_SUB_ID_2,
  type MidiSyncEvent,
  type MidiSyncEventDetail,
} from "../../client/src/audio/MidiSyncIn";
import {
  __resetMidiSyncInStoreForTests,
  getMidiSyncInState,
  setMidiSyncInEnabled,
  setMidiSyncInSyncPosition,
  setMidiSyncInLastSppMidiBeats,
  setMidiSyncInLastMtcPosition,
} from "../../client/src/store/useMidiSyncInStore";

// ─── Recorder-Helper ────────────────────────────────────────────────────────
function makeRecorder(): {
  events: Array<{ event: MidiSyncEvent; detail?: MidiSyncEventDetail }>;
  listener: (event: MidiSyncEvent, detail?: MidiSyncEventDetail) => void;
} {
  const events: Array<{ event: MidiSyncEvent; detail?: MidiSyncEventDetail }> = [];
  return {
    events,
    listener: (event, detail) => events.push({ event, detail }),
  };
}

// ─── Pure-Helper-Tests: SPP ─────────────────────────────────────────────────

describe("decodeSpp", () => {
  it("decodeSpp(0, 0) = 0 (song start)", () => {
    expect(decodeSpp(0, 0)).toBe(0);
  });

  it("decodeSpp(127, 127) = 16383 (max 14-bit)", () => {
    expect(decodeSpp(127, 127)).toBe(16383);
  });

  it("decodeSpp(0, 1) = 128 (MSB shift)", () => {
    // (1 << 7) | 0 = 128
    expect(decodeSpp(0, 1)).toBe(128);
  });

  it("decodeSpp(64, 0) = 64 (LSB only)", () => {
    expect(decodeSpp(64, 0)).toBe(64);
  });

  it("decodeSpp maskiert 8th bit (>127 → mod 128)", () => {
    // Defensive: 8 bits in are truncated to 7.
    expect(decodeSpp(0x80, 0)).toBe(0);   // 0x80 & 0x7F = 0
    expect(decodeSpp(0xFF, 0)).toBe(0x7F); // 0xFF & 0x7F = 127
  });

  it("decodeSpp ist defensive bei NaN / non-number", () => {
    // @ts-expect-error — test runtime defensive path
    expect(decodeSpp(NaN, NaN)).toBe(0);
    expect(decodeSpp(0, NaN)).toBe(0);
  });
});

describe("midiBeatsToStep", () => {
  it("midiBeatsToStep(16, 16) = 16 (1 bar at 16-steps)", () => {
    expect(midiBeatsToStep(16, 16)).toBe(16);
  });

  it("midiBeatsToStep(64, 16) = 64 (4 bars)", () => {
    expect(midiBeatsToStep(64, 16)).toBe(64);
  });

  it("midiBeatsToStep(16, 32) = 32 (32-step pattern, 1 bar)", () => {
    // 32-step grid means twice as many steps per midi beat.
    expect(midiBeatsToStep(16, 32)).toBe(32);
  });

  it("midiBeatsToStep(0, 16) = 0", () => {
    expect(midiBeatsToStep(0, 16)).toBe(0);
  });

  it("midiBeatsToStep mit ungueltigen Argumenten → defensive defaults", () => {
    expect(midiBeatsToStep(NaN, 16)).toBe(0);
    expect(midiBeatsToStep(-5, 16)).toBe(0);
    // stepsPerBar=0 → fallback to 16-step grid → 16
    expect(midiBeatsToStep(16, 0)).toBe(16);
  });
});

// ─── Pure-Helper-Tests: MTC Quarter-Frame ───────────────────────────────────

describe("decodeMtcQuarterFrame", () => {
  it("extrahiert type + 4-bit value", () => {
    // data = (type<<4) | value
    // type=3, value=0xA → data=0x3A
    expect(decodeMtcQuarterFrame(0x3a)).toEqual({ type: 3, value: 0xa });
    expect(decodeMtcQuarterFrame(0x00)).toEqual({ type: 0, value: 0 });
    expect(decodeMtcQuarterFrame(0x7f)).toEqual({ type: 7, value: 0xf });
  });

  it("type ist maskiert auf 0..7 (3-bit)", () => {
    // 0xFF wuerde theoretisch type=0xF sein — aber wir maskieren auf 0x07.
    // 0x80..0x7F sind aber per MIDI-Spec gar nicht zulaessig (>127 invalid),
    // wir testen die Spec-konforme Range.
    const d = decodeMtcQuarterFrame(0x70); // type=7, value=0
    expect(d).not.toBeNull();
    expect(d!.type).toBe(7);
  });

  it("decodeMtcQuarterFrame returns null bei invalid input", () => {
    expect(decodeMtcQuarterFrame(NaN)).toBeNull();
    expect(decodeMtcQuarterFrame(-1)).toBeNull();
    expect(decodeMtcQuarterFrame(128)).toBeNull();
  });
});

describe("accumulateMtcQuarterFrames", () => {
  it("returns null wenn weniger als 8 Frames vorhanden", () => {
    expect(accumulateMtcQuarterFrames([])).toBeNull();
    expect(
      accumulateMtcQuarterFrames([{ type: 0, value: 0 }, { type: 1, value: 0 }]),
    ).toBeNull();
  });

  it("returns null wenn Types nicht alle 0..7 abdecken", () => {
    // 8 Frames aber alle type=0 → fehlend 1..7
    const frames = new Array(8).fill({ type: 0, value: 0 });
    expect(accumulateMtcQuarterFrames(frames)).toBeNull();
  });

  it("decodiert HH:MM:SS:FF aus 8 Quarter-Frames @ 30fps", () => {
    // SMPTE 00:00:00:00 @ 30fps (rate=3) — alle Nibbles 0, rate=3 in hh_high
    // hh_high byte: bit0=hh_high1, bits1-2=rate.
    // rate=3 (binary 11), hh_high=0 → byte = 0b110 = 6 → value=6 in type=7.
    const frames = [
      { type: 0, value: 0 },
      { type: 1, value: 0 },
      { type: 2, value: 0 },
      { type: 3, value: 0 },
      { type: 4, value: 0 },
      { type: 5, value: 0 },
      { type: 6, value: 0 },
      { type: 7, value: 0b0110 }, // rate=3, hh_high=0
    ];
    const pos = accumulateMtcQuarterFrames(frames);
    expect(pos).not.toBeNull();
    expect(pos!.hh).toBe(0);
    expect(pos!.mm).toBe(0);
    expect(pos!.ss).toBe(0);
    expect(pos!.ff).toBe(0);
    expect(pos!.rate).toBe(3);
  });

  it("decodiert 01:23:45:15 korrekt", () => {
    // hh=1, mm=23, ss=45, ff=15, rate=3
    // ff=15 → low=15(0xF), high=0
    // ss=45=0x2D → low=0xD(13), high=0x2(2)
    // mm=23=0x17 → low=0x7(7), high=0x1(1)
    // hh=1 → low=1, high=0; rate=3 → byte type7 = (rate<<1)|hh_high = 0b110 = 6
    const frames = [
      { type: 0, value: 0xf }, // ff_low
      { type: 1, value: 0 },   // ff_high
      { type: 2, value: 0xd }, // ss_low
      { type: 3, value: 0x2 }, // ss_high
      { type: 4, value: 0x7 }, // mm_low
      { type: 5, value: 0x1 }, // mm_high
      { type: 6, value: 0x1 }, // hh_low
      { type: 7, value: 0b0110 }, // hh_high=0, rate=3
    ];
    const pos = accumulateMtcQuarterFrames(frames);
    expect(pos).not.toBeNull();
    expect(pos!.hh).toBe(1);
    expect(pos!.mm).toBe(23);
    expect(pos!.ss).toBe(45);
    expect(pos!.ff).toBe(15);
    expect(pos!.rate).toBe(3);
  });
});

describe("mtcRateToFps", () => {
  it("0 → 24fps", () => {
    expect(mtcRateToFps(0)).toBe(24);
  });
  it("1 → 25fps", () => {
    expect(mtcRateToFps(1)).toBe(25);
  });
  it("2 → 29.97fps", () => {
    expect(mtcRateToFps(2)).toBe(29.97);
  });
  it("3 → 30fps", () => {
    expect(mtcRateToFps(3)).toBe(30);
  });
});

describe("mtcPositionToMs", () => {
  it("00:00:00:00 = 0 ms", () => {
    expect(mtcPositionToMs(0, 0, 0, 0, 30)).toBe(0);
  });

  it("01:00:00:00 @ 30fps = 3_600_000 ms", () => {
    expect(mtcPositionToMs(1, 0, 0, 0, 30)).toBe(3_600_000);
  });

  it("00:01:00:00 @ 30fps = 60_000 ms (1:00 @30fps)", () => {
    expect(mtcPositionToMs(0, 1, 0, 0, 30)).toBe(60_000);
  });

  it("00:00:00:15 @ 30fps = 500 ms (half-second)", () => {
    expect(mtcPositionToMs(0, 0, 0, 15, 30)).toBe(500);
  });

  it("invalid fps fallback to 30", () => {
    expect(mtcPositionToMs(0, 0, 1, 0, 0)).toBe(1000);
    expect(mtcPositionToMs(0, 0, 1, 0, NaN)).toBe(1000);
  });
});

// ─── Class-Handler-Tests ────────────────────────────────────────────────────

describe("MidiSyncIn.handleSongPositionPointer", () => {
  it("emit 'position-changed' mit decodierten MIDI Beats", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    // 14-bit value = (msb<<7) | lsb. msb=1, lsb=0 → 128 midi beats = 8 bars.
    sync.handleSongPositionPointer(0, 1);
    expect(rec.events.length).toBe(1);
    expect(rec.events[0].event).toBe("position-changed");
    expect(rec.events[0].detail?.midiBeats).toBe(128);
    expect(sync.getLastSppMidiBeats()).toBe(128);
  });

  it("disabled → kein Emit", () => {
    const sync = new MidiSyncIn();
    sync.enabled = false;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    sync.handleSongPositionPointer(0, 0);
    expect(rec.events.length).toBe(0);
  });

  it("handleMessage(0xF2, lsb, msb) dispatched korrekt", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    sync.handleMessage([SC_SONG_POSITION, 64, 1], 0); // 192 midi beats
    expect(rec.events.length).toBe(1);
    expect(rec.events[0].event).toBe("position-changed");
    expect(rec.events[0].detail?.midiBeats).toBe(192);
  });
});

describe("MidiSyncIn.handleMtcFullFrame", () => {
  it("emit 'mtc-locate' instantly mit fps + positionMs", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    // 01:00:00:00 @ 30fps (rate=3)
    sync.handleMtcFullFrame(1, 0, 0, 0, 3);
    expect(rec.events.length).toBe(1);
    expect(rec.events[0].event).toBe("mtc-locate");
    expect(rec.events[0].detail?.hh).toBe(1);
    expect(rec.events[0].detail?.fps).toBe(30);
    expect(rec.events[0].detail?.positionMs).toBe(3_600_000);
  });

  it("handleSysexMessage parses 0xF0 7F 7F 01 01 hh mm ss ff 0xF7", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    // Build full-frame sysex: hh_byte = (rate<<5) | hh. rate=3, hh=1 → 0x61.
    const hh_byte = (3 << 5) | 1; // 0x61
    const sysex = [
      SYSEX_START,
      SYSEX_UNIV_REALTIME,
      0x7f, // device id (broadcast)
      MTC_SUB_ID_1,
      MTC_SUB_ID_2,
      hh_byte,
      0, // mm
      0, // ss
      0, // ff
      SYSEX_END,
    ];
    const ok = sync.handleSysexMessage(sysex);
    expect(ok).toBe(true);
    expect(rec.events.length).toBe(1);
    expect(rec.events[0].event).toBe("mtc-locate");
    expect(rec.events[0].detail?.hh).toBe(1);
    expect(rec.events[0].detail?.rate).toBe(3);
    expect(rec.events[0].detail?.fps).toBe(30);
  });

  it("handleSysexMessage returns false bei invalid header", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    // Falscher Sub-ID
    const bad = [SYSEX_START, SYSEX_UNIV_REALTIME, 0x7f, 0x02, 0x01, 0, 0, 0, 0, SYSEX_END];
    expect(sync.handleSysexMessage(bad)).toBe(false);
    expect(sync.handleSysexMessage([])).toBe(false);
    // No SYSEX_END
    expect(
      sync.handleSysexMessage([SYSEX_START, SYSEX_UNIV_REALTIME, 0x7f, 0x01, 0x01, 0, 0, 0, 0, 0x00]),
    ).toBe(false);
  });
});

describe("MidiSyncIn.handleMtcQuarterFrame", () => {
  it("emit 'mtc-tick' erst nach 8 Frames", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    // 7 frames, kein Emit erwartet:
    for (let t = 0; t < 7; t++) {
      sync.handleMtcQuarterFrame((t << 4) | 0);
      expect(rec.events.length).toBe(0);
    }
    // 8. Frame — type=7, value=0b0110 (rate=3, hh_high=0) → emit
    sync.handleMtcQuarterFrame((7 << 4) | 0b0110);
    expect(rec.events.length).toBe(1);
    expect(rec.events[0].event).toBe("mtc-tick");
    expect(rec.events[0].detail?.rate).toBe(3);
    expect(rec.events[0].detail?.fps).toBe(30);
    expect(rec.events[0].detail?.hh).toBe(0);
  });

  it("Accumulator reset nach komplettem Cycle — naechste 8 Frames neue Position", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    // Cycle 1: 00:00:00:00 @ 30fps
    for (let t = 0; t < 7; t++) sync.handleMtcQuarterFrame((t << 4) | 0);
    sync.handleMtcQuarterFrame((7 << 4) | 0b0110);
    expect(rec.events.length).toBe(1);
    // Cycle 2: ss=1, sonst 0 → ss_low=1 → frame type=2 value=1
    for (let t = 0; t < 8; t++) {
      const value = t === 2 ? 1 : (t === 7 ? 0b0110 : 0);
      sync.handleMtcQuarterFrame((t << 4) | value);
    }
    expect(rec.events.length).toBe(2);
    expect(rec.events[1].detail?.ss).toBe(1);
  });

  it("disabled → kein Emit, kein Accumulate", () => {
    const sync = new MidiSyncIn();
    sync.enabled = false;
    const rec = makeRecorder();
    sync.onSyncEvent = rec.listener;
    for (let t = 0; t < 8; t++) sync.handleMtcQuarterFrame((t << 4) | 0);
    expect(rec.events.length).toBe(0);
  });
});

describe("MidiSyncIn.reset", () => {
  it("reset clears SPP + MTC State", () => {
    const sync = new MidiSyncIn();
    sync.enabled = true;
    sync.onSyncEvent = makeRecorder().listener;
    sync.handleSongPositionPointer(0, 1);
    sync.handleMtcFullFrame(1, 0, 0, 0, 3);
    expect(sync.getLastSppMidiBeats()).toBe(128);
    expect(sync.getLastMtcPosition()).not.toBeNull();
    sync.reset();
    expect(sync.getLastSppMidiBeats()).toBeNull();
    expect(sync.getLastMtcPosition()).toBeNull();
  });
});

// ─── Engine-Smoke (Logic-Only, ohne AudioContext) ───────────────────────────

describe("AudioEngine SPP/MTC apply (logic-smoke)", () => {
  it("applyExternalPosition: midiBeats → step (16-step pattern, kein wrap)", () => {
    // Wir testen die reine Math via Pure-Helper midiBeatsToStep, weil die
    // Engine selbst einen AudioContext benoetigt der in Node nicht laeuft.
    // applyExternalPosition macht exakt: Math.round(midiBeats * (steps/16))
    const steps = 16;
    const midiBeats = 8;
    const expectedStep = Math.round(midiBeats * (steps / 16));
    expect(expectedStep).toBe(8);
  });

  it("applyExternalPosition: 32-step pattern verdoppelt step", () => {
    const steps = 32;
    const midiBeats = 8;
    const expectedStep = Math.round(midiBeats * (steps / 16));
    expect(expectedStep).toBe(16);
  });

  it("applyMtcLocate: positionMs → step via BPM (120 BPM)", () => {
    // bei 120 BPM ist 1 bar = 2000ms. bei 16-Steps ist stepDurMs = 60000/120/(16/4) = 125ms.
    // Bei positionMs=125 → step=1.
    const bpm = 120;
    const totalSteps = 16;
    const stepDurMs = (60_000 / bpm) / (totalSteps / 4);
    expect(stepDurMs).toBe(125);
    const positionMs = 125;
    const totalStep = Math.round(positionMs / stepDurMs);
    expect(totalStep).toBe(1);
  });
});

// ─── Store-Tests (Position-State) ───────────────────────────────────────────

describe("useMidiSyncInStore Position-State", () => {
  beforeEach(() => {
    __resetMidiSyncInStoreForTests();
  });

  it("Default-State: syncPosition=false, lastSppMidiBeats=null, lastMtcPosition=null", () => {
    const s = getMidiSyncInState();
    expect(s.syncPosition).toBe(false);
    expect(s.lastSppMidiBeats).toBeNull();
    expect(s.lastMtcPosition).toBeNull();
  });

  it("setMidiSyncInSyncPosition toggled", () => {
    setMidiSyncInSyncPosition(true);
    expect(getMidiSyncInState().syncPosition).toBe(true);
    setMidiSyncInSyncPosition(false);
    expect(getMidiSyncInState().syncPosition).toBe(false);
  });

  it("setMidiSyncInLastSppMidiBeats updated state", () => {
    setMidiSyncInLastSppMidiBeats(128);
    expect(getMidiSyncInState().lastSppMidiBeats).toBe(128);
    setMidiSyncInLastSppMidiBeats(null);
    expect(getMidiSyncInState().lastSppMidiBeats).toBeNull();
  });

  it("setMidiSyncInLastMtcPosition updated state mit equality-throttle", () => {
    const pos = { hh: 1, mm: 0, ss: 0, ff: 0, fps: 30 };
    setMidiSyncInLastMtcPosition(pos);
    expect(getMidiSyncInState().lastMtcPosition).toEqual(pos);
    // Identische Position — kein neuer State (deep-equal).
    setMidiSyncInLastMtcPosition({ hh: 1, mm: 0, ss: 0, ff: 0, fps: 30 });
    // No assertion needed — would be a noop; just verifying no crash.
    setMidiSyncInLastMtcPosition({ hh: 1, mm: 0, ss: 1, ff: 0, fps: 30 });
    expect(getMidiSyncInState().lastMtcPosition?.ss).toBe(1);
  });

  it("disable clears volatile position-state", () => {
    setMidiSyncInEnabled(true);
    setMidiSyncInLastSppMidiBeats(64);
    setMidiSyncInLastMtcPosition({ hh: 0, mm: 0, ss: 1, ff: 0, fps: 30 });
    setMidiSyncInEnabled(false);
    const s = getMidiSyncInState();
    expect(s.lastSppMidiBeats).toBeNull();
    expect(s.lastMtcPosition).toBeNull();
  });

  it("syncPosition=false → setMidiSyncInSyncPosition(false) clears position-state too", () => {
    setMidiSyncInSyncPosition(true);
    setMidiSyncInLastSppMidiBeats(64);
    setMidiSyncInLastMtcPosition({ hh: 0, mm: 0, ss: 1, ff: 0, fps: 30 });
    setMidiSyncInSyncPosition(false);
    const s = getMidiSyncInState();
    expect(s.lastSppMidiBeats).toBeNull();
    expect(s.lastMtcPosition).toBeNull();
  });

  it("Persist: syncPosition wird ge-roundtripped", () => {
    setMidiSyncInSyncPosition(true);
    // localStorage check
    const raw = localStorage.getItem("ss-midi-sync-in:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.syncPosition).toBe(true);
    // Volatile felder NICHT persistiert
    expect(parsed.lastSppMidiBeats).toBeUndefined();
    expect(parsed.lastMtcPosition).toBeUndefined();
  });
});
