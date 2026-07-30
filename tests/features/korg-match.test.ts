/**
 * „Korg Match"-Profile (client/src/utils/korg/korgMatch.ts)
 *
 * Die Datei ist reine Komposition vorhandener Bausteine — deshalb prüfen diese
 * Tests NICHT die DSP-Mathematik nach (die hat eigene Tests), sondern die
 * Eigenschaften, die erst durch das Zusammensetzen entstehen:
 *
 *  - Die Obergrenze wird eingehalten. Das ist der eigentliche Zweck: die
 *    Electribe hat keinen Limiter, was übersteuert kommt übersteuert raus.
 *  - Die Reihenfolge stimmt (Limiter zuletzt, Cleanup zuerst).
 *  - Nichts wird stillschweigend kaputtgemacht: stille Puffer, leere Puffer,
 *    Gleichanteil.
 */
import { describe, it, expect } from "vitest";
import {
  KORG_MATCH_PROFILES,
  applyKorgMatch,
  bufferToInterleaved,
  interleavedToBuffer,
  korgMatchProfile,
  type KorgMatchId,
} from "@/utils/korg/korgMatch";
import type { AudioBufferLike } from "@/utils/sampleEmbedding";

const SR = 44100;
const ALL_IDS: KorgMatchId[] = ["clean", "loud", "hardtekk"];

function buf(channels: Float32Array[], sampleRate = SR): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData: (i: number) => channels[i],
  };
}

/** Sinus mit gegebener Amplitude. */
function sine(amp: number, frames = 4410, freq = 220): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

// ─── Profil-Katalog ──────────────────────────────────────────────────────────

describe("Profil-Katalog", () => {
  it("führt genau die drei angekündigten Profile", () => {
    expect(KORG_MATCH_PROFILES.map(p => p.id)).toEqual(ALL_IDS);
  });

  it("hält jede Obergrenze unter 1.0", () => {
    // Bei exakt 1.0 kippt die Rundung nach 16-Bit-Ganzzahl über — genau der
    // Knack, den der Limiter verhindern soll.
    for (const p of KORG_MATCH_PROFILES) {
      expect(p.ceiling).toBeGreaterThan(0.5);
      expect(p.ceiling).toBeLessThan(1.0);
    }
  });

  it("gibt jedem Profil eine erklärende Beschreibung", () => {
    for (const p of KORG_MATCH_PROFILES) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(20);
    }
  });

  it("wirft bei unbekannter Kennung statt still etwas Falsches zu tun", () => {
    expect(() => korgMatchProfile("gibtsnicht" as KorgMatchId)).toThrow(RangeError);
  });

  it("setzt bei jedem Kompressor-Preset makeupGainDb auf 0", () => {
    // Make-up wäre doppelt: der Normalisier-Schritt legt den Endpegel fest.
    for (const p of KORG_MATCH_PROFILES) {
      if (p.compressor) expect(p.compressor.makeupGainDb).toBe(0);
    }
  });
});

// ─── Die Kernzusage: nichts übersteuert ──────────────────────────────────────

describe("Obergrenze wird eingehalten", () => {
  for (const id of ALL_IDS) {
    it(`${id}: hält die Obergrenze auch bei bereits übersteuertem Material`, () => {
      // Material, das über 0 dBFS liegt — der pathologische Fall.
      const hot = new Float32Array(4410);
      for (let i = 0; i < hot.length; i++) {
        hot[i] = 1.8 * Math.sin((2 * Math.PI * 220 * i) / SR);
      }
      const res = applyKorgMatch(buf([hot]), id);
      const ceiling = korgMatchProfile(id).ceiling;
      // Kleine Toleranz für Float-Rundung, aber garantiert unter 1.0.
      expect(res.peakAfter).toBeLessThanOrEqual(ceiling + 1e-6);
      expect(res.peakAfter).toBeLessThan(1.0);
    });

    it(`${id}: hebt leises Material an, ohne die Grenze zu reißen`, () => {
      const quiet = sine(0.05);
      const res = applyKorgMatch(buf([quiet]), id);
      expect(res.peakAfter).toBeGreaterThan(0.5); // deutlich lauter als 0.05
      expect(res.peakAfter).toBeLessThan(1.0);
      expect(res.gainAppliedDb).toBeGreaterThan(0);
    });
  }
});

// ─── Reihenfolge + Rückmeldung ───────────────────────────────────────────────

describe("Kette und Rückmeldung", () => {
  it("nennt die gelaufenen Schritte in der Reihenfolge der Kette", () => {
    const res = applyKorgMatch(buf([sine(0.3)]), "hardtekk");
    const joined = res.steps.join(" | ");
    const iCleanup = joined.indexOf("Cleanup");
    const iComp = joined.indexOf("Kompressor");
    const iSat = joined.indexOf("Saturation");
    const iNorm = joined.indexOf("Normalisiert");
    expect(iCleanup).toBeGreaterThanOrEqual(0);
    expect(iCleanup).toBeLessThan(iComp);
    expect(iComp).toBeLessThan(iSat);
    expect(iSat).toBeLessThan(iNorm);
  });

  it("Clean lässt Kompressor und Saturation aus", () => {
    const res = applyKorgMatch(buf([sine(0.3)]), "clean");
    const joined = res.steps.join(" | ");
    expect(joined).toContain("Cleanup");
    expect(joined).not.toContain("Kompressor");
    expect(joined).not.toContain("Saturation");
  });

  it("meldet begrenzte Spitzen, statt sie zu verschweigen", () => {
    const hot = new Float32Array(2000).fill(0.99);
    const res = applyKorgMatch(buf([hot]), "clean");
    if (res.limitedSamples > 0) {
      expect(res.steps.join(" ")).toContain("Safety-Limiter");
    }
    // Der Pegel muss in jedem Fall passen.
    expect(res.peakAfter).toBeLessThan(1.0);
  });
});

// ─── Randfälle ───────────────────────────────────────────────────────────────

describe("Randfälle", () => {
  it("lässt einen leeren Puffer unverändert durch", () => {
    const empty = buf([new Float32Array(0)]);
    const res = applyKorgMatch(empty, "loud");
    expect(res.steps.join(" ")).toContain("leerer Puffer");
    expect(res.peakAfter).toBe(0);
  });

  it("zieht ein stilles Sample NICHT hoch", () => {
    // Sonst würde aus Rauschen unter der Hörschwelle plötzlich hörbares
    // Rauschen — die Normalisierung erkennt Stille und lässt die Hände weg.
    const silent = buf([new Float32Array(4410)]);
    const res = applyKorgMatch(silent, "hardtekk");
    expect(res.peakAfter).toBeLessThan(1e-6);
    expect(res.steps.join(" ")).toContain("übersprungen");
  });

  it("entfernt einen Gleichanteil", () => {
    // Konstanter Offset auf einem Sinus: nach dem Cleanup muss der Mittelwert
    // praktisch bei 0 liegen, sonst frisst der Offset Kopfraum.
    const withDc = sine(0.3);
    for (let i = 0; i < withDc.length; i++) withDc[i] += 0.25;
    const res = applyKorgMatch(buf([withDc]), "clean");
    const out = res.buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i];
    expect(Math.abs(sum / out.length)).toBeLessThan(0.02);
  });

  it("verarbeitet Stereo kanalweise und behält die Kanalzahl", () => {
    const l = sine(0.2);
    const r = sine(0.4);
    const res = applyKorgMatch(buf([l, r]), "loud");
    expect(res.buffer.numberOfChannels).toBe(2);
    expect(res.buffer.getChannelData(0).length).toBe(l.length);
    expect(res.buffer.getChannelData(1).length).toBe(r.length);
  });

  it("verändert den Eingabepuffer nicht", () => {
    // Pure Funktion: der Aufrufer soll das Original noch für einen A/B-Vergleich
    // haben.
    const src = sine(0.3);
    const copy = Float32Array.from(src);
    applyKorgMatch(buf([src]), "hardtekk");
    expect(Array.from(src)).toEqual(Array.from(copy));
  });

  it("behält die Abtastrate", () => {
    const res = applyKorgMatch(buf([sine(0.3)], 22050), "clean");
    expect(res.buffer.sampleRate).toBe(22050);
  });
});

// ─── Brücke zum Slot-Format ──────────────────────────────────────────────────

describe("interleavedToBuffer / bufferToInterleaved", () => {
  it("trennt Stereo korrekt auf — links bleibt links", () => {
    // Der Fehler, den diese Brücke verhindern soll: vertauschte Kanäle fallen
    // bei symmetrischem Material nicht auf, bei echtem Stereo sofort.
    const inter = Float32Array.from([0.1, -0.1, 0.2, -0.2, 0.3, -0.3]);
    const b = interleavedToBuffer(inter, 2, SR);
    expect(b.numberOfChannels).toBe(2);
    expect(b.length).toBe(3);
    expect(Array.from(b.getChannelData(0))).toEqual([0.1, 0.2, 0.3].map(v => Math.fround(v)));
    expect(Array.from(b.getChannelData(1))).toEqual([-0.1, -0.2, -0.3].map(v => Math.fround(v)));
  });

  it("ist in beide Richtungen verlustfrei (Round-Trip)", () => {
    const inter = Float32Array.from([0.5, -0.5, 0.25, -0.25]);
    const back = bufferToInterleaved(interleavedToBuffer(inter, 2, SR));
    expect(Array.from(back)).toEqual(Array.from(inter));
  });

  it("reicht Mono unverändert durch", () => {
    const mono = Float32Array.from([0.1, 0.2, 0.3]);
    const b = interleavedToBuffer(mono, 1, SR);
    expect(b.numberOfChannels).toBe(1);
    expect(Array.from(bufferToInterleaved(b))).toEqual([0.1, 0.2, 0.3].map(v => Math.fround(v)));
  });

  it("verträgt eine ungerade Länge bei Stereo, ohne zu werfen", () => {
    // Kann bei beschädigten Bänken vorkommen; das letzte halbe Frame fällt weg.
    const odd = Float32Array.from([0.1, -0.1, 0.2]);
    const b = interleavedToBuffer(odd, 2, SR);
    expect(b.length).toBe(1);
    expect(Array.from(bufferToInterleaved(b))).toHaveLength(2);
  });

  it("überlebt die komplette Kette im Slot-Format", () => {
    const frames = 2205;
    const inter = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      inter[i * 2] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / SR);
      inter[i * 2 + 1] = 0.1 * Math.sin((2 * Math.PI * 330 * i) / SR);
    }
    const res = applyKorgMatch(interleavedToBuffer(inter, 2, SR), "loud");
    const out = bufferToInterleaved(res.buffer);
    expect(out.length).toBe(frames * 2);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1.0);
  });
});
