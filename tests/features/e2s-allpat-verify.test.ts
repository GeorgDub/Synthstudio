/**
 * tests/features/e2s-allpat-verify.test.ts
 *
 * v3.307 — Stock-verifizierter Bank-Validator + Builder-Härtung.
 *
 * Ground truth ist die Werksbank "e2s-2016.e2sallpat" (250 echte
 * Factory-Patterns). Drei Schichten:
 *   1. Die STOCK-BANK selbst muss den Validator fehlerfrei passieren
 *      (conditional skip, Datei ist user-supplied in "Korg e2s files/").
 *   2. BUILDER-Output (leer, typisch, Grenzwerte) muss fehlerfrei passieren —
 *      inkl. der v3.307-Fixes: Sample-Ref-Clamp 999, 0xFF-Tie-Durchreichung,
 *      Velocity-Minimum 1, gate/gateLength aus dem Input.
 *   3. Gezielt KORRUMPIERTE Bänke müssen mit präzisen Fehlern durchfallen.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  verifyE2AllpatBank,
  E2_PATTERN_PTED_OFFSET,
  E2_NOTE_TIE_SENTINEL,
} from "../../client/src/utils/korg/e2AllpatVerify";
import {
  buildE2AllPatFile,
  buildE2PatternBody,
  E2S_ALLPAT_FILE_SIZE,
} from "../../client/src/utils/e2sExport";
import {
  E2_MAX_SAMPLE_REF,
  e2AllpatSlotOffset,
  E2_PART_TABLE_OFFSET,
  E2_PART_OSC_REF_OFFSET,
  E2_PART_SEQ_OFFSET,
} from "../../client/src/utils/korg/e2Layout";
import type { E2PatternInput } from "../../client/src/utils/electribePatternBuilder";

const REAL_FILES_DIR = path.resolve(process.cwd(), "Korg e2s files");
const STOCK_BANK = path.join(REAL_FILES_DIR, "e2s-2016.e2sallpat");
const hasStock = fs.existsSync(STOCK_BANK);

// ─── 1. Stock-Bank als Ground Truth ──────────────────────────────────────────

describe("verifyE2AllpatBank — Stock-Bank e2s-2016", () => {
  it.skipIf(!hasStock)("die Werksbank passiert den Validator ohne Fehler", () => {
    const stock = new Uint8Array(fs.readFileSync(STOCK_BANK));
    const verdict = verifyE2AllpatBank(stock);
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
    // Die 17 bekannten Gate-Länge-0-Steps der Werksbank sind Warnungen,
    // keine Fehler — der Validator darf Stock-Content nicht blocken.
    expect(verdict.warnings.length).toBeLessThan(50);
  });
});

// ─── 2. Builder-Output ───────────────────────────────────────────────────────

function richPatterns(): E2PatternInput[] {
  return [
    {
      name: "Verify Rich",
      bpm: 174.5,
      stepLength: 64,
      parts: Array.from({ length: 16 }, (_, p) => ({
        volume: 100 + p,
        pan: p * 8,
        muted: p % 2 === 0,
        sampleId: 501 + p,
        steps: Array.from({ length: 64 }, (_, s) => ({
          active: s % 3 === 0,
          note: s % 9 === 0 ? E2_NOTE_TIE_SENTINEL : 36 + (s % 24),
          velocity: 1 + s,
          gate: s % 6 !== 0,
          gateLength: 1 + (s % 106),
        })),
      })),
    },
    {
      name: "Grenzwert-Päd?", // Nicht-ASCII → '?'-Sanitisierung
      bpm: 9999, // clamp 300.0
      stepLength: 32,
      parts: [
        {
          volume: 999,
          pan: -5,
          sampleId: 70000, // clamp 999
          steps: [{ active: true, note: 300, velocity: -1, gateLength: 0 }],
        },
      ],
    },
  ];
}

describe("verifyE2AllpatBank — Builder-Output", () => {
  it("leere Bank (250× Init-Template) ist fehler- und warnungsfrei", () => {
    const verdict = verifyE2AllpatBank(new Uint8Array(buildE2AllPatFile([])));
    expect(verdict.errors).toEqual([]);
    expect(verdict.warnings).toEqual([]);
  });

  it("Bank mit typischen + Grenzwert-Patterns ist fehlerfrei", () => {
    const verdict = verifyE2AllpatBank(
      new Uint8Array(buildE2AllPatFile(richPatterns()))
    );
    expect(verdict.errors).toEqual([]);
  });

  it("v3.307: sampleId wird auf 999 geclampt statt auf 0xFFFF", () => {
    const bank = new Uint8Array(buildE2AllPatFile(richPatterns()));
    const partOff =
      e2AllpatSlotOffset(1) + E2_PART_TABLE_OFFSET + E2_PART_OSC_REF_OFFSET;
    const ref = bank[partOff] | (bank[partOff + 1] << 8);
    expect(ref).toBe(E2_MAX_SAMPLE_REF); // 999, nicht 65535
  });

  it("v3.307: 0xFF-Tie-Note wird durchgereicht (nicht auf 127 geclampt)", () => {
    const body = buildE2PatternBody({
      name: "Tie",
      bpm: 120,
      stepLength: 16,
      parts: [
        {
          steps: [
            { active: true, note: E2_NOTE_TIE_SENTINEL },
            { active: true, note: 60 },
          ],
        },
      ],
    });
    const s0 = E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    expect(body[s0 + 1]).toBe(0xff);
    expect(body[s0 + 12 + 1]).toBe(60);
  });

  it("v3.307: aktiver Step bekommt nie Velocity 0 oder Gate-Länge 0", () => {
    const body = buildE2PatternBody({
      name: "MinVel",
      bpm: 120,
      stepLength: 16,
      parts: [{ steps: [{ active: true, velocity: 0, gateLength: 0 }] }],
    });
    const s0 = E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    expect(body[s0 + 2]).toBe(1); // Velocity min 1 (Stock: nie 0)
    expect(body[s0 + 4]).toBe(1); // Gate-Länge min 1
  });

  it("v3.308: chordNotes landen in den Bytes 5..7 (geclampt, 0 = unbenutzt)", () => {
    const body = buildE2PatternBody({
      name: "Chord",
      bpm: 120,
      stepLength: 16,
      parts: [
        {
          steps: [
            { active: true, note: 0x41, chordNotes: [0x2e, 0x30, 300] },
            { active: true }, // kein Akkord → 0 0 0
          ],
        },
      ],
    });
    const s0 = E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    expect([body[s0 + 5], body[s0 + 6], body[s0 + 7]]).toEqual([0x2e, 0x30, 127]);
    expect([body[s0 + 12 + 5], body[s0 + 12 + 6], body[s0 + 12 + 7]]).toEqual([0, 0, 0]);
  });

  it.skipIf(!hasStock)(
    "v3.308: Stock-Akkorde überleben den Parse→Build-Roundtrip byte-genau",
    async () => {
      const { parseElectribeAllPatBank } = await import(
        "../../client/src/utils/electribeImport"
      );
      const stock = new Uint8Array(fs.readFileSync(STOCK_BANK));
      const bank = parseElectribeAllPatBank(stock);
      // Alle Steps mit Chord-Noten einsammeln (Werksbank: 4392 aktive Steps).
      let chordSteps = 0;
      let checked = 0;
      for (let pi = 0; pi < bank.patterns.length; pi++) {
        const pat = bank.patterns[pi];
        const hasChord = pat.parts.some((part) =>
          part.steps.some((s) => Array.isArray(s.chordNotes))
        );
        if (!hasChord) continue;
        chordSteps += pat.parts.reduce(
          (n, part) => n + part.steps.filter((s) => s.chordNotes).length,
          0
        );
        if (checked < 5) {
          // Roundtrip: geparste Steps in den Overlay-Builder füttern und die
          // Chord-Bytes gegen die Original-Body-Bytes prüfen.
          const bodyOff = e2AllpatSlotOffset(pi);
          const orig = stock.subarray(bodyOff, bodyOff + 0x4000);
          const rebuilt = buildE2PatternBody({
            name: pat.name,
            bpm: pat.bpm,
            stepLength: (pat.stepLength === 32 ? 32 : pat.stepLength === 64 ? 64 : 16),
            parts: pat.parts.map((part) => ({
              steps: part.steps.map((s) => ({
                active: s.active,
                note: s.note,
                velocity: s.velocity,
                gate: s.gate,
                gateLength: s.gateLength,
                chordNotes: s.chordNotes,
              })),
            })),
          });
          for (let p = 0; p < 16; p++) {
            for (let s = 0; s < 64; s++) {
              const so = E2_PART_TABLE_OFFSET + p * 0x330 + E2_PART_SEQ_OFFSET + s * 12;
              if (orig[so] !== 1) continue; // nur aktive Steps vergleichen
              expect(
                [rebuilt[so + 5], rebuilt[so + 6], rebuilt[so + 7]],
                `slot ${pi} part ${p} step ${s} chord bytes`
              ).toEqual([orig[so + 5], orig[so + 6], orig[so + 7]]);
            }
          }
          checked++;
        }
      }
      // Die Werksbank trägt Akkorde auf tausenden Steps — der Parser muss sie sehen.
      expect(chordSteps).toBeGreaterThan(4000);
      expect(checked).toBe(5);
    }
  );

  it("v3.307: gate/gateLength aus dem Input landen in den Bytes", () => {
    const body = buildE2PatternBody({
      name: "Gate",
      bpm: 120,
      stepLength: 16,
      parts: [
        {
          steps: [
            { active: true, gate: false, gateLength: 77 },
            { active: true }, // Default: gate 1, gateLength 0x3D
          ],
        },
      ],
    });
    const s0 = E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    expect(body[s0 + 3]).toBe(0);
    expect(body[s0 + 4]).toBe(77);
    expect(body[s0 + 12 + 3]).toBe(1);
    expect(body[s0 + 12 + 4]).toBe(0x3d);
  });
});

// ─── 3. Korrumpierte Bänke fallen durch ──────────────────────────────────────

describe("verifyE2AllpatBank — erkennt kaputte Bänke", () => {
  const freshBank = () => new Uint8Array(buildE2AllPatFile([]));

  it("falsche Dateigröße", () => {
    const verdict = verifyE2AllpatBank(freshBank().subarray(0, 1000));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors[0]).toMatch(/Dateigröße/);
  });

  it("zerstörtes PTST-Magic in Slot 3", () => {
    const bank = freshBank();
    bank[e2AllpatSlotOffset(3)] = 0x00;
    const verdict = verifyE2AllpatBank(bank);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.some((e) => e.includes("slot 3") && e.includes("PTST"))).toBe(true);
  });

  it("fehlender PTED-Endmarker", () => {
    const bank = freshBank();
    bank[e2AllpatSlotOffset(0) + E2_PATTERN_PTED_OFFSET] = 0x00;
    const verdict = verifyE2AllpatBank(bank);
    expect(verdict.errors.some((e) => e.includes("PTED"))).toBe(true);
  });

  it("BPM über Gerätemaximum", () => {
    const bank = freshBank();
    const off = e2AllpatSlotOffset(0) + 0x22;
    bank[off] = 0xff;
    bank[off + 1] = 0x7f; // 32767
    const verdict = verifyE2AllpatBank(bank);
    expect(verdict.errors.some((e) => e.includes("BPM"))).toBe(true);
  });

  it("ungültiger Step-Length-Code", () => {
    const bank = freshBank();
    bank[e2AllpatSlotOffset(0) + 0x25] = 2;
    const verdict = verifyE2AllpatBank(bank);
    expect(verdict.errors.some((e) => e.includes("Step-Length"))).toBe(true);
  });

  it("Sample-Ref ins Leere (u16 0xFFFF)", () => {
    const bank = freshBank();
    const off = e2AllpatSlotOffset(0) + E2_PART_TABLE_OFFSET + E2_PART_OSC_REF_OFFSET;
    bank[off] = 0xff;
    bank[off + 1] = 0xff;
    const verdict = verifyE2AllpatBank(bank);
    expect(verdict.errors.some((e) => e.includes("Sample-Ref"))).toBe(true);
  });

  it("ungültige Note (200) und Velocity (200)", () => {
    const bank = freshBank();
    const s0 = e2AllpatSlotOffset(0) + E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    bank[s0 + 1] = 200;
    bank[s0 + 2] = 200;
    const verdict = verifyE2AllpatBank(bank);
    expect(verdict.errors.some((e) => e.includes("Note 200"))).toBe(true);
    expect(verdict.errors.some((e) => e.includes("Velocity 200"))).toBe(true);
  });

  it("Warnung (kein Fehler) bei aktivem Step mit Gate-Länge 0", () => {
    const bank = freshBank();
    const s0 = e2AllpatSlotOffset(0) + E2_PART_TABLE_OFFSET + E2_PART_SEQ_OFFSET;
    bank[s0] = 1; // trigger, Rest bleibt Template-inaktiv (gateLen 0)
    bank[s0 + 2] = 96; // gültige Velocity, damit nur die eine Warnung zählt
    const verdict = verifyE2AllpatBank(bank);
    expect(verdict.errors).toEqual([]);
    expect(verdict.warnings.some((w) => w.includes("Gate-Länge 0"))).toBe(true);
  });

  it("Größenkonstante bleibt konsistent", () => {
    expect(E2S_ALLPAT_FILE_SIZE).toBe(4_161_792);
  });
});
