/**
 * tests/features/korg-esx-patterns.test.ts
 *
 * Unit-Tests fuer ESX-1 Pattern-Parser + Convertor (v3.5.0).
 *
 * Coverage:
 *   - parseEsxPattern: name + bpm + lengthSteps extraction
 *   - isEmptyEsxPattern: erkennt init-Pattern-Signatur
 *   - parseEsxBank: liefert nicht-leere Patterns im patterns-Array
 *   - convertEsxPatternToSynthstudio: 16 Parts gemappt, BPM/Name uebernommen
 *   - esxPartHint: korrektes Label fuer Drum/Synth/Stretch/etc.
 *   - Real-File-Test: parst .esx-Files aus Korg ESX files/ (conditional skip)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseEsxPattern,
  isEmptyEsxPattern,
  parseEsxBank,
  ESX1_PARTS_PER_PATTERN,
  ESX1_DEFAULT_STEPS,
  EsxParseError,
  type EsxPattern,
} from "@/utils/korg/esxParser";
import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_PATTERN,
  ESX1_NUM_PATTERNS,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
  ESX1_EMPTY_OFFSET,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
} from "@/utils/korg/constants";
import {
  convertEsxPatternToSynthstudio,
  convertEsxPatternsToSynthstudio,
  esxPartHint,
} from "@/utils/korg/esxPatternConvert";

// ─── Synthetic Pattern-Block Builder ─────────────────────────────────────────

/**
 * Baut einen 4280-Byte Pattern-Block mit BE-u16 BPM*128 an Offset 8.
 *
 * @param opts.name        Pattern-Name (max 8 chars, NUL-padded)
 * @param opts.bpm         BPM (z.B. 175 → 175*128 = 22400 → 0x5780)
 * @param opts.lengthSteps Step-Count (1..64), default 16
 * @param opts.swing       0..100, default 0
 */
function buildPatternBlock(opts: {
  name: string;
  bpm: number;
  lengthSteps?: number;
  swing?: number;
}): Uint8Array {
  const block = new Uint8Array(ESX1_CHUNKSIZE_PATTERN);
  // Pre-fill with non-zero garbage so init-signature doesn't accidentally match.
  block.fill(0x42);
  // Name
  const nameAscii = (opts.name + "        ").slice(0, 8);
  for (let i = 0; i < 8; i++) block[i] = nameAscii.charCodeAt(i) & 0xff;
  // BPM (BE u16 = bpm × 128)
  const bpmRaw = Math.round(opts.bpm * 128);
  block[8] = (bpmRaw >> 8) & 0xff;
  block[9] = bpmRaw & 0xff;
  // Bytes 10..12: harmless (0x00)
  block[10] = 0x00;
  block[11] = 0x00;
  block[12] = 0x00;
  // Byte 13: step-length - 1
  block[13] = ((opts.lengthSteps ?? 16) - 1) & 0x7f;
  block[14] = 0x00;
  // Byte 15: swing
  block[15] = (opts.swing ?? 0) & 0x7f;
  return block;
}

/** Baut einen 4280-Byte "Init"-Pattern-Block. */
function buildInitPatternBlock(): Uint8Array {
  const block = new Uint8Array(ESX1_CHUNKSIZE_PATTERN);
  // Name: 8 spaces
  for (let i = 0; i < 8; i++) block[i] = 0x20;
  // Init signature at offset 8..19:
  //   3c 00 00 00 00 0f 00 3c 00 00 7f ff
  const sig = [0x3c, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x3c, 0x00, 0x00, 0x7f, 0xff];
  for (let i = 0; i < sig.length; i++) block[8 + i] = sig[i];
  // Rest 0x00 (default für init)
  return block;
}

/**
 * Baut einen minimalen .esx-Buffer mit optionalen Pattern-Bloecken eingebettet.
 * Mono/Stereo-Headers werden alle leer (sentinel) markiert damit nur die
 * Pattern-Logik geprueft wird.
 */
function buildMinimalEsxWithPatterns(patternBlocks: Uint8Array[]): Uint8Array {
  const buf = new Uint8Array(ESX1_SIZE_FILE_MIN + 1024);
  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);
  const dv = new DataView(buf.buffer);
  // Sample-Counters auf 0
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, 0, false);
  // Alle Sample-Headers auf EMPTY_OFFSET
  for (let i = 0; i < 256; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
  }
  for (let i = 0; i < 128; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_STEREO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 16, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 20, ESX1_EMPTY_OFFSET, false);
  }
  // Pattern-Bloecke an die richtige Position kopieren (max ESX1_NUM_PATTERNS)
  for (let i = 0; i < Math.min(patternBlocks.length, ESX1_NUM_PATTERNS); i++) {
    const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
    if (off + ESX1_CHUNKSIZE_PATTERN > buf.length) break;
    buf.set(patternBlocks[i], off);
  }
  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("korg/esxParser — parseEsxPattern (Header-Felder)", () => {
  it("parst Name + BPM aus 4280-Byte Block", () => {
    const block = buildPatternBlock({ name: "Tekk 175", bpm: 175 });
    const pat = parseEsxPattern(block, 0);
    expect(pat).not.toBeNull();
    expect(pat!.name).toBe("Tekk 175");
    expect(pat!.bpm).toBeCloseTo(175, 5);
    expect(pat!.index).toBe(0);
  });

  it("erkennt verschiedene BPMs (120 / 160 / 180)", () => {
    for (const bpm of [120, 160, 180, 220]) {
      const block = buildPatternBlock({ name: `bpm${bpm}`, bpm });
      const pat = parseEsxPattern(block, 1);
      expect(pat).not.toBeNull();
      expect(pat!.bpm).toBeCloseTo(bpm, 3);
    }
  });

  it("klemmt BPM unter 20 auf 20 und ueber 300 auf 300", () => {
    // Bypass buildPatternBlock-Klemmung: direkter Buffer.
    const blockLow = new Uint8Array(ESX1_CHUNKSIZE_PATTERN);
    blockLow[0] = 0x41; // "A" als Name
    blockLow[8] = 0x00;
    blockLow[9] = 0x10; // 16/128 = 0.125 BPM
    blockLow[13] = 0x0f;
    const patLow = parseEsxPattern(blockLow, 0);
    expect(patLow).not.toBeNull();
    expect(patLow!.bpm).toBe(20);

    const blockHigh = new Uint8Array(ESX1_CHUNKSIZE_PATTERN);
    blockHigh[0] = 0x41;
    blockHigh[8] = 0xff;
    blockHigh[9] = 0xff; // ~ 511 BPM
    blockHigh[13] = 0x0f;
    const patHigh = parseEsxPattern(blockHigh, 1);
    expect(patHigh).not.toBeNull();
    expect(patHigh!.bpm).toBe(300);
  });

  it("liefert 16 Parts mit jeweils 16 Step-Slots", () => {
    // v3.14: buildPatternBlock fills mit 0x42 (LSB=0 → inactive). Aber Bytes
    // 24..363 enthalten dann 0x42 in den step-byte-Positionen, was bit 0 = 0
    // bedeutet — also alle Steps inactive. Diese Invariante ist v3.14-konform.
    const block = buildPatternBlock({ name: "X", bpm: 130 });
    const pat = parseEsxPattern(block, 5);
    expect(pat).not.toBeNull();
    expect(pat!.parts.length).toBe(ESX1_PARTS_PER_PATTERN);
    for (const part of pat!.parts) {
      expect(part.steps.length).toBe(ESX1_DEFAULT_STEPS);
      // 0x42 = 0100 0010 → bit 0 = 0 → inactive
      for (const step of part.steps) {
        expect(step.active).toBe(false);
      }
    }
  });

  it("erkennt step-length aus byte 13 (init=0x0F → 16 Steps)", () => {
    const block = buildPatternBlock({ name: "S", bpm: 120, lengthSteps: 16 });
    const pat = parseEsxPattern(block, 0);
    expect(pat!.lengthSteps).toBe(16);

    const block32 = buildPatternBlock({ name: "L", bpm: 120, lengthSteps: 32 });
    const pat32 = parseEsxPattern(block32, 1);
    expect(pat32!.lengthSteps).toBe(32);
  });

  it("wirft EsxParseError bei falscher Block-Groesse", () => {
    expect(() => parseEsxPattern(new Uint8Array(100), 0)).toThrow(EsxParseError);
    expect(() => parseEsxPattern(new Uint8Array(5000), 0)).toThrow(EsxParseError);
  });
});

describe("korg/esxParser — isEmptyEsxPattern", () => {
  it("erkennt init-Pattern als leer", () => {
    const init = buildInitPatternBlock();
    expect(isEmptyEsxPattern(init)).toBe(true);
  });

  it("erkennt User-Pattern als nicht-leer (mit Name)", () => {
    const block = buildPatternBlock({ name: "User", bpm: 130 });
    expect(isEmptyEsxPattern(block)).toBe(false);
  });

  it("erkennt User-Pattern als nicht-leer (ohne Name, anderes Layout)", () => {
    // Nur BPM gesetzt, Name leer — sollte trotzdem als nicht-leer gelten
    // weil bytes 8..19 nicht der init-Signatur entsprechen.
    const block = buildPatternBlock({ name: "", bpm: 175 });
    expect(isEmptyEsxPattern(block)).toBe(false);
  });

  it("parseEsxPattern liefert null fuer init-Pattern", () => {
    const init = buildInitPatternBlock();
    expect(parseEsxPattern(init, 99)).toBeNull();
  });
});

describe("korg/esxParser — parseEsxBank patterns-Array", () => {
  it("liefert leeres patterns-Array wenn alle Bloecke init sind", () => {
    const allInit: Uint8Array[] = [];
    for (let i = 0; i < 5; i++) allInit.push(buildInitPatternBlock());
    const buf = buildMinimalEsxWithPatterns(allInit);
    const bank = parseEsxBank(buf, "test.esx");
    expect(bank.patterns.length).toBe(0);
  });

  it("liefert nur die nicht-leeren Patterns", () => {
    const blocks: Uint8Array[] = [
      buildPatternBlock({ name: "P1", bpm: 120 }),
      buildInitPatternBlock(),
      buildPatternBlock({ name: "P3", bpm: 175 }),
      buildInitPatternBlock(),
    ];
    const buf = buildMinimalEsxWithPatterns(blocks);
    const bank = parseEsxBank(buf, "test.esx");
    expect(bank.patterns.length).toBe(2);
    expect(bank.patterns[0].name).toBe("P1");
    expect(bank.patterns[0].index).toBe(0);
    expect(bank.patterns[1].name).toBe("P3");
    expect(bank.patterns[1].index).toBe(2);
  });
});

describe("korg/esxPatternConvert — Synthstudio-Mapping", () => {
  it("convertEsxPatternToSynthstudio mappt 16 Parts → drumParts", () => {
    const block = buildPatternBlock({ name: "Beat", bpm: 130 });
    const pat = parseEsxPattern(block, 0)!;
    const conv = convertEsxPatternToSynthstudio(pat);
    expect(conv.drumParts.length).toBe(ESX1_PARTS_PER_PATTERN);
    expect(conv.name).toBe("Beat");
    expect(conv.bpm).toBeCloseTo(130, 5);
    expect(conv.stepCount).toBe(16);
    expect(conv.automationLanes).toEqual([]);
  });

  it("Volume/Pan werden normalisiert (0..1 / -1..+1)", () => {
    const pat: EsxPattern = {
      index: 0,
      name: "X",
      bpm: 120,
      lengthSteps: 16,
      swing: 0,
      parts: [
        {
          partIndex: 0,
          sampleId: 5,
          volume: 127,
          pan: 64,
          pitch: 0,
          fxAmount: 0,
          steps: new Array(16).fill(null).map(() => ({ active: false, velocity: 0 })),
        },
        {
          partIndex: 1,
          sampleId: 6,
          volume: 0,
          pan: 127,
          pitch: 0,
          fxAmount: 0,
          steps: new Array(16).fill(null).map(() => ({ active: false, velocity: 0 })),
        },
      ],
    };
    const conv = convertEsxPatternToSynthstudio(pat);
    expect(conv.drumParts[0].volume).toBeCloseTo(1, 5);
    expect(conv.drumParts[0].pan).toBeCloseTo(0, 5);
    expect(conv.drumParts[1].volume).toBe(0);
    expect(conv.drumParts[1].pan).toBeCloseTo(1, 1);
  });

  it("esxPartHint liefert konservative Labels fuer Drum/Stretch/Slice/Synth", () => {
    expect(esxPartHint(0)).toBe("ESX Drum 1");
    expect(esxPartHint(8)).toBe("ESX Drum 9");
    expect(esxPartHint(9)).toBe("ESX Stretch 1");
    expect(esxPartHint(11)).toBe("ESX Slice 1");
    expect(esxPartHint(13)).toBe("ESX Audio-In");
    expect(esxPartHint(14)).toBe("ESX Synth 1");
    expect(esxPartHint(15)).toBe("ESX Synth 2");
  });

  it("convertEsxPatternsToSynthstudio konvertiert Array (Bulk)", () => {
    const block1 = buildPatternBlock({ name: "A", bpm: 120 });
    const block2 = buildPatternBlock({ name: "B", bpm: 140 });
    const p1 = parseEsxPattern(block1, 0)!;
    const p2 = parseEsxPattern(block2, 1)!;
    const conv = convertEsxPatternsToSynthstudio([p1, p2]);
    expect(conv.length).toBe(2);
    expect(conv[0].name).toBe("A");
    expect(conv[1].name).toBe("B");
  });

  it("Empty-Pattern-Name → 'PATTERN_<index+1>'-Fallback", () => {
    const pat: EsxPattern = {
      index: 9,
      name: "",
      bpm: 120,
      lengthSteps: 16,
      swing: 0,
      parts: new Array(16).fill(null).map((_, i) => ({
        partIndex: i,
        sampleId: 0,
        volume: 100,
        pan: 64,
        pitch: 0,
        fxAmount: 0,
        steps: new Array(16).fill(null).map(() => ({ active: false, velocity: 0 })),
      })),
    };
    const conv = convertEsxPatternToSynthstudio(pat);
    expect(conv.name).toBe("PATTERN_10");
  });
});

// ─── Real-File-Tests (conditional skip wenn keine Files vorhanden) ──────────

const REAL_FILES_DIR = path.resolve(__dirname, "../../Korg ESX files");
const hasRealFiles =
  fs.existsSync(REAL_FILES_DIR) && fs.readdirSync(REAL_FILES_DIR).some((f) => f.toLowerCase().endsWith(".esx"));

describe.skipIf(!hasRealFiles)("korg/esxParser — Real-File Pattern-Parsing", () => {
  /**
   * Hilfsfunktion: parst ein Real-File defensive. Manche User-Files knapp
   * ueber der PCM-Cap (24 MB + ein paar Bytes durch Slot-Padding) werfen
   * EsxParseError — diese werden hier als "skip" behandelt damit der Test
   * trotzdem N Files durchprobieren kann.
   */
  function tryParseFile(filePath: string): ReturnType<typeof parseEsxBank> | null {
    try {
      const bytes = fs.readFileSync(filePath);
      return parseEsxBank(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), path.basename(filePath));
    } catch {
      return null;
    }
  }

  it("parst Patterns aus real .esx-Files mit verifizierten BPMs", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    expect(files.length).toBeGreaterThan(0);
    let totalParsed = 0;
    let filesWithPatterns = 0;
    for (const f of files.slice(0, 10)) {
      const bank = tryParseFile(path.join(REAL_FILES_DIR, f));
      if (!bank) continue;
      totalParsed += bank.patterns.length;
      if (bank.patterns.length > 0) filesWithPatterns++;
      for (const pat of bank.patterns) {
        // BPM muss Hardware-plausibel sein
        expect(pat.bpm).toBeGreaterThanOrEqual(20);
        expect(pat.bpm).toBeLessThanOrEqual(300);
        expect(pat.parts.length).toBe(ESX1_PARTS_PER_PATTERN);
      }
    }
    expect(filesWithPatterns).toBeGreaterThan(0);
    expect(totalParsed).toBeGreaterThan(0);
  });

  it("erkennt mindestens ein Pattern mit BPM zwischen 100 und 200 (typisch fuer User-Inhalt)", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    let found = false;
    for (const f of files.slice(0, 10)) {
      const bank = tryParseFile(path.join(REAL_FILES_DIR, f));
      if (!bank) continue;
      for (const pat of bank.patterns) {
        if (pat.bpm >= 100 && pat.bpm <= 200) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });
});

// ─── v3.14: Step-Encoding-Tests ──────────────────────────────────────────────

/**
 * Baut einen Pattern-Block mit explizit gesetzten Step-Trigger-Bytes fuer Part p.
 *
 * @param p      part-index (0..9, sonst ignored)
 * @param mask16 16-bit step-mask: bit i = step i active
 */
function buildPatternBlockWithSteps(
  baseName: string,
  bpm: number,
  p: number,
  mask16: number,
  sampleId = 0x000a,
  level = 100,
  pan = 64,
): Uint8Array {
  const block = buildPatternBlock({ name: baseName, bpm });
  if (p < 0 || p >= 10) return block;
  const partOff = 24 + p * 34;
  // sample-id BE u16
  block[partOff] = (sampleId >> 8) & 0xff;
  block[partOff + 1] = sampleId & 0xff;
  // bytes +2..+3 = ff 00 (per real-file constant)
  block[partOff + 2] = 0xff;
  block[partOff + 3] = 0x00;
  // level @ +9
  block[partOff + 9] = level & 0x7f;
  // pan @ +10
  block[partOff + 10] = pan & 0x7f;
  // 16 step-bytes @ +18: bit 0 = active
  for (let s = 0; s < 16; s++) {
    const active = (mask16 >> s) & 1;
    block[partOff + 18 + s] = active ? 0x01 : 0x00;
  }
  return block;
}

describe("korg/esxParser — v3.14 Step-Encoding (Drum-Parts)", () => {
  it("dekodiert klassisches 4-on-the-floor Kick-Pattern (Part 0)", () => {
    // Steps 0, 4, 8, 12 aktiv → mask 0b0001000100010001 = 0x1111
    const block = buildPatternBlockWithSteps("Kick", 120, 0, 0x1111);
    const pat = parseEsxPattern(block, 0);
    expect(pat).not.toBeNull();
    const part0 = pat!.parts[0];
    expect(part0.steps[0].active).toBe(true);
    expect(part0.steps[4].active).toBe(true);
    expect(part0.steps[8].active).toBe(true);
    expect(part0.steps[12].active).toBe(true);
    expect(part0.steps[1].active).toBe(false);
    expect(part0.steps[2].active).toBe(false);
    const activeCount = part0.steps.filter((s) => s.active).length;
    expect(activeCount).toBe(4);
  });

  it("dekodiert Offbeat-Hat (Part 1, alle ungeraden Steps)", () => {
    // Steps 1,3,5,...,15 → mask 0xAAAA
    const block = buildPatternBlockWithSteps("Hat", 120, 1, 0xaaaa);
    const pat = parseEsxPattern(block, 0);
    const part1 = pat!.parts[1];
    for (let s = 0; s < 16; s++) {
      expect(part1.steps[s].active).toBe(s % 2 === 1);
    }
  });

  it("dekodiert sampleId / volume / pan aus 34-byte Part-Header", () => {
    const block = buildPatternBlockWithSteps("X", 130, 2, 0, 0x002a, 120, 32);
    const pat = parseEsxPattern(block, 0);
    const part2 = pat!.parts[2];
    expect(part2.sampleId).toBe(0x002a);
    expect(part2.volume).toBe(120);
    expect(part2.pan).toBe(32);
  });

  it("erkennt 0x8000 sample-id als unassigned (sampleId === 0)", () => {
    const block = buildPatternBlockWithSteps("X", 130, 3, 0, 0x8000);
    const pat = parseEsxPattern(block, 0);
    expect(pat!.parts[3].sampleId).toBe(0);
  });

  it("Parts 10..14 dekodieren aus dezidierten Offsets (v3.20), Part 15 bleibt Default", () => {
    // v3.20: Pattern-Block ist mit 0x42 vor-gefuellt. Das wirkt sich auf die
    // dezidierten Part-10..14 Offsets aus (0x25C fuer Stretch, 0x36E/8E/AE/CE
    // fuer Sample/Slice/Synth). Wir testen daher hier nur Part 15, das in
    // v3.20 KEIN dezidiertes Layout hat → bleibt Defaults.
    const block = buildPatternBlock({ name: "X", bpm: 120 });
    const pat = parseEsxPattern(block, 0);
    expect(pat).not.toBeNull();
    expect(pat!.parts[15].sampleId).toBe(0);
    expect(pat!.parts[15].volume).toBe(100);
    expect(pat!.parts[15].pan).toBe(64);
    expect(pat!.parts[15].pitch).toBe(0);
    expect(pat!.parts[15].fxAmount).toBe(0);
    for (const step of pat!.parts[15].steps) {
      expect(step.active).toBe(false);
    }
  });

  it("velocity wird auf 100 gesetzt wenn aktiv aber 0x01-rein-binary", () => {
    const block = buildPatternBlockWithSteps("V", 120, 0, 0x0001);
    const pat = parseEsxPattern(block, 0);
    expect(pat!.parts[0].steps[0].active).toBe(true);
    expect(pat!.parts[0].steps[0].velocity).toBe(100); // 0x01 >> 1 = 0 → fallback 100
    expect(pat!.parts[0].steps[1].active).toBe(false);
    expect(pat!.parts[0].steps[1].velocity).toBe(0);
  });
});

// ─── v3.20: Pitch + FxSend + Parts 10..14 Layout ────────────────────────────

/**
 * Erweitert buildPatternBlockWithSteps um pitch+fxSend-Bytes pro Drum-Part.
 *
 * +8  = pitch (signed i8 around 0x40)
 * +11 = fxSend (u8 0..127)
 */
function buildPatternBlockWithPitchFx(
  baseName: string,
  bpm: number,
  p: number,
  pitchSigned: number, // -64..+63
  fxSendU8: number,    // 0..127
  sampleId = 0x000a,
): Uint8Array {
  const block = buildPatternBlockWithSteps(baseName, bpm, p, 0, sampleId);
  if (p < 0 || p >= 10) return block;
  const partOff = 24 + p * 34;
  // Pitch @ +8 (raw byte = pitchSigned + 0x40)
  const pitchClamped = Math.max(-64, Math.min(63, pitchSigned));
  block[partOff + 8] = (pitchClamped + 0x40) & 0xff;
  // FxSend @ +11
  block[partOff + 11] = Math.max(0, Math.min(127, fxSendU8)) & 0x7f;
  return block;
}

describe("korg/esxParser — v3.20 Pitch + FxSend (Drum-Parts)", () => {
  it("dekodiert pitch=0 (neutral) bei Byte 0x40 default", () => {
    // buildPatternBlockWithSteps setzt nicht explizit pitch → bleibt 0x42 (B)
    // aus pre-fill. Wir setzen explizit auf 0x40 fuer einen sauberen Test.
    const block = buildPatternBlockWithPitchFx("N", 120, 0, 0, 0);
    const pat = parseEsxPattern(block, 0);
    expect(pat!.parts[0].pitch).toBe(0);
    expect(pat!.parts[0].fxAmount).toBe(0);
  });

  it("dekodiert positives + negatives Pitch korrekt (signed i8 um 0x40)", () => {
    const blockUp = buildPatternBlockWithPitchFx("U", 120, 0, +12, 0);
    const patUp = parseEsxPattern(blockUp, 0);
    expect(patUp!.parts[0].pitch).toBe(12);
    const blockDown = buildPatternBlockWithPitchFx("D", 120, 0, -24, 0);
    const patDown = parseEsxPattern(blockDown, 0);
    expect(patDown!.parts[0].pitch).toBe(-24);
  });

  it("klammert Pitch auf Hardware-Range -64..+63", () => {
    const blockHigh = buildPatternBlockWithPitchFx("H", 120, 0, +127, 0);
    const patHigh = parseEsxPattern(blockHigh, 0);
    expect(patHigh!.parts[0].pitch).toBe(63);
    // Direkt Byte 0x80 setzen → signed i8 = -128 + 64-offset = -128 → klampt auf -64
    const blockLow = buildPatternBlockWithSteps("L", 120, 0, 0);
    blockLow[24 + 8] = 0x00; // 0x00 = -64 nach subtract 0x40
    const patLow = parseEsxPattern(blockLow, 0);
    expect(patLow!.parts[0].pitch).toBe(-64);
  });

  it("dekodiert FxSend (0..127)", () => {
    const block = buildPatternBlockWithPitchFx("F", 120, 1, 0, 96);
    const pat = parseEsxPattern(block, 0);
    expect(pat!.parts[1].fxAmount).toBe(96);
    const blockMax = buildPatternBlockWithPitchFx("M", 120, 1, 0, 127);
    expect(parseEsxPattern(blockMax, 0)!.parts[1].fxAmount).toBe(127);
  });

  it("FxSend unterscheidet Kick (0) vs HiHat (high) typischen Reverb-Bus-Setup", () => {
    let block = buildPatternBlockWithPitchFx("K", 120, 0, 0, 0); // Kick Part 0
    block = buildPatternBlockWithPitchFx("K", 120, 6, 0, 90); // HiHat Part 6
    // Pre-fill auf 0x42 ueberschreibt Part 0's bytes. Wir bauen seperaten Block:
    const both = buildPatternBlockWithSteps("KH", 120, 0, 0);
    both[24 + 0 * 34 + 8] = 0x40; // Kick pitch neutral
    both[24 + 0 * 34 + 11] = 0x00; // Kick fxSend 0
    both[24 + 6 * 34 + 8] = 0x40;
    both[24 + 6 * 34 + 11] = 0x5a; // HiHat fxSend 90 (Reverb bus)
    const pat = parseEsxPattern(both, 0);
    expect(pat!.parts[0].fxAmount).toBe(0);
    expect(pat!.parts[6].fxAmount).toBe(90);
  });
});

describe("korg/esxParser — v3.20 Stretch (Part 10) + Short-Parts (11..14)", () => {
  function buildBlockWithStretchPart(
    sampleId: number,
    pitchSigned: number,
    level: number,
    pan: number,
    fxSend: number,
    stepsMask: number,
  ): Uint8Array {
    const block = buildPatternBlock({ name: "S", bpm: 120 });
    const partOff = 0x25c;
    block[partOff] = (sampleId >> 8) & 0xff;
    block[partOff + 1] = sampleId & 0xff;
    block[partOff + 2] = 0xff;
    block[partOff + 3] = 0x00;
    block[partOff + 8] = (pitchSigned + 0x40) & 0xff;
    block[partOff + 9] = level & 0x7f;
    block[partOff + 10] = pan & 0x7f;
    block[partOff + 11] = fxSend & 0x7f;
    for (let s = 0; s < 16; s++) {
      block[partOff + 18 + s] = (stepsMask >> s) & 1 ? 0x01 : 0x00;
    }
    return block;
  }

  function buildBlockWithShortPart(
    shortIndex: number, // 0..3 → parts 11..14
    sampleId: number,
    pitchSigned: number,
    level: number,
    pan: number,
    fxSend: number,
    stepsMask: number,
  ): Uint8Array {
    const block = buildPatternBlock({ name: "X", bpm: 120 });
    const SHORT_OFFSETS = [0x36e, 0x38e, 0x3ae, 0x3ce];
    const partOff = SHORT_OFFSETS[shortIndex];
    block[partOff] = (sampleId >> 8) & 0xff;
    block[partOff + 1] = sampleId & 0xff;
    block[partOff + 6] = (pitchSigned + 0x40) & 0xff;
    block[partOff + 7] = level & 0x7f;
    block[partOff + 8] = pan & 0x7f;
    block[partOff + 10] = fxSend & 0x7f;
    for (let s = 0; s < 16; s++) {
      block[partOff + 16 + s] = (stepsMask >> s) & 1 ? 0x01 : 0x00;
    }
    return block;
  }

  it("Part 10 (Stretch) wird aus 34B-Layout @ 0x25C dekodiert", () => {
    // 4-on-the-floor mask
    const block = buildBlockWithStretchPart(0x1f, +3, 120, 64, 64, 0x1111);
    const pat = parseEsxPattern(block, 0);
    expect(pat).not.toBeNull();
    const part10 = pat!.parts[10];
    expect(part10.sampleId).toBe(0x1f);
    expect(part10.pitch).toBe(3);
    expect(part10.volume).toBe(120);
    expect(part10.pan).toBe(64);
    expect(part10.fxAmount).toBe(64);
    expect(part10.steps[0].active).toBe(true);
    expect(part10.steps[4].active).toBe(true);
    expect(part10.steps[8].active).toBe(true);
    expect(part10.steps[12].active).toBe(true);
    const activeCount = part10.steps.filter((s) => s.active).length;
    expect(activeCount).toBe(4);
  });

  it("Parts 11..14 (Short-Parts) verwenden 32B-Stride aus dezidierten Offsets", () => {
    for (let si = 0; si < 4; si++) {
      const partIndex = 11 + si;
      const block = buildBlockWithShortPart(si, 0x42 + si, +5, 100, 64, 80, 0x8888);
      const pat = parseEsxPattern(block, 0);
      expect(pat).not.toBeNull();
      const part = pat!.parts[partIndex];
      expect(part.sampleId).toBe(0x42 + si);
      expect(part.pitch).toBe(5);
      expect(part.volume).toBe(100);
      expect(part.pan).toBe(64);
      expect(part.fxAmount).toBe(80);
      // Steps 3, 7, 11, 15 active
      expect(part.steps[3].active).toBe(true);
      expect(part.steps[7].active).toBe(true);
      expect(part.steps[11].active).toBe(true);
      expect(part.steps[15].active).toBe(true);
    }
  });

  it("0x8000-Sentinel im Short-Part wird als sampleId=0 interpretiert", () => {
    const block = buildBlockWithShortPart(0, 0x8000, 0, 100, 64, 0, 0);
    const pat = parseEsxPattern(block, 0);
    expect(pat!.parts[11].sampleId).toBe(0);
  });

  it("Part 15 (Audio-In) bleibt Defaults — kein Decoder gewired", () => {
    const block = buildPatternBlock({ name: "A", bpm: 120 });
    const pat = parseEsxPattern(block, 0);
    expect(pat!.parts[15].sampleId).toBe(0);
    expect(pat!.parts[15].volume).toBe(100);
    expect(pat!.parts[15].pan).toBe(64);
    expect(pat!.parts[15].fxAmount).toBe(0);
    expect(pat!.parts[15].pitch).toBe(0);
  });
});

describe.skipIf(!hasRealFiles)("korg/esxParser — v3.20 Real-File Pitch/FxSend Variance", () => {
  function tryParseFile(filePath: string): ReturnType<typeof parseEsxBank> | null {
    try {
      const bytes = fs.readFileSync(filePath);
      return parseEsxBank(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), path.basename(filePath));
    } catch {
      return null;
    }
  }

  it("findet Real-Patterns mit non-default pitch (≠0) ODER non-default fxSend (>0)", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    let foundPitch = false;
    let foundFx = false;
    let allParts = 0;
    for (const f of files.slice(0, 5)) {
      const bank = tryParseFile(path.join(REAL_FILES_DIR, f));
      if (!bank) continue;
      for (const pat of bank.patterns.slice(0, 10)) {
        for (let p = 0; p < 11; p++) {
          // include Stretch (part 10) too
          allParts++;
          if (pat.parts[p].pitch !== 0) foundPitch = true;
          if (pat.parts[p].fxAmount > 0) foundFx = true;
        }
      }
      if (foundPitch && foundFx) break;
    }
    expect(allParts).toBeGreaterThan(0);
    // Real-File-Variance: in BOTTROP alone hat ~10 % der Parts pitch != 0
    // (signed-i8 around 0x40). FxSend > 0 ist in fast jedem File.
    expect(foundPitch || foundFx).toBe(true);
  });

  it("Pitch + FxSend bleiben in Hardware-Range (-64..+63 / 0..127)", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    let totalChecked = 0;
    for (const f of files.slice(0, 5)) {
      const bank = tryParseFile(path.join(REAL_FILES_DIR, f));
      if (!bank) continue;
      for (const pat of bank.patterns.slice(0, 5)) {
        for (const part of pat.parts) {
          expect(part.pitch).toBeGreaterThanOrEqual(-64);
          expect(part.pitch).toBeLessThanOrEqual(63);
          expect(part.fxAmount).toBeGreaterThanOrEqual(0);
          expect(part.fxAmount).toBeLessThanOrEqual(127);
          totalChecked++;
        }
      }
    }
    expect(totalChecked).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasRealFiles)("korg/esxParser — v3.14 Real-File Step-Decoding", () => {
  function tryParseFile(filePath: string): ReturnType<typeof parseEsxBank> | null {
    try {
      const bytes = fs.readFileSync(filePath);
      return parseEsxBank(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), path.basename(filePath));
    } catch {
      return null;
    }
  }

  it("findet mindestens ein Pattern mit aktiven Step-Triggers in den Drum-Parts", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    let foundActiveSteps = false;
    let totalActiveSteps = 0;
    for (const f of files.slice(0, 10)) {
      const bank = tryParseFile(path.join(REAL_FILES_DIR, f));
      if (!bank || bank.patterns.length === 0) continue;
      for (const pat of bank.patterns.slice(0, 5)) {
        for (let p = 0; p < 10; p++) {
          const activeCount = pat.parts[p].steps.filter((s) => s.active).length;
          totalActiveSteps += activeCount;
          if (activeCount > 0) foundActiveSteps = true;
        }
      }
      if (foundActiveSteps) break;
    }
    expect(foundActiveSteps).toBe(true);
    expect(totalActiveSteps).toBeGreaterThan(0);
  });

  it("identifiziert plausible Drum-Patterns (mind. 1 Part mit 1..16 aktiven Steps)", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    let plausibleCount = 0;
    for (const f of files.slice(0, 5)) {
      const bank = tryParseFile(path.join(REAL_FILES_DIR, f));
      if (!bank) continue;
      for (const pat of bank.patterns.slice(0, 10)) {
        // Plausible: mindestens 1 Part hat 1-16 aktive Steps (kein "alles aus", aber nicht > 16)
        let hasPlausiblePart = false;
        for (let p = 0; p < 10; p++) {
          const cnt = pat.parts[p].steps.filter((s) => s.active).length;
          if (cnt >= 1 && cnt <= 16) {
            hasPlausiblePart = true;
            break;
          }
        }
        if (hasPlausiblePart) plausibleCount++;
      }
    }
    expect(plausibleCount).toBeGreaterThan(0);
  });
});

// ─── v3.23.0: Step-Byte Accent-Flag (bit-4) ──────────────────────────────────

/**
 * Setzt das step-byte fuer Drum-Part `p`, Step `s` direkt (raw byte).
 * Erlaubt explizite Tests von 0x01 (active), 0x11 (active+accent), 0x55 etc.
 */
function setDrumStepByteRaw(
  block: Uint8Array,
  p: number,
  s: number,
  value: number,
): void {
  const partOff = 24 + p * 34;
  block[partOff + 18 + s] = value & 0xff;
}

/** Setzt das step-byte fuer Short-Part `shortIndex` (0..3 → parts 11..14). */
function setShortStepByteRaw(
  block: Uint8Array,
  shortIndex: number,
  s: number,
  value: number,
): void {
  const SHORT_OFFSETS = [0x36e, 0x38e, 0x3ae, 0x3ce];
  const partOff = SHORT_OFFSETS[shortIndex];
  block[partOff + 16 + s] = value & 0xff;
}

describe("korg/esxParser — v3.23 Accent (Drum-Parts)", () => {
  it("0x01 (bit-0 only) → active=true, accent=false, velocity=100", () => {
    const block = buildPatternBlockWithSteps("A", 120, 0, 0);
    setDrumStepByteRaw(block, 0, 0, 0x01);
    const pat = parseEsxPattern(block, 0);
    const step = pat!.parts[0].steps[0];
    expect(step.active).toBe(true);
    expect(step.accent).toBe(false);
    expect(step.velocity).toBe(100);
  });

  it("0x11 (bit-0 + bit-4) → active=true, accent=true, velocity=127", () => {
    const block = buildPatternBlockWithSteps("A", 120, 0, 0);
    setDrumStepByteRaw(block, 0, 0, 0x11);
    const pat = parseEsxPattern(block, 0);
    const step = pat!.parts[0].steps[0];
    expect(step.active).toBe(true);
    expect(step.accent).toBe(true);
    expect(step.velocity).toBe(127);
  });

  it("0x55 (bits 0+2+4+6) → active=true, accent=true (bit-4 set)", () => {
    const block = buildPatternBlockWithSteps("A", 120, 0, 0);
    setDrumStepByteRaw(block, 0, 0, 0x55);
    const pat = parseEsxPattern(block, 0);
    const step = pat!.parts[0].steps[0];
    expect(step.active).toBe(true);
    expect(step.accent).toBe(true);
    expect(step.velocity).toBe(127);
  });

  it("0x15 (bits 0+2+4) → active+accent (bit-4 set, bit-2 ignored)", () => {
    const block = buildPatternBlockWithSteps("A", 120, 0, 0);
    setDrumStepByteRaw(block, 0, 0, 0x15);
    const pat = parseEsxPattern(block, 0);
    const step = pat!.parts[0].steps[0];
    expect(step.active).toBe(true);
    expect(step.accent).toBe(true);
  });

  it("0x10 (bit-4 only, kein trigger) → active=false (accent ignoriert)", () => {
    const block = buildPatternBlockWithSteps("A", 120, 0, 0);
    setDrumStepByteRaw(block, 0, 0, 0x10);
    const pat = parseEsxPattern(block, 0);
    const step = pat!.parts[0].steps[0];
    expect(step.active).toBe(false);
    expect(step.velocity).toBe(0);
    // accent darf nicht gesetzt sein, wenn step inaktiv
    expect(step.accent).toBeUndefined();
  });

  it("0x00 (kein trigger) → active=false, velocity=0, accent=undefined", () => {
    const block = buildPatternBlockWithSteps("A", 120, 0, 0);
    setDrumStepByteRaw(block, 0, 0, 0x00);
    const pat = parseEsxPattern(block, 0);
    const step = pat!.parts[0].steps[0];
    expect(step.active).toBe(false);
    expect(step.velocity).toBe(0);
    expect(step.accent).toBeUndefined();
  });

  it("mischt accent + non-accent steps korrekt in einem Pattern", () => {
    // BOTTROP-style: '01 11 00 11 01 11 00 11 ...' alternierend
    const block = buildPatternBlockWithSteps("MIX", 120, 2, 0);
    setDrumStepByteRaw(block, 2, 0, 0x01); // no accent
    setDrumStepByteRaw(block, 2, 1, 0x11); // accent
    setDrumStepByteRaw(block, 2, 2, 0x00); // off
    setDrumStepByteRaw(block, 2, 3, 0x11); // accent
    const pat = parseEsxPattern(block, 0);
    const steps = pat!.parts[2].steps;
    expect(steps[0].active).toBe(true);
    expect(steps[0].accent).toBe(false);
    expect(steps[1].active).toBe(true);
    expect(steps[1].accent).toBe(true);
    expect(steps[2].active).toBe(false);
    expect(steps[3].active).toBe(true);
    expect(steps[3].accent).toBe(true);
  });
});

describe("korg/esxParser — v3.23 Accent (Short-Parts 11..14)", () => {
  it("Short-Part-Steps haben dieselbe accent-Decoding-Logik", () => {
    const block = buildPatternBlock({ name: "S", bpm: 120 });
    setShortStepByteRaw(block, 0, 0, 0x01); // part 11 step 0: active, no accent
    setShortStepByteRaw(block, 0, 4, 0x11); // part 11 step 4: active + accent
    setShortStepByteRaw(block, 2, 0, 0x11); // part 13 (synth) step 0: accent
    const pat = parseEsxPattern(block, 0);
    expect(pat!.parts[11].steps[0].active).toBe(true);
    expect(pat!.parts[11].steps[0].accent).toBe(false);
    expect(pat!.parts[11].steps[4].active).toBe(true);
    expect(pat!.parts[11].steps[4].accent).toBe(true);
    expect(pat!.parts[11].steps[4].velocity).toBe(127);
    expect(pat!.parts[13].steps[0].accent).toBe(true);
  });
});

describe("korg/esxParser — v3.23 Synth-Note-Encoding NICHT exportiert", () => {
  it("EsxStepEvent hat KEIN `note`-Feld (RE widerlegt — siehe Header-Doc v3.23)", () => {
    const block = buildPatternBlockWithSteps("N", 120, 0, 0);
    setDrumStepByteRaw(block, 0, 0, 0x55); // exotic value
    const pat = parseEsxPattern(block, 0);
    const step = pat!.parts[0].steps[0] as { note?: number };
    expect(step.note).toBeUndefined();
  });

  it("Drum-Parts und Short-Parts liefern KEINEN note-Wert (konservativ)", () => {
    const block = buildPatternBlock({ name: "X", bpm: 120 });
    setDrumStepByteRaw(block, 5, 0, 0x11);
    setShortStepByteRaw(block, 2, 0, 0x55);
    const pat = parseEsxPattern(block, 0);
    for (const part of pat!.parts) {
      for (const step of part.steps as Array<{ note?: number }>) {
        expect(step.note).toBeUndefined();
      }
    }
  });
});

describe.skipIf(!hasRealFiles)("korg/esxParser — v3.23 Real-File Accent-Stats", () => {
  it("findet active steps mit accent=true in mindestens einem Real-File", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    let foundAccent = false;
    let accentCount = 0;
    let activeCount = 0;
    for (const f of files.slice(0, 5)) {
      try {
        const bytes = fs.readFileSync(path.join(REAL_FILES_DIR, f));
        const bank = parseEsxBank(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          f,
        );
        for (const pat of bank.patterns.slice(0, 20)) {
          for (let p = 0; p < 15; p++) {
            for (const step of pat.parts[p].steps) {
              if (step.active) {
                activeCount++;
                if (step.accent === true) {
                  accentCount++;
                  foundAccent = true;
                }
              }
            }
          }
        }
        if (foundAccent && accentCount > 10) break;
      } catch {
        // ignore corrupt files
      }
    }
    expect(activeCount).toBeGreaterThan(0);
    expect(foundAccent).toBe(true);
    // Aus Hex-Diff-Analyse: ~70% Drum + ~38% Short → mind. 25% gesamt erwartet.
    expect(accentCount / activeCount).toBeGreaterThan(0.2);
  });

  it("alle accent=true Steps haben velocity=127 (TR-style boost)", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.toLowerCase().endsWith(".esx"));
    let checked = 0;
    let mismatched = 0;
    outer: for (const f of files.slice(0, 3)) {
      try {
        const bytes = fs.readFileSync(path.join(REAL_FILES_DIR, f));
        const bank = parseEsxBank(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          f,
        );
        for (const pat of bank.patterns.slice(0, 10)) {
          for (let p = 0; p < 15; p++) {
            for (const step of pat.parts[p].steps) {
              if (step.active && step.accent === true) {
                checked++;
                if (step.velocity !== 127) mismatched++;
                if (checked >= 200) break outer;
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(mismatched).toBe(0);
  });
});
