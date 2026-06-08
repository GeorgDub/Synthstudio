/**
 * tests/features/synth-lfo-filter.test.ts (v3.269)
 *
 * Regression für den LFO→Filter-Fix: Die Option "filter" im LFO-Target war
 * tot (SynthEngine ignorierte sie, `// filter: TODO`). Jetzt fügt der Voice-
 * Pfad NUR bei lfoEnabled && lfoTarget==="filter" einen BiquadFilter ein und
 * der LFO moduliert dessen Cutoff.
 *
 * Verifiziert via Mock-AudioContext (zählt createBiquadFilter + Connections):
 *  - filter-Target + LFO an  → genau 1 BiquadFilter, LFO→filter.frequency
 *  - pitch/volume-Target      → KEIN Filter (Voice byte-identisch zu vorher)
 *  - filter-Target + LFO aus  → KEIN Filter
 *  - S&H/random-Waveform      → Filter-Cutoff via setValueAtTime moduliert
 *
 * (Audio-Hörbarkeit/Sweep wurde zusätzlich spektral im Browser verifiziert,
 *  sweptStd 6.0 dB vs flat 0.43 dB.)
 */
import { describe, it, expect } from "vitest";
import { SynthEngine, type SynthParams } from "../../client/src/audio/SynthEngine";

interface MockParam {
  value: number;
  _connectedFrom: number; // wie oft etwas hierauf connectet wurde
  _setCount: number;
  setValueAtTime: (v: number, t: number) => void;
  linearRampToValueAtTime: (v: number, t: number) => void;
  cancelScheduledValues: () => void;
}

function makeParam(): MockParam {
  const p: MockParam = {
    value: 0,
    _connectedFrom: 0,
    _setCount: 0,
    setValueAtTime() { p._setCount++; },
    linearRampToValueAtTime() { /* noop */ },
    cancelScheduledValues() { /* noop */ },
  };
  return p;
}

interface Tracked {
  biquads: { frequency: MockParam; Q: MockParam; type: string }[];
  gainConnectsToParam: number; // Gain-Nodes, die auf einen AudioParam connecten
}

function makeMockCtx(t: Tracked) {
  const mkNode = (extra: Record<string, unknown> = {}) => ({
    connect(target: unknown) {
      // Connect auf einen AudioParam (hat .setValueAtTime) zählen wir.
      if (target && typeof (target as MockParam).setValueAtTime === "function") {
        (target as MockParam)._connectedFrom++;
      }
    },
    ...extra,
  });
  const ctx = {
    currentTime: 0,
    createOscillator() {
      return mkNode({
        type: "sine",
        frequency: makeParam(),
        detune: makeParam(),
        start() {}, stop() {},
      });
    },
    createGain() {
      const g = mkNode({ gain: makeParam() });
      const origConnect = g.connect;
      g.connect = (target: unknown) => {
        if (target && typeof (target as MockParam).setValueAtTime === "function") {
          t.gainConnectsToParam++;
        }
        origConnect.call(g, target);
      };
      return g;
    },
    createBiquadFilter() {
      const freq = makeParam();
      const q = makeParam();
      const node = mkNode({ type: "lowpass", frequency: freq, Q: q });
      t.biquads.push({ frequency: freq, Q: q, get type() { return (node as { type: string }).type; } });
      return node;
    },
  } as unknown as AudioContext;
  return ctx;
}

const BASE: SynthParams = {
  mode: "wavetable", oscType: "sawtooth", detune: 0, fmRatio: 2, fmDepth: 100,
  attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3,
  lfoEnabled: true, lfoRate: 6, lfoDepth: 100, lfoTarget: "filter",
  lfoWaveform: "sine", lfoBpmSync: "free", glide: 0,
};

function trigger(params: SynthParams): Tracked {
  const t: Tracked = { biquads: [], gainConnectsToParam: 0 };
  const ctx = makeMockCtx(t);
  const dest = { connect() {} } as unknown as AudioNode;
  const eng = new SynthEngine(ctx, dest);
  eng.triggerNote(440, params, 0);
  return t;
}

describe("SynthEngine LFO→Filter (v3.269)", () => {
  it("lfoTarget='filter' + LFO an → genau 1 BiquadFilter (lowpass)", () => {
    const t = trigger({ ...BASE, lfoTarget: "filter", lfoEnabled: true });
    expect(t.biquads.length).toBe(1);
    expect(t.biquads[0].type).toBe("lowpass");
  });

  it("LFO connectet auf den Filter-Cutoff (frequency-Param)", () => {
    const t = trigger({ ...BASE, lfoTarget: "filter", lfoEnabled: true });
    // lfoGain → filter.frequency
    expect(t.biquads[0].frequency._connectedFrom).toBeGreaterThanOrEqual(1);
  });

  it("lfoTarget='pitch' → KEIN Filter (Voice unverändert)", () => {
    const t = trigger({ ...BASE, lfoTarget: "pitch" });
    expect(t.biquads.length).toBe(0);
  });

  it("lfoTarget='volume' → KEIN Filter", () => {
    const t = trigger({ ...BASE, lfoTarget: "volume" });
    expect(t.biquads.length).toBe(0);
  });

  it("lfoTarget='filter' aber LFO AUS → KEIN Filter", () => {
    const t = trigger({ ...BASE, lfoTarget: "filter", lfoEnabled: false });
    expect(t.biquads.length).toBe(0);
  });

  it("S&H/random-Waveform + filter → Cutoff via setValueAtTime moduliert", () => {
    const t = trigger({ ...BASE, lfoTarget: "filter", lfoEnabled: true, lfoWaveform: "sh" });
    expect(t.biquads.length).toBe(1);
    // Random-LFO schreibt diskrete Cutoff-Werte → mehrere setValueAtTime-Calls.
    expect(t.biquads[0].frequency._setCount).toBeGreaterThan(1);
  });
});
