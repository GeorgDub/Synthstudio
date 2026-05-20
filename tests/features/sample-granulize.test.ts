// @vitest-environment node
/**
 * sample-granulize.test.ts - v3.217.0
 *
 * Tests fuer sampleGranulize Pure-Helper (Granular-Synthesis auf Sample-Ebene).
 *
 * Sample-Rate-Trick: viele Tests nutzen sampleRate=1000 oder 2000 damit
 * (grainSizeMs * sampleRate / 1000) auf integer-Werte faellt
 * (z.B. sr=1000, grainSizeMs=10 -> 10 samples; sr=2000, grainSizeMs=5 -> 10 samples).
 */

import { describe, it, expect } from "vitest";
import {
  applyGranulize,
  GRANULIZE_PRESETS,
} from "../../client/src/utils/sampleGranulize";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeBuffer(samples: number[], sampleRate = 48000): AudioBufferLike {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => data,
  };
}

function makeStereoBuffer(
  left: number[],
  right: number[],
  sampleRate = 48000,
): AudioBufferLike {
  const L = new Float32Array(left);
  const R = new Float32Array(right);
  const len = Math.max(left.length, right.length);
  return {
    sampleRate,
    numberOfChannels: 2,
    length: len,
    getChannelData: (c: number) => (c === 0 ? L : R),
  };
}

function makeEmptyBuffer(sampleRate = 48000): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function makeRamp(len: number, sampleRate = 1000): AudioBufferLike {
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = (i + 1) / len; // 1/len..1 (no zeros)
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

function makeConstantBuffer(value: number, len: number, sampleRate = 1000): AudioBufferLike {
  const data = new Float32Array(len);
  data.fill(value);
  return {
    sampleRate,
    numberOfChannels: 1,
    length: len,
    getChannelData: () => data,
  };
}

describe("v3.217 applyGranulize - empty + degenerate", () => {
  it("empty buffer ergibt empty output mit fallback sampleRate=48000", () => {
    const out = applyGranulize(makeEmptyBuffer());
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
    expect(out.sampleRate).toBe(48000);
  });

  it("empty buffer behaelt eigenen sampleRate (44100)", () => {
    const out = applyGranulize(makeEmptyBuffer(44100), {
      grainSizeMs: 50,
      grainCount: 4,
    });
    expect(out.sampleRate).toBe(44100);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });

  it("zero-length buffer mit Mono-Channel-Pseudo: numberOfChannels=0 -> empty", () => {
    const buf: AudioBufferLike = {
      sampleRate: 48000,
      numberOfChannels: 0,
      length: 100,
      getChannelData: () => new Float32Array(0),
    };
    const out = applyGranulize(buf);
    expect(out.length).toBe(0);
    expect(out.numberOfChannels).toBe(0);
  });
});

describe("v3.217 applyGranulize - output length", () => {
  it("Output-Laenge = grainCount * grainSamples (Length-Override)", () => {
    // sr=1000, grainSizeMs=10 -> grainSamples=10. grainCount=5 -> outLen=50.
    const buf = makeRamp(100, 1000);
    const out = applyGranulize(buf, { grainSizeMs: 10, grainCount: 5 });
    expect(out.length).toBe(50);
    expect(buf.length).toBe(100); // input unveraendert
  });

  it("grainCount=1 -> output length = grainSamples", () => {
    // sr=1000, grainSizeMs=20 -> grainSamples=20.
    const buf = makeRamp(100, 1000);
    const out = applyGranulize(buf, { grainSizeMs: 20, grainCount: 1 });
    expect(out.length).toBe(20);
  });

  it("grainCount=64, grainSizeMs=50 @ sr=1000 -> output length = 64*50=3200", () => {
    const buf = makeRamp(200, 1000);
    const out = applyGranulize(buf, { grainSizeMs: 50, grainCount: 64 });
    expect(out.length).toBe(3200);
  });

  it("Output-SampleRate identisch zu Input", () => {
    const buf = makeRamp(100, 22050);
    const out = applyGranulize(buf, { grainSizeMs: 10, grainCount: 4 });
    expect(out.sampleRate).toBe(22050);
  });
});

describe("v3.217 applyGranulize - determinism (PRNG)", () => {
  it("same seed + same input -> deep-equal output", () => {
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 8,
      randomSeed: 42,
      spread: 1,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 8,
      randomSeed: 42,
      spread: 1,
    });
    expect(a.length).toBe(b.length);
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    for (let i = 0; i < aData.length; i++) {
      expect(aData[i]).toBe(bData[i]);
    }
  });

  it("different seeds with spread=1 -> different output", () => {
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 8,
      randomSeed: 1,
      spread: 1,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 8,
      randomSeed: 99,
      spread: 1,
    });
    // mindestens ein Sample muss sich unterscheiden
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    let diff = false;
    for (let i = 0; i < aData.length; i++) {
      if (aData[i] !== bData[i]) {
        diff = true;
        break;
      }
    }
    expect(diff).toBe(true);
  });

  it("same seed + spread=0 -> output ist deterministisch und identisch zu anderem seed (random irrelevant)", () => {
    // bei spread=0 wird randomPos ignoriert -> output haengt nur von source ab
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      randomSeed: 1,
      spread: 0,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      randomSeed: 999999,
      spread: 0,
    });
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    for (let i = 0; i < aData.length; i++) {
      expect(aData[i]).toBe(bData[i]);
    }
  });
});

describe("v3.217 applyGranulize - multi-channel", () => {
  it("Stereo (2 Channels) -> Output hat 2 Channels", () => {
    const buf = makeStereoBuffer(
      Array.from({ length: 100 }, (_, i) => (i + 1) / 100),
      Array.from({ length: 100 }, (_, i) => -(i + 1) / 100),
      1000,
    );
    const out = applyGranulize(buf, { grainSizeMs: 10, grainCount: 4 });
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(40);
  });

  it("Stereo-Coherence: gleiche Quell-Positionen pro Grain ueber alle Channels", () => {
    // Wenn Channel L bei Index i einen Wert > 0 hat, MUSS Channel R bei Index i
    // auch den entsprechenden Wert haben (gleiche Position aus Source).
    // Source: L mit 1.0, R mit 2.0 ueberall (konstant) - Output L wird 1*fade,
    // Output R wird 2*fade pro Sample. Ratio R/L muss 2.0 sein (modulo Hann-Fade).
    const buf = makeStereoBuffer(
      Array.from({ length: 100 }, () => 0.5),
      Array.from({ length: 100 }, () => 1.0),
      1000,
    );
    const out = applyGranulize(buf, {
      grainSizeMs: 20,
      grainCount: 4,
      randomSeed: 7,
      spread: 1,
    });
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    // Mittelposition jedes Grains soll Ratio 2.0 zwischen R und L erfuellen
    for (let i = 10; i < L.length; i += 20) {
      // an der Grain-Mitte sind L=0.5*g und R=1.0*g, ratio = 2.0
      if (Math.abs(L[i]) > 0.01) {
        expect(R[i] / L[i]).toBeCloseTo(2.0, 5);
      }
    }
  });
});

describe("v3.217 applyGranulize - spread semantics", () => {
  it("spread=0 -> sequential grain positions (i*grainSamples mod sourceSpan)", () => {
    // sr=1000, grainSizeMs=10 -> grainSamples=10. inLen=100 -> sourceSpan=91.
    // Mit spread=0 ist startSample = sequentialPos = (i*10) % 91.
    // Grain 0 startet bei 0, Grain 1 bei 10, Grain 2 bei 20, etc.
    // Bei konstantem Wert pro Grain-Position koennen wir das verifizieren.
    const buf = makeRamp(100, 1000); // ramp 0.01..1.0
    const out = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: 0,
      randomSeed: 999, // irrelevant bei spread=0
    });
    const o = out.getChannelData(0);
    // Mittelposition Grain 0 (i=5): startSample=0, source value ~ 0.06
    // Mittelposition Grain 1 (i=15): startSample=10, source value ~ 0.16
    // Mittelposition Grain 2 (i=25): startSample=20, source value ~ 0.26
    // Grain-Mitte (i=5 innerhalb des Grains) bekommt vollen Wert (fadeSamples = 10/4 = 2, fade-in bis Index 1).
    expect(o[5]).toBeCloseTo(buf.getChannelData(0)[5], 5);
    expect(o[15]).toBeCloseTo(buf.getChannelData(0)[15], 5);
    expect(o[25]).toBeCloseTo(buf.getChannelData(0)[25], 5);
    expect(o[35]).toBeCloseTo(buf.getChannelData(0)[35], 5);
  });

  it("spread=1 -> random positions (anders als sequentiell bei seed=7)", () => {
    // Bei spread=1 ist startSample = randomPos. Bei seed=7 sind die Positionen
    // nicht sequenziell - wir vergleichen mit spread=0 Ergebnis.
    const buf = makeRamp(200, 1000);
    const seqOut = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 8,
      spread: 0,
    });
    const randOut = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 8,
      spread: 1,
      randomSeed: 7,
    });
    expect(seqOut.length).toBe(randOut.length);
    let diff = false;
    const a = seqOut.getChannelData(0);
    const b = randOut.getChannelData(0);
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 1e-6) {
        diff = true;
        break;
      }
    }
    expect(diff).toBe(true);
  });

  it("spread=0.5 -> Interpolation zwischen sequentiell und random (deterministisch)", () => {
    // Vergleich: spread=0.5 erzeugt ein DRITTES Ergebnis, anders als 0 und 1.
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 6,
      spread: 0,
    });
    const c = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 6,
      spread: 0.5,
      randomSeed: 42,
    });
    const e = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 6,
      spread: 1,
      randomSeed: 42,
    });
    // c muss sich von a UND von e unterscheiden (modulo gluecks-Zufall)
    const dataA = a.getChannelData(0);
    const dataC = c.getChannelData(0);
    const dataE = e.getChannelData(0);
    let diffAC = false;
    let diffCE = false;
    for (let i = 0; i < dataA.length; i++) {
      if (Math.abs(dataA[i] - dataC[i]) > 1e-6) diffAC = true;
      if (Math.abs(dataC[i] - dataE[i]) > 1e-6) diffCE = true;
    }
    expect(diffAC).toBe(true);
    expect(diffCE).toBe(true);
  });
});

describe("v3.217 applyGranulize - sanitizers", () => {
  it("grainSizeMs NaN -> Default 50ms", () => {
    const buf = makeRamp(2000, 1000);
    // Default 50ms @ sr=1000 -> 50 samples. count=2 -> outLen=100.
    const outNaN = applyGranulize(buf, { grainSizeMs: NaN, grainCount: 2 });
    const outDefault = applyGranulize(buf, { grainSizeMs: 50, grainCount: 2 });
    expect(outNaN.length).toBe(100);
    expect(outNaN.length).toBe(outDefault.length);
  });

  it("grainSizeMs < 5 -> Default 50ms (NICHT clamp auf 5)", () => {
    const buf = makeRamp(2000, 1000);
    const outTiny = applyGranulize(buf, { grainSizeMs: 1, grainCount: 2 });
    const outDefault = applyGranulize(buf, { grainSizeMs: 50, grainCount: 2 });
    expect(outTiny.length).toBe(outDefault.length); // beide 100 = 50*2
  });

  it("grainSizeMs > 500 -> Clamp 500", () => {
    const buf = makeRamp(2000, 1000);
    // 500ms @ sr=1000 -> 500 samples. count=2 -> outLen=1000.
    const outBig = applyGranulize(buf, { grainSizeMs: 9999, grainCount: 2 });
    expect(outBig.length).toBe(1000);
  });

  it("grainCount NaN -> Default 32", () => {
    const buf = makeRamp(2000, 1000);
    // grainSizeMs=10ms @ sr=1000 -> 10 samples. Default count=32 -> outLen=320.
    const outNaN = applyGranulize(buf, { grainSizeMs: 10, grainCount: NaN });
    expect(outNaN.length).toBe(320);
  });

  it("grainCount < 1 -> Default 32", () => {
    const buf = makeRamp(2000, 1000);
    const outNeg = applyGranulize(buf, { grainSizeMs: 10, grainCount: -5 });
    expect(outNeg.length).toBe(320);
  });

  it("grainCount > 500 -> Clamp 500", () => {
    const buf = makeRamp(2000, 1000);
    // 10ms @ sr=1000 -> 10. 500 grains -> outLen=5000.
    const outBig = applyGranulize(buf, { grainSizeMs: 10, grainCount: 9999 });
    expect(outBig.length).toBe(5000);
  });

  it("grainCount non-integer -> floor", () => {
    const buf = makeRamp(2000, 1000);
    const outFractional = applyGranulize(buf, { grainSizeMs: 10, grainCount: 4.7 });
    // floor(4.7)=4, outLen=40
    expect(outFractional.length).toBe(40);
  });

  it("randomSeed NaN -> Default 12345 (deterministisch wie {seed:12345})", () => {
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      randomSeed: NaN,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      randomSeed: 12345,
    });
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    for (let i = 0; i < aData.length; i++) {
      expect(aData[i]).toBe(bData[i]);
    }
  });

  it("randomSeed < 0 -> Default 12345", () => {
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      randomSeed: -1,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      randomSeed: 12345,
    });
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    for (let i = 0; i < aData.length; i++) {
      expect(aData[i]).toBe(bData[i]);
    }
  });

  it("spread NaN -> 0 (sequentiell)", () => {
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: NaN,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: 0,
    });
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    for (let i = 0; i < aData.length; i++) {
      expect(aData[i]).toBe(bData[i]);
    }
  });

  it("spread < 0 -> 0", () => {
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: -0.5,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: 0,
    });
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    for (let i = 0; i < aData.length; i++) {
      expect(aData[i]).toBe(bData[i]);
    }
  });

  it("spread > 1 -> 1", () => {
    const buf = makeRamp(200, 1000);
    const a = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: 5,
      randomSeed: 42,
    });
    const b = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: 1,
      randomSeed: 42,
    });
    const aData = a.getChannelData(0);
    const bData = b.getChannelData(0);
    for (let i = 0; i < aData.length; i++) {
      expect(aData[i]).toBe(bData[i]);
    }
  });

  it("undefined opts -> alle Defaults werden angewendet", () => {
    const buf = makeRamp(2000, 1000);
    const out = applyGranulize(buf); // alle defaults: 50ms, 32 grains, seed 12345, spread 1
    // Default 50ms @ sr=1000 = 50 samples. count=32 -> outLen=1600.
    expect(out.length).toBe(1600);
  });
});

describe("v3.217 applyGranulize - presets", () => {
  it("GRANULIZE_PRESETS hat 4 vordefinierte Presets", () => {
    expect(Object.keys(GRANULIZE_PRESETS).sort()).toEqual([
      "cloud",
      "freeze",
      "rhythmic",
      "texture",
    ]);
  });

  it("cloud preset: spread=1, dichte Granulation", () => {
    const buf = makeRamp(500, 1000);
    const out = applyGranulize(buf, GRANULIZE_PRESETS.cloud);
    // 50ms @ sr=1000 -> 50 samples. count=64 -> outLen=3200.
    expect(out.length).toBe(3200);
    expect(GRANULIZE_PRESETS.cloud.spread).toBe(1);
  });

  it("rhythmic preset: spread=0.3, behaelt rhythmische Struktur", () => {
    const buf = makeRamp(500, 1000);
    const out = applyGranulize(buf, GRANULIZE_PRESETS.rhythmic);
    // 100ms @ sr=1000 -> 100 samples. count=16 -> outLen=1600.
    expect(out.length).toBe(1600);
    expect(GRANULIZE_PRESETS.rhythmic.spread).toBe(0.3);
  });

  it("texture preset: spread=0.8, feine Granulation", () => {
    const buf = makeRamp(500, 1000);
    const out = applyGranulize(buf, GRANULIZE_PRESETS.texture);
    // 20ms @ sr=1000 -> 20 samples. count=100 -> outLen=2000.
    expect(out.length).toBe(2000);
    expect(GRANULIZE_PRESETS.texture.spread).toBe(0.8);
  });

  it("freeze preset: spread=0.1, fast eingefroren", () => {
    const buf = makeRamp(500, 1000);
    const out = applyGranulize(buf, GRANULIZE_PRESETS.freeze);
    // 200ms @ sr=1000 -> 200 samples. count=8 -> outLen=1600.
    expect(out.length).toBe(1600);
    expect(GRANULIZE_PRESETS.freeze.spread).toBe(0.1);
  });
});

describe("v3.217 applyGranulize - silence-padding (source < grain size)", () => {
  it("source kuerzer als ein Grain -> Output gefuellt mit verfuegbaren Samples + Stille", () => {
    // sr=1000, grainSizeMs=50 -> grainSamples=50. Source nur 20 samples.
    // sourceSpan = max(1, 20-50+1) = 1 -> startSample muss 0 sein.
    // Grain 0 enthaelt source[0..20] + 30 Sample-Stille.
    const buf = makeConstantBuffer(0.5, 20, 1000);
    const out = applyGranulize(buf, {
      grainSizeMs: 50,
      grainCount: 2,
      spread: 0,
    });
    expect(out.length).toBe(100); // 50 * 2
    const o = out.getChannelData(0);
    // Mitte des ersten Grains (Index 25 von 50) ist hinter der Source - sollte 0 sein
    expect(o[25]).toBe(0);
    // Stelle innerhalb der Source-Reichweite (Index 10) sollte non-zero sein
    // (modulo Hann-Fade)
    expect(o[10]).toBeGreaterThan(0);
  });

  it("source-laenge == grainSize -> single startSample (=0) moeglich", () => {
    // sr=1000, grainSize=10, source=10 -> sourceSpan=1 -> alle Grains startSample=0.
    const buf = makeConstantBuffer(1.0, 10, 1000);
    const out = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: 1, // random egal weil sourceSpan=1
      randomSeed: 7,
    });
    expect(out.length).toBe(40);
    // Mitten der Grains (index 5, 15, 25, 35) sollten alle ~1 sein (volles fade=1).
    const o = out.getChannelData(0);
    expect(o[5]).toBeCloseTo(1.0, 3);
    expect(o[15]).toBeCloseTo(1.0, 3);
  });
});

describe("v3.217 applyGranulize - Hann fade-in/out", () => {
  it("Boundary-Samples eines Grains sind leiser als die Mitte (kein Klick)", () => {
    // Konstanter Input -> jeder Grain hat Mitte = const, Raender = const * fade
    const buf = makeConstantBuffer(1.0, 200, 1000);
    const out = applyGranulize(buf, {
      grainSizeMs: 20,
      grainCount: 4,
      spread: 0,
    });
    const o = out.getChannelData(0);
    // Grain-Boundary bei Index 0 (Start Grain 0)
    expect(o[0]).toBeLessThan(o[10]);
    // Grain-End: Index 19 (Ende Grain 0) - sollte leiser sein als Mitte
    expect(o[19]).toBeLessThan(o[10]);
    // Mitte hat ~1.0
    expect(o[10]).toBeCloseTo(1.0, 2);
  });

  it("Erstes Sample eines Grains hat positiven aber nicht-vollen Wert (fade-in)", () => {
    const buf = makeConstantBuffer(1.0, 200, 1000);
    const out = applyGranulize(buf, {
      grainSizeMs: 20,
      grainCount: 2,
      spread: 0,
    });
    const o = out.getChannelData(0);
    // grainSamples=20, fadeSamples=min(5,64)=5. Erstes Sample: t=(0+1)/(5+1)=1/6,
    // gain = 0.5*(1-cos(pi*1/6)) ~ 0.0670, kleiner Wert > 0.
    expect(o[0]).toBeGreaterThan(0);
    expect(o[0]).toBeLessThan(0.2);
  });

  it("Grain mit grainSamples <= 4 hat fadeSamples=0 (keine Fades) bei sehr kleinen Grains", () => {
    // sr=1000, grainSizeMs=3 -> wuerde 3 samples sein, aber sanitizer -> Default 50ms.
    // Stattdessen sr=200, grainSizeMs=10 -> grainSamples=2. floor(2/4)=0 -> keine Fades.
    const buf = makeConstantBuffer(1.0, 50, 200);
    const out = applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      spread: 0,
    });
    const o = out.getChannelData(0);
    expect(out.length).toBe(8); // 2*4
    // Alle samples sollten == 1 sein (keine Fade-Anwendung)
    for (let i = 0; i < o.length; i++) {
      expect(o[i]).toBe(1.0);
    }
  });
});

describe("v3.217 applyGranulize - purity (Input nicht mutiert)", () => {
  it("Input-Channel-Data wird nicht ueberschrieben", () => {
    const buf = makeRamp(100, 1000);
    const before = Array.from(buf.getChannelData(0));
    applyGranulize(buf, {
      grainSizeMs: 10,
      grainCount: 4,
      randomSeed: 42,
      spread: 1,
    });
    const after = Array.from(buf.getChannelData(0));
    expect(after).toEqual(before);
  });

  it("Stereo-Input: beide Channels werden nicht mutiert", () => {
    const buf = makeStereoBuffer(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8, -0.9, -1.0],
      1000,
    );
    const beforeL = Array.from(buf.getChannelData(0));
    const beforeR = Array.from(buf.getChannelData(1));
    applyGranulize(buf, { grainSizeMs: 5, grainCount: 4 });
    expect(Array.from(buf.getChannelData(0))).toEqual(beforeL);
    expect(Array.from(buf.getChannelData(1))).toEqual(beforeR);
  });

  it("Output ist ein anderes Objekt als Input", () => {
    const buf = makeRamp(100, 1000);
    const out = applyGranulize(buf, { grainSizeMs: 10, grainCount: 4 });
    expect(out).not.toBe(buf);
    expect(out.getChannelData(0)).not.toBe(buf.getChannelData(0));
  });
});
