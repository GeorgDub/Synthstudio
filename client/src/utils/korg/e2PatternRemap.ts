/**
 * e2PatternRemap.ts — Osc/Sample-Referenz-Remapping in Pattern-Bodies und
 * .all/.e2sallpat-Containern (hacktribe „≥501"-Pflicht).
 *
 * Hintergrund: hacktribe verbietet die Nutzung der Factory-Sample-Slots (1–500,
 * human). Samples müssen in den User-Bereich 501–1000 verschoben werden; danach
 * müssen ALLE Pattern-Parts, die auf die alten Slots zeigen, umgeschrieben werden.
 * bangcorrupts CLI-Skripte (e2_recode_sample_pat.py, e2_update_pat_samples.py)
 * tun genau das — hier host-seitig, bit-exakt nach denselben Offsets.
 *
 * Verifizierte Offsets (aus beiden Skripten, wörtlich):
 *   .all/allpat: Pattern i @ 0x10100 + i*0x4000, Part k @ +0x800 + k*0x330,
 *   Osc-Ref u16 LE @ Part+0x08. 250 Patterns, 16 Parts.
 *   Einzel-Body (post-Header, wie per SysEx gepullt): Part-Tabelle @ 0x800.
 *
 * Diese Datei macht NUR die Pattern-Seite (Osc-Refs). Das Umschreiben der
 * Sample-Blöcke (RIFF/ESLI-Slot-Nummern) im .all bleibt Sache des .all-Builders.
 */
import {
  PART_COUNT,
  PART_TABLE_OFFSET,
  PART_STRIDE,
  PART_OSC_REF_OFFSET,
} from "./e2Sysex";

// ─── .all / .e2sallpat Container-Layout ──────────────────────────────────────
export const ALLPAT_PATTERN_OFFSET = 0x10100; // 0x100 Header + 0x10000 Filler
export const ALLPAT_PATTERN_STRIDE = 0x4000;
export const ALLPAT_PATTERN_COUNT = 250;

/** Grenzen des Osc-Adressraums. 0..17 = Synth-Modelle, 18+ = Samples. */
export const SYNTH_OSC_MAX = 17;
export const FACTORY_SAMPLE_MIN = 18; // erster Sample-Slot (machine)
export const FACTORY_SAMPLE_MAX = 500; // letzter Factory-Slot (machine)
export const OSC_SLOT_MAX = 999; // letzter gültiger Slot (machine, human 1000)

export type OscMapping = Map<number, number> | Record<number, number>;

function lookup(mapping: OscMapping, osc: number): number | undefined {
  if (mapping instanceof Map) return mapping.get(osc);
  return Object.prototype.hasOwnProperty.call(mapping, osc)
    ? mapping[osc]
    : undefined;
}

function readU16LE(buf: Uint8Array, off: number): number {
  return off + 1 < buf.length ? buf[off] | (buf[off + 1] << 8) : 0;
}
function writeU16LE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
}

/**
 * Schreibt die Osc-Refs der 16 Parts eines Einzel-Body (0x4000, post-Header)
 * gemäß `mapping` um. Nicht-destruktive Kopie; nicht gemappte Refs bleiben.
 */
export function remapOscRefsInBody(
  body: Uint8Array,
  mapping: OscMapping
): Uint8Array {
  const out = body.slice();
  for (let p = 0; p < PART_COUNT; p++) {
    const off = PART_TABLE_OFFSET + p * PART_STRIDE + PART_OSC_REF_OFFSET;
    if (off + 1 >= out.length) break;
    const cur = readU16LE(out, off);
    const next = lookup(mapping, cur);
    if (next !== undefined && next !== cur) writeU16LE(out, off, next);
  }
  return out;
}

/**
 * Schreibt die Osc-Refs aller 250 Patterns × 16 Parts eines .all/.e2sallpat-
 * Containers um. Nicht-destruktive Kopie.
 */
export function remapOscRefsInAllpat(
  buffer: Uint8Array,
  mapping: OscMapping
): Uint8Array {
  const out = buffer.slice();
  for (let i = 0; i < ALLPAT_PATTERN_COUNT; i++) {
    const patBase = ALLPAT_PATTERN_OFFSET + i * ALLPAT_PATTERN_STRIDE;
    for (let k = 0; k < PART_COUNT; k++) {
      const off =
        patBase + PART_TABLE_OFFSET + k * PART_STRIDE + PART_OSC_REF_OFFSET;
      if (off + 1 >= out.length) return out;
      const cur = readU16LE(out, off);
      const next = lookup(mapping, cur);
      if (next !== undefined && next !== cur) writeU16LE(out, off, next);
    }
  }
  return out;
}

/** Sammelt die distinct Osc-Refs, die in einem .all-Container genutzt werden. */
export function collectAllpatOscRefs(buffer: Uint8Array): number[] {
  const used = new Set<number>();
  for (let i = 0; i < ALLPAT_PATTERN_COUNT; i++) {
    const patBase = ALLPAT_PATTERN_OFFSET + i * ALLPAT_PATTERN_STRIDE;
    for (let k = 0; k < PART_COUNT; k++) {
      const off =
        patBase + PART_TABLE_OFFSET + k * PART_STRIDE + PART_OSC_REF_OFFSET;
      if (off + 1 >= buffer.length) break;
      used.add(readU16LE(buffer, off));
    }
  }
  return [...used].sort((a, b) => a - b);
}

export interface FactoryShiftResult {
  /** old-osc → new-osc (nur wo sich etwas ändert; Identität bleibt implizit). */
  mapping: Map<number, number>;
  /** Factory-Oscs, für die kein User-Slot mehr frei war (> 999). */
  overflow: number[];
}

/**
 * Baut die hacktribe-Standard-Umbelegung: verwendete Factory-Sample-Oscs
 * (18..500) werden sequentiell in den User-Bereich ab `500 + offset` (machine)
 * gelegt. Synth-Oscs (≤17) und bereits im User-Bereich liegende (≥501) bleiben.
 *
 * `offset` (Default 18) entspricht bangcorrupts `--ofs 18`: die Factory-Samples
 * landen ab Slot 518 (machine) / 519 (human), was das Wiederfinden erleichtert.
 * Läuft der User-Bereich über (Slot > 999), landen die restlichen Oscs in
 * `overflow` und werden NICHT gemappt (kein still-kollidierendes Wrapping).
 */
export function buildFactoryShiftMap(
  usedOscs: number[],
  offset = 18
): FactoryShiftResult {
  const mapping = new Map<number, number>();
  const overflow: number[] = [];
  const factory = usedOscs
    .filter(o => o >= FACTORY_SAMPLE_MIN && o <= FACTORY_SAMPLE_MAX)
    .sort((a, b) => a - b);
  let slot = FACTORY_SAMPLE_MAX + (Math.abs(Math.floor(offset)) % 500);
  for (const osc of factory) {
    if (slot > OSC_SLOT_MAX) {
      overflow.push(osc);
      continue;
    }
    if (slot !== osc) mapping.set(osc, slot);
    slot += 1;
  }
  return { mapping, overflow };
}
