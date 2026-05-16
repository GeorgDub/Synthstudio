/**
 * tests/features/mixer-fx.test.ts (TASK-CVG-MIXERFX / v2.61)
 *
 * Pure-Coverage für client/src/utils/mixerFx.ts (214 LOC).
 *
 * Mixer-FX-Helpers werden von 12 FX-Slot-Typen + 16-Band-EQ + Sidechain-
 * Math genutzt. Diese Suite garantiert clamp/normalize-Defensive an
 * Persistenz-Boundaries (Project-Files können beliebige out-of-range Werte
 * enthalten) und die Default-Param-Tabelle pro FX-Type.
 */
import { describe, it, expect } from "vitest";
import {
  MIXER_FX_TYPES,
  EQ16_FREQUENCIES,
  DEFAULT_SIDECHAIN,
  DEFAULT_TRANSIENT_SHAPER,
  clamp,
  clampUnit,
  clampDb,
  createDefaultEqBands,
  sanitizeEqBands,
  makeMixerFxSlot,
  defaultParamsForType,
  moveFxSlot,
  toggleFxSlot,
  removeFxSlot,
  summarizeEqBands,
  computeSidechainGain,
  normalizeSidechain,
  normalizeTransientShaper,
  type MixerFxSlot,
  type MixerFxType,
} from "@/utils/mixerFx";

describe("MixerFx – Konstanten", () => {
  it("MIXER_FX_TYPES enthält genau 12 FX-Typen", () => {
    expect(MIXER_FX_TYPES).toHaveLength(12);
  });

  it("EQ16_FREQUENCIES hat 16 Bänder, aufsteigend sortiert", () => {
    expect(EQ16_FREQUENCIES).toHaveLength(16);
    for (let i = 1; i < EQ16_FREQUENCIES.length; i++) {
      expect(EQ16_FREQUENCIES[i]).toBeGreaterThan(EQ16_FREQUENCIES[i - 1]);
    }
  });

  it("EQ16_FREQUENCIES decken den hörbaren Bereich [25 Hz, 16 kHz] ab", () => {
    expect(EQ16_FREQUENCIES[0]).toBe(25);
    expect(EQ16_FREQUENCIES[15]).toBe(16000);
  });
});

describe("MixerFx – clamp helpers", () => {
  it("clamp normal-Range bleibt", () => expect(clamp(5, 0, 10)).toBe(5));
  it("clamp unter min", () => expect(clamp(-3, 0, 10)).toBe(0));
  it("clamp über max", () => expect(clamp(99, 0, 10)).toBe(10));
  it("clamp NaN → min (Defensive)", () => expect(clamp(NaN, 0, 10)).toBe(0));
  it("clampUnit für 0.5 = 0.5", () => expect(clampUnit(0.5)).toBe(0.5));
  it("clampUnit über 1 → 1", () => expect(clampUnit(2)).toBe(1));
  it("clampUnit unter 0 → 0", () => expect(clampUnit(-0.5)).toBe(0));
  it("clampDb für 0 = 0", () => expect(clampDb(0)).toBe(0));
  it("clampDb über +24", () => expect(clampDb(30)).toBe(24));
  it("clampDb unter -24", () => expect(clampDb(-30)).toBe(-24));
});

describe("MixerFx – EQ-Bands", () => {
  it("createDefaultEqBands erzeugt 16 Bänder mit gain=0, q=1", () => {
    const bands = createDefaultEqBands();
    expect(bands).toHaveLength(16);
    for (const b of bands) {
      expect(b.gain).toBe(0);
      expect(b.q).toBe(1);
    }
  });

  it("createDefaultEqBands matched die EQ16_FREQUENCIES exakt", () => {
    const bands = createDefaultEqBands();
    bands.forEach((b, i) => expect(b.frequency).toBe(EQ16_FREQUENCIES[i]));
  });

  it("sanitizeEqBands(undefined) → 16 Default-Bänder", () => {
    const bands = sanitizeEqBands(undefined);
    expect(bands).toHaveLength(16);
  });

  it("sanitizeEqBands clampt out-of-range gain auf ±24 dB", () => {
    const result = sanitizeEqBands([{ gain: 100 }, { gain: -100 }]);
    expect(result[0].gain).toBe(24);
    expect(result[1].gain).toBe(-24);
  });

  it("sanitizeEqBands clampt q auf [0.1, 12]", () => {
    const result = sanitizeEqBands([{ q: 0 }, { q: 99 }]);
    expect(result[0].q).toBe(0.1);
    expect(result[1].q).toBe(12);
  });

  it("sanitizeEqBands clampt frequency auf [20, 20000]", () => {
    const result = sanitizeEqBands([{ frequency: 10 }, { frequency: 50000 }]);
    expect(result[0].frequency).toBe(20);
    expect(result[1].frequency).toBe(20000);
  });

  it("sanitizeEqBands füllt fehlende Bänder mit Defaults auf", () => {
    const result = sanitizeEqBands([{ gain: 6 }]);
    expect(result).toHaveLength(16);
    expect(result[0].gain).toBe(6);
    expect(result[5].gain).toBe(0); // Default für ungesetztes Band
  });
});

describe("MixerFx – summarizeEqBands (Low/Mid/High Durchschnitte)", () => {
  it("alle Bänder auf 0 → Summe 0/0/0", () => {
    const summary = summarizeEqBands(createDefaultEqBands());
    expect(summary).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("nur tieffrequente Bänder boosted → low > 0", () => {
    const bands = createDefaultEqBands().map((b, i) => ({ ...b, gain: i < 5 ? 6 : 0 }));
    const summary = summarizeEqBands(bands);
    expect(summary.low).toBe(6);
    expect(summary.mid).toBe(0);
    expect(summary.high).toBe(0);
  });

  it("clamping auf ±24 dB greift bei extremen Werten", () => {
    const bands = createDefaultEqBands().map(() => ({ frequency: 1000, gain: 100, q: 1 }));
    const summary = summarizeEqBands(bands);
    // sanitizeEqBands clampt schon — max-summary ist 24
    expect(summary.low).toBe(24);
    expect(summary.high).toBe(24);
  });
});

describe("MixerFx – makeMixerFxSlot + defaultParamsForType", () => {
  it("erzeugt für jeden FX-Type einen validen Slot mit enabled=true", () => {
    for (const type of MIXER_FX_TYPES) {
      const slot = makeMixerFxSlot(type as MixerFxType, "fixed-id");
      expect(slot.type).toBe(type);
      expect(slot.enabled).toBe(true);
      expect(slot.id).toBe("fixed-id");
      expect(slot.params).toBeDefined();
      expect(slot.name).toBeTruthy();
    }
  });

  it("compressor hat threshold + ratio + attack + release", () => {
    const params = defaultParamsForType("compressor");
    expect(params.threshold).toBe(-24);
    expect(params.ratio).toBe(4);
  });

  it("filter hat type='lowpass' + frequency + q", () => {
    const params = defaultParamsForType("filter");
    expect(params.type).toBe("lowpass");
    expect(params.frequency).toBe(8000);
  });

  it("delay hat time + feedback + mix", () => {
    const params = defaultParamsForType("delay");
    expect(params).toHaveProperty("time");
    expect(params).toHaveProperty("feedback");
    expect(params).toHaveProperty("mix");
  });

  it("reverb hat decay + mix", () => {
    const params = defaultParamsForType("reverb");
    expect(params.decay).toBe(2);
    expect(params.mix).toBe(0.3);
  });
});

describe("MixerFx – Chain-Operations", () => {
  function mkChain(): MixerFxSlot[] {
    return [
      makeMixerFxSlot("eq16", "a"),
      makeMixerFxSlot("compressor", "b"),
      makeMixerFxSlot("delay", "c"),
    ];
  }

  it("moveFxSlot: 0 → 2 verschiebt korrekt", () => {
    const result = moveFxSlot(mkChain(), 0, 2);
    expect(result.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("moveFxSlot: gleicher Index → unverändert (Reference-Identity)", () => {
    const chain = mkChain();
    const result = moveFxSlot(chain, 1, 1);
    expect(result).toBe(chain); // same reference, kein Neuaufbau
  });

  it("moveFxSlot: out-of-range fromIndex → unverändert", () => {
    const chain = mkChain();
    const result = moveFxSlot(chain, 99, 0);
    expect(result).toBe(chain);
  });

  it("moveFxSlot: out-of-range toIndex wird geclamped auf max", () => {
    const result = moveFxSlot(mkChain(), 0, 99);
    expect(result[result.length - 1].id).toBe("a");
  });

  it("toggleFxSlot kippt enabled für matching id, andere unverändert", () => {
    const result = toggleFxSlot(mkChain(), "b");
    expect(result.find((s) => s.id === "b")?.enabled).toBe(false);
    expect(result.find((s) => s.id === "a")?.enabled).toBe(true);
  });

  it("toggleFxSlot mit unbekannter id → kein Effekt", () => {
    const result = toggleFxSlot(mkChain(), "nope");
    for (const s of result) expect(s.enabled).toBe(true);
  });

  it("removeFxSlot entfernt nur matching id", () => {
    const result = removeFxSlot(mkChain(), "b");
    expect(result.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("removeFxSlot mit unbekannter id → unverändert", () => {
    const result = removeFxSlot(mkChain(), "nope");
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("MixerFx – Sidechain", () => {
  it("computeSidechainGain: disabled → gain=1 (kein Ducking)", () => {
    const gain = computeSidechainGain(0.9, { ...DEFAULT_SIDECHAIN, enabled: false });
    expect(gain).toBe(1);
  });

  it("computeSidechainGain: enabled aber kein sourcePartId → gain=1", () => {
    const gain = computeSidechainGain(0.9, { ...DEFAULT_SIDECHAIN, enabled: true, sourcePartId: null });
    expect(gain).toBe(1);
  });

  it("computeSidechainGain: voller Envelope + amount=1 → gain=0", () => {
    const gain = computeSidechainGain(1, { ...DEFAULT_SIDECHAIN, enabled: true, sourcePartId: "kick", amount: 1 });
    expect(gain).toBe(0);
  });

  it("computeSidechainGain: amount=0.5 + Envelope=1 → gain=0.5", () => {
    const gain = computeSidechainGain(1, { ...DEFAULT_SIDECHAIN, enabled: true, sourcePartId: "k", amount: 0.5 });
    expect(gain).toBe(0.5);
  });

  it("normalizeSidechain mit undefined → DEFAULT_SIDECHAIN-Werte", () => {
    const result = normalizeSidechain(undefined);
    expect(result).toEqual(DEFAULT_SIDECHAIN);
  });

  it("normalizeSidechain clampt amount auf [0,1]", () => {
    const result = normalizeSidechain({ amount: 2 });
    expect(result.amount).toBe(1);
  });

  it("normalizeSidechain clampt attack auf [0.001, 1]", () => {
    expect(normalizeSidechain({ attack: 0 }).attack).toBe(0.001);
    expect(normalizeSidechain({ attack: 99 }).attack).toBe(1);
  });

  it("normalizeSidechain clampt release auf [0.01, 2]", () => {
    expect(normalizeSidechain({ release: 0 }).release).toBe(0.01);
    expect(normalizeSidechain({ release: 10 }).release).toBe(2);
  });
});

describe("MixerFx – TransientShaper", () => {
  it("normalizeTransientShaper mit undefined → DEFAULT", () => {
    expect(normalizeTransientShaper(undefined)).toEqual(DEFAULT_TRANSIENT_SHAPER);
  });

  it("normalizeTransientShaper clampt attack/sustain auf [-1, 1]", () => {
    const r = normalizeTransientShaper({ attack: 5, sustain: -5 });
    expect(r.attack).toBe(1);
    expect(r.sustain).toBe(-1);
  });

  it("normalizeTransientShaper clampt mix auf [0, 1]", () => {
    expect(normalizeTransientShaper({ mix: 2 }).mix).toBe(1);
    expect(normalizeTransientShaper({ mix: -1 }).mix).toBe(0);
  });
});
