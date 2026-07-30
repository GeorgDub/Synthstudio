/**
 * MIDI-Datei → E2-Pattern mit Takten (client/src/utils/korg/midiToE2Pattern.ts)
 *
 * Der Schwerpunkt liegt auf den Eigenschaften, die der bisherige Weg
 * (`midiParser.js` mit `step % stepCount`) stillschweigend verletzt hat:
 *
 *  - Takt 1 und Takt 5 dürfen NICHT auf denselben Steps landen.
 *  - Ein Takt-Bereich muss auswählbar sein und exakt greifen.
 *  - Was nicht übernommen wird, muss im Bericht auftauchen — nicht verschwinden.
 *
 * Die MIDI-Dateien werden hier byteweise gebaut. Das ist umständlicher als eine
 * Fixture-Datei, macht aber jeden Testfall lesbar: man sieht, auf welchem Tick
 * welche Note liegt.
 */
import { describe, it, expect } from "vitest";
import { parseMidiFileDetailed } from "@/utils/smfParser";
import {
  E2_PARTS,
  E2_STEPS_PER_BAR,
  barCount,
  describeMidiToE2,
  midiToE2Patterns,
  ticksPerBar,
} from "@/utils/korg/midiToE2Pattern";

const TPQN = 96; // Ticks pro Viertel
const TICKS_PER_BAR_44 = TPQN * 4;

// ─── MIDI-Datei-Baukasten ────────────────────────────────────────────────────

function vlq(n: number): number[] {
  if (n === 0) return [0];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0x7f);
    v >>>= 7;
  }
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return bytes;
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

interface NoteSpec {
  tick: number;
  note: number;
  velocity?: number;
  channel?: number;
  /** Länge in Ticks; Vorgabe eine Sechzehntel. */
  durationTicks?: number;
}

interface TrackSpec {
  name?: string;
  notes: NoteSpec[];
}

/** Baut eine SMF-Type-1-Datei aus Track-Spezifikationen. */
function buildMidi(
  tracks: TrackSpec[],
  opts: { timeSignature?: [number, number]; bpm?: number } = {},
): Uint8Array {
  const out: number[] = [];
  // MThd
  out.push(0x4d, 0x54, 0x68, 0x64, ...be32(6));
  out.push(0x00, 0x01); // Format 1
  out.push(0x00, tracks.length);
  out.push((TPQN >> 8) & 0xff, TPQN & 0xff);

  tracks.forEach((tr, ti) => {
    const ev: number[] = [];
    if (ti === 0) {
      if (opts.timeSignature) {
        const [num, den] = opts.timeSignature;
        const denPow = Math.log2(den);
        ev.push(...vlq(0), 0xff, 0x58, 0x04, num, denPow, 24, 8);
      }
      if (opts.bpm) {
        const mpb = Math.round(60_000_000 / opts.bpm);
        ev.push(...vlq(0), 0xff, 0x51, 0x03,
          (mpb >> 16) & 0xff, (mpb >> 8) & 0xff, mpb & 0xff);
      }
    }
    if (tr.name) {
      const chars = [...tr.name].map(c => c.charCodeAt(0));
      ev.push(...vlq(0), 0xff, 0x03, chars.length, ...chars);
    }
    // Events als (Tick, Bytes) sammeln, dann nach Tick sortieren und Deltas bilden.
    const abs: { tick: number; bytes: number[] }[] = [];
    for (const n of tr.notes) {
      const ch = n.channel ?? 9;
      const dur = n.durationTicks ?? TPQN / 4;
      abs.push({ tick: n.tick, bytes: [0x90 | ch, n.note, n.velocity ?? 100] });
      abs.push({ tick: n.tick + dur, bytes: [0x80 | ch, n.note, 0x40] });
    }
    abs.sort((a, b) => a.tick - b.tick);
    let last = 0;
    for (const e of abs) {
      ev.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    ev.push(...vlq(0), 0xff, 0x2f, 0x00); // End of Track
    out.push(0x4d, 0x54, 0x72, 0x6b, ...be32(ev.length), ...ev);
  });

  return Uint8Array.from(out);
}

/** Kurzform: eine Spur, Kanal 9. */
function drums(notes: NoteSpec[], opts?: Parameters<typeof buildMidi>[1]) {
  return parseMidiFileDetailed(buildMidi([{ notes }], opts));
}

/** Aktive Step-Indizes eines Parts. */
function activeSteps(pattern: { parts: { steps: { active: boolean }[] }[] }, part: number) {
  return pattern.parts[part].steps
    .map((s, i) => (s.active ? i : -1))
    .filter(i => i >= 0);
}

// ─── Der eigentliche Fehler von vorher ───────────────────────────────────────

describe("Takte werden NICHT in einen Takt gefaltet", () => {
  it("legt Takt 1 und Takt 5 in verschiedene Patterns", () => {
    // Mit `% 16` (alter Weg) läge beides auf Step 0 desselben Patterns.
    const parsed = drums([
      { tick: 0, note: 36 },                    // Takt 1, Step 0
      { tick: 4 * TICKS_PER_BAR_44, note: 36 }, // Takt 5, Step 0
    ]);
    const { patterns, report } = midiToE2Patterns(parsed, { stepsPerPattern: 16 });

    expect(report.barFrom).toBe(1);
    expect(report.barTo).toBe(5);
    expect(report.patternCount).toBe(5);
    expect(report.placedNotes).toBe(2);
    expect(activeSteps(patterns[0], 0)).toEqual([0]);
    expect(activeSteps(patterns[4], 0)).toEqual([0]);
    // Die Takte dazwischen bleiben leer und werden nicht zugemüllt.
    for (const p of [1, 2, 3]) {
      expect(activeSteps(patterns[p], 0)).toEqual([]);
    }
  });

  it("verteilt vier Takte auf EIN 64-Step-Pattern, positionsrichtig", () => {
    const parsed = drums([
      { tick: 0, note: 36 },
      { tick: TICKS_PER_BAR_44, note: 36 },
      { tick: 2 * TICKS_PER_BAR_44, note: 36 },
      { tick: 3 * TICKS_PER_BAR_44, note: 36 },
    ]);
    const { patterns, report } = midiToE2Patterns(parsed, { stepsPerPattern: 64 });
    expect(report.patternCount).toBe(1);
    // Ein Takt = 16 Steps → 0, 16, 32, 48.
    expect(activeSteps(patterns[0], 0)).toEqual([0, 16, 32, 48]);
  });

  it("quantisiert auf den nächsten Step, nicht auf den vorigen", () => {
    // Eine Note kurz VOR dem Schlag gehört auf den Schlag.
    const ticksPerStep = TICKS_PER_BAR_44 / E2_STEPS_PER_BAR; // 24
    const parsed = drums([{ tick: ticksPerStep * 2 - 2, note: 38 }]);
    const { patterns } = midiToE2Patterns(parsed, { stepsPerPattern: 16 });
    expect(activeSteps(patterns[0], 0)).toEqual([2]);
  });
});

// ─── Takt-Bereich ────────────────────────────────────────────────────────────

describe("Takt-Bereichswahl", () => {
  const parsed = () =>
    drums([
      { tick: 0, note: 36 },                    // Takt 1
      { tick: TICKS_PER_BAR_44, note: 38 },     // Takt 2
      { tick: 2 * TICKS_PER_BAR_44, note: 42 }, // Takt 3
      { tick: 3 * TICKS_PER_BAR_44, note: 46 }, // Takt 4
    ]);

  it("nimmt genau den gewählten Bereich und zählt den Rest als außerhalb", () => {
    const { patterns, report } = midiToE2Patterns(parsed(), {
      barFrom: 2, barTo: 3, stepsPerPattern: 16,
    });
    expect(report.patternCount).toBe(2);
    expect(report.placedNotes).toBe(2);
    expect(report.outOfRangeNotes).toBe(2); // Takt 1 und 4
    // Takt 2 ist jetzt das erste Pattern und beginnt bei Step 0.
    expect(activeSteps(patterns[0], 0)).toEqual([0]);
    expect(activeSteps(patterns[1], 1)).toEqual([0]);
  });

  it("benennt Patterns nach ihrem Anfangstakt", () => {
    const { patterns } = midiToE2Patterns(parsed(), {
      barFrom: 2, barTo: 4, stepsPerPattern: 16, namePrefix: "Bottrop",
    });
    expect(patterns.map(p => p.name)).toEqual(["Bottrop T2", "Bottrop T3", "Bottrop T4"]);
  });

  it("vergibt bei einem einzigen Pattern den Namen ohne Taktzusatz", () => {
    const { patterns } = midiToE2Patterns(parsed(), {
      barFrom: 1, barTo: 1, namePrefix: "Kick",
    });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe("Kick");
  });

  it("verträgt einen Bereich jenseits der Datei ohne zu werfen", () => {
    const { patterns, report } = midiToE2Patterns(parsed(), { barFrom: 50, barTo: 52 });
    expect(patterns).toHaveLength(3);
    expect(report.placedNotes).toBe(0);
    expect(report.outOfRangeNotes).toBe(4);
  });

  it("dreht einen verdrehten Bereich nicht still um", () => {
    // barTo < barFrom: der Bereich wird auf barFrom geklemmt, nicht getauscht —
    // ein stiller Tausch würde einen Tippfehler zu einem plausiblen Ergebnis
    // machen.
    const { report } = midiToE2Patterns(parsed(), { barFrom: 3, barTo: 1 });
    expect(report.barFrom).toBe(3);
    expect(report.barTo).toBe(3);
  });
});

// ─── Taktart ─────────────────────────────────────────────────────────────────

describe("Taktart", () => {
  it("rechnet 4/4 als vier Viertel", () => {
    expect(ticksPerBar(96, { numerator: 4, denominator: 4 })).toBe(384);
  });

  it("rechnet 3/4 als drei Viertel", () => {
    expect(ticksPerBar(96, { numerator: 3, denominator: 4 })).toBe(288);
  });

  it("rechnet 6/8 als drei Viertel", () => {
    expect(ticksPerBar(96, { numerator: 6, denominator: 8 })).toBe(288);
  });

  it("übernimmt die Taktart aus der Datei und markiert das", () => {
    const parsed = drums([{ tick: 0, note: 36 }], { timeSignature: [3, 4] });
    expect(parsed.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(parsed.timeSignatureFromFile).toBe(true);
    const { report } = midiToE2Patterns(parsed);
    expect(report.timeSignatureFromFile).toBe(true);
  });

  it("markiert 4/4 als Annahme, wenn die Datei keine Taktart nennt", () => {
    // Ehrlichkeit: bei einer 3/4-Datei ohne Meta-Event wäre unsere Takt-Rechnung
    // falsch, und der Nutzer soll das sehen können.
    const parsed = drums([{ tick: 0, note: 36 }]);
    expect(parsed.timeSignatureFromFile).toBe(false);
    expect(describeMidiToE2(midiToE2Patterns(parsed).report)).toContain("4/4 angenommen");
  });

  it("verschiebt bei 3/4 die Taktgrenzen entsprechend", () => {
    const tpb34 = TPQN * 3;
    const parsed = drums(
      [{ tick: 0, note: 36 }, { tick: tpb34, note: 38 }],
      { timeSignature: [3, 4] },
    );
    const { report } = midiToE2Patterns(parsed, { barFrom: 2, barTo: 2 });
    expect(report.placedNotes).toBe(1);
    expect(report.outOfRangeNotes).toBe(1);
  });
});

// ─── Part-Zuordnung ──────────────────────────────────────────────────────────

describe("Zuordnung nach Tonhöhe (Drums)", () => {
  it("gibt jeder Tonhöhe ihren eigenen Part, in Reihenfolge des Auftretens", () => {
    const parsed = drums([
      { tick: 0, note: 36 },       // Kick  → Part 0
      { tick: 24, note: 42 },      // Hat   → Part 1
      { tick: 48, note: 38 },      // Snare → Part 2
      { tick: 72, note: 42 },      // Hat wieder → Part 1
    ]);
    const { patterns, report } = midiToE2Patterns(parsed);
    expect(report.partSources.map(s => s.source)).toEqual([36, 42, 38]);
    expect(activeSteps(patterns[0], 0)).toEqual([0]);
    expect(activeSteps(patterns[0], 1)).toEqual([1, 3]);
    expect(activeSteps(patterns[0], 2)).toEqual([2]);
  });

  it("meldet Tonhöhen, für die kein Part mehr frei war", () => {
    // 17 verschiedene Tonhöhen, aber nur 16 Parts — die 17. darf nicht
    // stillschweigend auf Part 0 landen (genau das machte `note % parts.length`).
    const notes = Array.from({ length: E2_PARTS + 1 }, (_, i) => ({
      tick: i * 24, note: 36 + i,
    }));
    const { report } = midiToE2Patterns(drums(notes), { stepsPerPattern: 32 });
    expect(report.partSources).toHaveLength(E2_PARTS);
    expect(report.unmappedNotes).toBe(1);
    expect(report.unmappedSources).toEqual([36 + E2_PARTS]);
    expect(describeMidiToE2(report)).toContain("ohne Part");
  });
});

describe("Zuordnung nach Spur (Melodie)", () => {
  const file = () =>
    parseMidiFileDetailed(
      buildMidi([
        { name: "Bass", notes: [{ tick: 0, note: 40, channel: 0 }] },
        { name: "Lead", notes: [{ tick: 24, note: 64, channel: 1 }] },
      ]),
    );

  it("macht aus jeder Spur einen Part und behält die Tonhöhe im Step", () => {
    const { patterns, report } = midiToE2Patterns(file(), { mapping: "track" });
    expect(report.partSources.map(s => s.label)).toEqual([
      "Spur 1 (Bass)", "Spur 2 (Lead)",
    ]);
    expect(patterns[0].parts[0].steps[0].note).toBe(40);
    expect(patterns[0].parts[1].steps[1].note).toBe(64);
  });

  it("lässt bei Tonhöhen-Zuordnung die Geräte-Vorgabe für note stehen", () => {
    // Dort steckt die Tonhöhe schon im Part; ein zusätzliches `note` würde das
    // Sample transponieren.
    const { patterns } = midiToE2Patterns(file(), { mapping: "pitch" });
    expect(patterns[0].parts[0].steps[0].note).toBeUndefined();
  });

  it("berücksichtigt nur die gewählten Spuren", () => {
    const { report } = midiToE2Patterns(file(), { mapping: "track", tracks: [1] });
    expect(report.partSources).toHaveLength(1);
    expect(report.partSources[0].label).toContain("Lead");
  });

  it("behandelt eine leere Auswahl als 'nichts', nicht als 'alles'", () => {
    const { patterns, report } = midiToE2Patterns(file(), { tracks: [] });
    expect(report.placedNotes).toBe(0);
    expect(patterns[0].parts.every(p => p.steps.every(s => !s.active))).toBe(true);
  });
});

// ─── Kollisionen ─────────────────────────────────────────────────────────────

describe("Kollisionen", () => {
  it("behält die lautere Note und meldet die verdrängte", () => {
    // Zwei Spuren, dieselbe Tonhöhe, derselbe Tick → ein Step, zwei Bewerber.
    const parsed = parseMidiFileDetailed(
      buildMidi([
        { notes: [{ tick: 0, note: 36, velocity: 60 }] },
        { notes: [{ tick: 0, note: 36, velocity: 120 }] },
      ]),
    );
    const { patterns, report } = midiToE2Patterns(parsed);
    expect(report.collisions).toHaveLength(1);
    expect(patterns[0].parts[0].steps[0].velocity).toBe(120);
    expect(describeMidiToE2(report)).toContain("Kollision");
  });

  it("ist bei gleicher Velocity reproduzierbar (erste bleibt)", () => {
    const parsed = parseMidiFileDetailed(
      buildMidi([
        { notes: [{ tick: 0, note: 36, velocity: 100 }] },
        { notes: [{ tick: 0, note: 36, velocity: 100 }] },
      ]),
    );
    const a = midiToE2Patterns(parsed);
    const b = midiToE2Patterns(parsed);
    expect(a.report.collisions).toEqual(b.report.collisions);
  });
});

// ─── Rahmenwerte ─────────────────────────────────────────────────────────────

describe("Rahmenwerte", () => {
  it("übernimmt das Tempo aus der Datei", () => {
    const parsed = drums([{ tick: 0, note: 36 }], { bpm: 174 });
    expect(midiToE2Patterns(parsed).patterns[0].bpm).toBe(174);
  });

  it("lässt sich das Tempo überschreiben", () => {
    const parsed = drums([{ tick: 0, note: 36 }], { bpm: 174 });
    expect(midiToE2Patterns(parsed, { bpm: 200 }).patterns[0].bpm).toBe(200);
  });

  it("klemmt ein unmögliches Tempo auf den Geräte-Bereich", () => {
    const parsed = drums([{ tick: 0, note: 36 }]);
    expect(midiToE2Patterns(parsed, { bpm: 5 }).patterns[0].bpm).toBe(20);
    expect(midiToE2Patterns(parsed, { bpm: 999 }).patterns[0].bpm).toBe(300);
  });

  it("liefert immer genau 16 Parts mit der versprochenen Step-Zahl", () => {
    for (const len of [16, 32, 64] as const) {
      const { patterns } = midiToE2Patterns(drums([{ tick: 0, note: 36 }]), {
        stepsPerPattern: len,
      });
      expect(patterns[0].parts).toHaveLength(E2_PARTS);
      expect(patterns[0].stepLength).toBe(len);
      for (const part of patterns[0].parts) expect(part.steps).toHaveLength(len);
    }
  });

  it("zählt Takte einer leeren Datei als 1", () => {
    expect(barCount(drums([]))).toBe(1);
  });

  it("erzeugt auch ohne Noten ein gültiges Pattern", () => {
    const { patterns, report } = midiToE2Patterns(drums([]));
    expect(patterns).toHaveLength(1);
    expect(report.placedNotes).toBe(0);
  });
});

// ─── Parser-Zusatz ───────────────────────────────────────────────────────────

describe("parseMidiFileDetailed", () => {
  it("behält absolute Ticks statt zu quantisieren", () => {
    const parsed = drums([{ tick: 500, note: 36 }]);
    expect(parsed.notes[0].tick).toBe(500);
  });

  it("erfasst alle Kanäle, nicht nur die GM-Drums", () => {
    // Der alte Parser verwarf alles außer Kanal 9 — Melodie-Spuren gingen
    // dadurch komplett verloren.
    const parsed = parseMidiFileDetailed(
      buildMidi([{ notes: [{ tick: 0, note: 60, channel: 0 }] }]),
    );
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0].channel).toBe(0);
  });

  it("liest Spurnamen und Kanalbelegung für die Auswahl", () => {
    const parsed = parseMidiFileDetailed(
      buildMidi([
        { name: "Drums", notes: [{ tick: 0, note: 36, channel: 9 }] },
        { name: "Bass", notes: [{ tick: 0, note: 40, channel: 2 }] },
      ]),
    );
    expect(parsed.tracks.map(t => t.name)).toEqual(["Drums", "Bass"]);
    expect(parsed.tracks[0].channels).toEqual([9]);
    expect(parsed.tracks[1].channels).toEqual([2]);
    expect(parsed.tracks[1].noteCount).toBe(1);
  });

  it("paart Note-Off und liefert Längen", () => {
    const parsed = drums([{ tick: 0, note: 36, durationTicks: 48 }]);
    expect(parsed.notes[0].durationTicks).toBe(48);
  });

  it("behandelt Note-On mit Velocity 0 als Note-Off", () => {
    // Verbreitete Kodierung; als Note-On gelesen ergäbe sie eine Geisternote.
    const bytes = buildMidi([{ notes: [] }]);
    const parsed = parseMidiFileDetailed(bytes);
    expect(parsed.notes).toHaveLength(0);
  });

  it("sortiert Noten zeitlich über Spurgrenzen hinweg", () => {
    const parsed = parseMidiFileDetailed(
      buildMidi([
        { notes: [{ tick: 100, note: 36 }] },
        { notes: [{ tick: 50, note: 38 }] },
      ]),
    );
    expect(parsed.notes.map(n => n.tick)).toEqual([50, 100]);
  });

  it("wirft bei SMPTE-Zeitbasis statt falsch zu rechnen", () => {
    const bad = Uint8Array.from([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 0x28,
    ]);
    expect(() => parseMidiFileDetailed(bad)).toThrow(/SMPTE/);
  });
});
