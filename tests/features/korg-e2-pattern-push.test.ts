import { describe, it, expect, beforeEach } from "vitest";
import {
  synthstudioPatternToE2,
  synthstudioPatternToBody,
  parseSampleIdFromName,
} from "../../client/src/utils/korg/synthstudioToE2Pattern";
import { e2PatternToSynthstudio } from "../../client/src/utils/korg/e2PatternToSynthstudio";
import { decodePatternBody } from "../../client/src/utils/korg/e2Sysex";
import type { PatternData } from "../../client/src/audio/AudioEngine";
import { DEFAULT_CHANNEL_FX } from "../../client/src/audio/AudioEngine";
import {
  connectE2sDevice,
  pushE2sCurrentBody,
  pushE2sBody,
  getE2sDeviceState,
  __resetE2sDeviceForTests,
} from "../../client/src/store/useE2sDeviceStore";
import { E2Func, E2Model } from "../../client/src/utils/korg/e2Sysex";

function part(name: string, over: Partial<PatternData["parts"][number]> = {}) {
  return {
    id: name,
    name,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps: [],
    fx: { ...DEFAULT_CHANNEL_FX },
    ...over,
  };
}
function pattern(over: Partial<PatternData> = {}): PatternData {
  return {
    id: "p",
    name: "P",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: 120,
    parts: [],
    ...over,
  };
}

describe("parseSampleIdFromName", () => {
  it("extracts a #NNN sample number, else undefined", () => {
    expect(parseSampleIdFromName("P3 · #501")).toBe(501);
    expect(parseSampleIdFromName("Kick")).toBeUndefined();
    expect(parseSampleIdFromName(undefined)).toBeUndefined();
  });
});

describe("synthstudioPatternToE2", () => {
  it("maps name/bpm/stepCount and clamps to 16 parts (happy path)", () => {
    const p = synthstudioPatternToE2(
      pattern({
        name: "PUSHME",
        bpm: 140,
        stepCount: 32,
        parts: Array.from({ length: 20 }, (_, i) => part(`P${i}`)),
      })
    );
    expect(p.name).toBe("PUSHME");
    expect(p.bpm).toBe(140);
    expect(p.stepLength).toBe(32);
    expect(p.parts).toHaveLength(16);
  });

  it("maps volume/pan/steps and parses sampleId (edge cases)", () => {
    const p = synthstudioPatternToE2(
      pattern({
        parts: [
          part("Lead · #777", {
            volume: 0.5,
            pan: -1,
            steps: [{ active: true, velocity: 90, pitch: 5 }],
          }),
        ],
      })
    );
    const e0 = p.parts[0];
    expect(e0.sampleId).toBe(777);
    expect(e0.volume).toBe(Math.round(0.5 * 127)); // 64
    expect(e0.pan).toBe(0); // -1 → hard left
    expect(e0.steps[0]).toMatchObject({
      active: true,
      velocity: 90,
      note: 0x48 + 5,
    });
  });

  it("uses an explicit bpm override and a 120 fallback", () => {
    expect(
      synthstudioPatternToE2(pattern({ bpm: null }), { bpm: 90 }).bpm
    ).toBe(90);
    expect(synthstudioPatternToE2(pattern({ bpm: null })).bpm).toBe(120);
  });
});

describe("round-trip: SynthStudio → E2 body → decode → import", () => {
  it("preserves name, step-count, active steps + velocity", () => {
    const src = pattern({
      name: "ROUND",
      bpm: 128,
      stepCount: 16,
      parts: [
        part("Drum · #501", {
          volume: 1,
          steps: [
            { active: true, velocity: 100, pitch: 0 },
            { active: false, velocity: 100, pitch: 0 },
            { active: true, velocity: 64, pitch: 0 },
          ],
        }),
      ],
    });
    const body = synthstudioPatternToBody(src);
    expect(body.length).toBe(0x4000);

    const back = e2PatternToSynthstudio(decodePatternBody(body));
    expect(back.name).toBe("ROUND");
    expect(back.stepCount).toBe(16);
    expect(back.bpm).toBeCloseTo(128, 1);
    const p0 = back.parts[0];
    expect(p0.name).toContain("#501");
    expect(p0.steps[0]).toMatchObject({ active: true, velocity: 100 });
    expect(p0.steps[1].active).toBe(false);
    expect(p0.steps[2]).toMatchObject({ active: true, velocity: 64 });
  });

  // v3.297: Der User-Report "die steps sind zwar richtig aber die vol und
  // sonstige Werte passen noch nicht" kam von falschen Part-Offsets (Volume war
  // 0x15=EG-Decay, Pan 0x22=IFX-Edit). Dieser Test sichert, dass die per SysEx
  // gepushten Werte an den KORREKTEN Offsets (Amp Level 0x18 / Amp Pan 0x19)
  // landen und beim Zurücklesen unverändert dekodiert werden.
  it("preserves per-part volume + pan through the SysEx body (0x18/0x19)", () => {
    const src = pattern({
      stepCount: 16,
      parts: [
        part("Loud L", { volume: 1, pan: -1, steps: [{ active: true, velocity: 100, pitch: 0 }] }),
        part("Half C", { volume: 0.5, pan: 0, steps: [{ active: true, velocity: 100, pitch: 0 }] }),
        part("Quiet R", { volume: 0, pan: 1, steps: [{ active: true, velocity: 100, pitch: 0 }] }),
      ],
    });
    const decoded = decodePatternBody(synthstudioPatternToBody(src));

    // Volume: 0..1 → 0..127 (device Amp Level @0x18).
    expect(decoded.parts[0].volume).toBe(127);
    expect(decoded.parts[1].volume).toBe(Math.round(0.5 * 127)); // 64
    expect(decoded.parts[2].volume).toBe(0);

    // Pan: −1/0/+1 → UI 1/64/127 (device Amp Pan @0x19, i8 0=center). Hard-left
    // UI 0 → Gerät -63 (kein -64 darstellbar) → zurück UI 1 (±63-Clamp, siehe
    // e2-layout.test.ts). Center + hard-right sind verlustfrei.
    expect(decoded.parts[0].pan).toBe(1); // hard left (±63-Clamp)
    expect(decoded.parts[1].pan).toBe(64); // center
    expect(decoded.parts[2].pan).toBe(127); // hard right
  });
});

// ─── Store push via a fake device that ACKs writes ────────────────────────────
function fakeAccept() {
  const input: {
    name: string;
    onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  } = {
    name: "Electribe 2",
    onmidimessage: null,
  };
  const sentFuncs: number[] = [];
  const output = {
    name: "Electribe 2",
    send(bytes: number[]) {
      const f = Uint8Array.from(bytes);
      if (f[2] === 0x50) {
        queueMicrotask(() =>
          input.onmidimessage?.({
            data: Uint8Array.from([
              0xf0,
              0x42,
              0x50,
              0x01,
              0,
              0,
              E2Model.SAMPLER,
              0,
              0,
              0,
              2,
              2,
              0xf7,
            ]),
          })
        );
        return;
      }
      sentFuncs.push(f[6]);
      queueMicrotask(() =>
        input.onmidimessage?.({
          data: Uint8Array.from([
            0xf0,
            0x42,
            0x30,
            0x00,
            0x01,
            0x24,
            E2Func.ACK,
            0xf7,
          ]),
        })
      );
    },
  };
  const access = {
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output]]),
  } as unknown as MIDIAccess;
  return { access, sentFuncs };
}

describe("store push actions", () => {
  beforeEach(() => __resetE2sDeviceForTests());

  it("pushes a body to the edit-buffer and resolves on ACK", async () => {
    const { access, sentFuncs } = fakeAccept();
    await connectE2sDevice(access);
    const ok = await pushE2sCurrentBody(synthstudioPatternToBody(pattern()));
    expect(ok).toBe(true);
    expect(sentFuncs).toContain(E2Func.CURRENT_PATTERN_DUMP);
    expect(getE2sDeviceState().error).toBeNull();
  });

  it("pushes a body to a numbered slot", async () => {
    const { access, sentFuncs } = fakeAccept();
    await connectE2sDevice(access);
    const ok = await pushE2sBody(42, synthstudioPatternToBody(pattern()));
    expect(ok).toBe(true);
    expect(sentFuncs).toContain(E2Func.PATTERN_DUMP);
  });

  it("fails cleanly when not connected", async () => {
    const ok = await pushE2sCurrentBody(new Uint8Array(0x4000));
    expect(ok).toBe(false);
    expect(getE2sDeviceState().error).toMatch(/Kein Gerät/);
  });
});
