/**
 * tests/features/e2-chord-step-editor.test.ts
 *
 * v3.309 — Chord-Noten (E2-Step-Bytes 5..7) im Step-Editor sichtbar.
 *
 * Prüft die komplette UI-Pipeline in beiden Richtungen:
 *   Import:  ParsedPartStep.chordNotes → convertParsedPatternToSynthstudio
 *            → drumParts.chords (index-aligned) → StepData.chordNotes
 *   Export:  StepData.chordNotes → convertStepToE2 → E2StepInput.chordNotes
 *            → buildE2PatternBody → Bytes 5..7
 *   Anzeige: midiNoteLabel / chordNotesLabel (Notennamen), inkl. der
 *            v3.309-Reparatur von NOTE_NAMES (fehlendes "G#").
 */

import { describe, it, expect } from "vitest";

import {
  convertParsedPatternToSynthstudio,
  parseElectribeAllPatBank,
} from "../../client/src/utils/electribeImport";
import type { ParsedPattern } from "../../client/src/utils/electribeImport";
import { convertStepToE2 } from "../../client/src/utils/electribePatternConvert";
import { buildE2PatternBody } from "../../client/src/utils/e2sExport";
import {
  NOTE_NAMES,
  midiNoteLabel,
  chordNotesLabel,
  pitchToLabel,
} from "../../client/src/components/DrumMachine/drumMachineHelpers";
import {
  E2_PART_TABLE_OFFSET,
  E2_PART_SEQ_OFFSET,
} from "../../client/src/utils/korg/e2Layout";
import { decodeStep, stepChordNotes } from "../../client/src/utils/korg/e2Sysex";

import * as fs from "node:fs";
import * as path from "node:path";

const STOCK_BANK = path.resolve(process.cwd(), "Korg e2s files", "e2s-2016.e2sallpat");
const hasStock = fs.existsSync(STOCK_BANK);

// ─── Import-Konvertierung ────────────────────────────────────────────────────

function parsedWithChord(): ParsedPattern {
  const mkStep = (active: boolean, chordNotes?: number[]) => ({
    active,
    velocity: 96,
    note: 0x41,
    gate: true,
    gateLength: 0x2e,
    ...(chordNotes ? { chordNotes } : {}),
  });
  const steps = Array.from({ length: 64 }, (_, s) =>
    mkStep(s % 4 === 0, s === 0 ? [0x2e, 0x30, 0] : undefined)
  );
  return {
    name: "ChordTest",
    bpm: 120,
    stepLength: 16,
    swing: 0,
    parts: [
      {
        index: 0,
        sampleId: 1,
        volume: 100,
        pan: 64,
        pitch: 0,
        fxSend: 0,
        steps,
        motion: [],
      },
    ],
    patternMotion: [],
  } as unknown as ParsedPattern;
}

describe("e2-chord-step-editor — Import-Pipeline", () => {
  it("convertParsedPatternToSynthstudio führt chords index-aligned mit", () => {
    const conv = convertParsedPatternToSynthstudio(parsedWithChord());
    const dp = conv.drumParts[0];
    expect(dp.chords).toHaveLength(conv.stepCount);
    expect(dp.chords[0]).toEqual([0x2e, 0x30, 0]);
    // Steps ohne Akkord: undefined (kein leeres Array).
    expect(dp.chords[4]).toBeUndefined();
  });

  it("Steps ohne chordNotes → durchgehend undefined", () => {
    const parsed = parsedWithChord();
    for (const s of parsed.parts[0].steps) delete (s as { chordNotes?: number[] }).chordNotes;
    const conv = convertParsedPatternToSynthstudio(parsed);
    expect(conv.drumParts[0].chords.every((c) => c === undefined)).toBe(true);
  });
});

// ─── Export-Rückweg ──────────────────────────────────────────────────────────

describe("e2-chord-step-editor — Export-Pipeline", () => {
  it("convertStepToE2 reicht gültige chordNotes durch (max 3, 1..127)", () => {
    const e2 = convertStepToE2({
      active: true,
      velocity: 100,
      pitch: 0,
      chordNotes: [46, 48, 300, 60],
    });
    // 300 ist ungültig und fliegt raus; die nächste gültige Note rückt in
    // den freien dritten Slot nach (max 3 Slots).
    expect(e2.chordNotes).toEqual([46, 48, 60]);
    const none = convertStepToE2({ active: true, velocity: 100, pitch: 0 });
    expect(none.chordNotes).toBeUndefined();
  });

  it("StepData → E2 → Body: Chord-Bytes 5..7 kommen an", () => {
    const step = convertStepToE2({
      active: true,
      velocity: 96,
      pitch: 0,
      chordNotes: [0x2e, 0x30],
    });
    const body = buildE2PatternBody({
      name: "UI-Chord",
      bpm: 120,
      stepLength: 16,
      parts: [{ steps: [step] }],
    });
    const so = E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    expect([body[so + 5], body[so + 6], body[so + 7]]).toEqual([0x2e, 0x30, 0]);
  });

  it.skipIf(!hasStock)(
    "Stock-Bank: Import-Konvertierung sieht die Akkorde der Werksbank",
    () => {
      const stock = new Uint8Array(fs.readFileSync(STOCK_BANK));
      const bank = parseElectribeAllPatBank(stock);
      let chordSteps = 0;
      for (const pat of bank.patterns) {
        const conv = convertParsedPatternToSynthstudio(pat);
        for (const dp of conv.drumParts) {
          chordSteps += dp.chords.filter(Boolean).length;
        }
      }
      // 4392 Chord-Steps liegen in der Bank; durch das stepCount-Cap der
      // Konvertierung bleibt der Großteil sichtbar.
      expect(chordSteps).toBeGreaterThan(3000);
    }
  );
});

// ─── Anzeige-Helper ──────────────────────────────────────────────────────────

describe("e2-chord-step-editor — Notennamen", () => {
  it("NOTE_NAMES hat 12 Einträge inkl. G# (v3.309-Fix)", () => {
    expect(NOTE_NAMES).toHaveLength(12);
    expect(NOTE_NAMES[8]).toBe("G#");
    expect(NOTE_NAMES[11]).toBe("B");
  });

  it("midiNoteLabel: E2-Konvention 72 = C5, 60 = C4", () => {
    expect(midiNoteLabel(72)).toBe("C5");
    expect(midiNoteLabel(60)).toBe("C4");
    expect(midiNoteLabel(46)).toBe("A#2");
    expect(midiNoteLabel(999)).toBe("—");
  });

  it("chordNotesLabel filtert 0-Slots und ungültige Werte", () => {
    expect(chordNotesLabel([46, 48, 0])).toBe("A#2 · C3");
    expect(chordNotesLabel([0, 0, 0])).toBe("");
    expect(chordNotesLabel(undefined)).toBe("");
  });

  it("pitchToLabel: Halbtöne oberhalb G sind nicht mehr verrutscht", () => {
    // +8 über C4 = G#4 — mit dem alten 11er-Array stand hier "A4".
    expect(pitchToLabel(8)).toBe("G#4 (+8)");
    expect(pitchToLabel(11)).toBe("B4 (+11)");
    expect(pitchToLabel(0)).toBe("C4 (+0)");
  });

  it("stepChordNotes liefert die Chord-Sicht auf einen dekodierten Sysex-Step", () => {
    const raw = new Uint8Array([1, 0x41, 0x60, 1, 0x2e, 0x30, 0x34, 0, 0, 0, 0, 0]);
    const step = decodeStep(raw, 0);
    expect(stepChordNotes(step)).toEqual([0x30, 0x34]);
  });
});
