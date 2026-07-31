/**
 * e2AllpatVerify.ts — Struktur-Validator für .e2sallpat-Bänke (v3.307).
 *
 * Jede Regel hier ist gegen die verifiziert korrekte Werksbank
 * `e2s-2016.e2sallpat` (250 echte Factory-Patterns, 4 161 792 Bytes) geprüft —
 * nicht gegen unsere eigene Doku. Differenzielle Befunde aus der Analyse
 * (2026-07-31, alle 250 Bodies):
 *
 *   - Prefix: "KORG"@0 + "e2sampler"@0x10 + u32-Version 1 @0x20, 0xFF-Pad bis
 *     0x100; GLST@0x100…GLED@0x1FC; 0xFF-Pad 0x200..0x10100.
 *   - Jeder Body: "PTST" + 12×0x00 @ +0x000; "PTED" @ +0x3BFC; Null-Pad bis
 *     +0x4000. Beides in allen 250 Bodies exakt an dieser Stelle.
 *   - BPM (u16 LE @ +0x22) ≤ 3000; Step-Length-Code @ +0x25 ∈ {0, 1, 3}.
 *   - Part-Sample-Ref (u16 LE @ part+0x08): Stock max 419, Gerät kennt ≤ 999.
 *   - Step-Records (12 B): trigger ∈ {0,1}; Note ≤ 127 oder 0xFF ("kein neuer
 *     Ton", 15 177× im Stock); Velocity 1..127 (nie 0); Gate-Länge ≤ 127
 *     (Stock-Spanne 0..106); Chord-Noten-Bytes 5..7 ≤ 127; Bytes 8..11 == 0
 *     (256 000 Records, ausnahmslos).
 *
 * Warnungen (Stock-untypisch, aber vom Gerät toleriert):
 *   - aktiver Step mit Gate-Länge 0 (Stock: 17 von 43 099 aktiven Steps),
 *   - aktiver Step mit Velocity 0 (Stock: nie).
 *
 * Bewusst NICHT geprüft: Byte 3 (Gate-Flag) — die Stock-Bank hat 38 % aktive
 * Steps mit Gate-Flag 0, ein "muss 1 sein" wäre falsch.
 */

import {
  E2_ALLPAT_FILE_SIZE,
  E2_ALLPAT_SLOT_COUNT,
  E2_PATTERN_BODY_SIZE,
  E2_PATTERN_BPM_OFFSET,
  E2_PATTERN_STEPLEN_OFFSET,
  E2_PART_TABLE_OFFSET,
  E2_PART_COUNT,
  E2_PART_STRIDE,
  E2_PART_OSC_REF_OFFSET,
  E2_PART_SEQ_OFFSET,
  E2_STEP_RECORD_SIZE,
  E2_STEPS_PER_PART,
  E2_MAX_SAMPLE_REF,
  e2AllpatSlotOffset,
} from "./e2Layout";

/** Body-relatives "PTED"-Offset — in allen 250 Stock-Bodies identisch. */
export const E2_PATTERN_PTED_OFFSET = 0x3bfc;
/** Sentinel im Noten-Byte: "kein neuer Ton" (Tie). */
export const E2_NOTE_TIE_SENTINEL = 0xff;

export interface E2AllpatVerifyResult {
  ok: boolean;
  /** Strukturfehler — eine Bank mit errors darf nicht aufs Gerät. */
  errors: string[];
  /** Stock-untypische Werte — Hinweis, kein Blocker. */
  warnings: string[];
}

const ASCII = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const KORG = ASCII("KORG");
const E2SAMPLER = ASCII("e2sampler");
const GLST = ASCII("GLST");
const GLED = ASCII("GLED");
const PTST = ASCII("PTST");
const PTED = ASCII("PTED");

function bytesAt(u8: Uint8Array, off: number, expect: number[]): boolean {
  for (let i = 0; i < expect.length; i++)
    if (u8[off + i] !== expect[i]) return false;
  return true;
}

/**
 * Prüft einen einzelnen 16384-Byte-Pattern-Body. `label` erscheint in den
 * Meldungen (z. B. "slot 17"). Fehler/Warnungen werden an die übergebenen
 * Arrays angehängt.
 */
export function verifyE2PatternBody(
  body: Uint8Array,
  label: string,
  errors: string[],
  warnings: string[]
): void {
  if (body.length !== E2_PATTERN_BODY_SIZE) {
    errors.push(`${label}: body ist ${body.length} statt ${E2_PATTERN_BODY_SIZE} Bytes`);
    return;
  }
  if (!bytesAt(body, 0, PTST)) {
    errors.push(`${label}: "PTST"-Magic fehlt`);
    return; // ohne Magic ist alles Weitere Rauschen
  }
  for (let i = 4; i < 0x10; i++) {
    if (body[i] !== 0) {
      errors.push(`${label}: Byte ${i} nach PTST-Magic ist ${body[i]}, erwartet 0`);
      break;
    }
  }
  if (!bytesAt(body, E2_PATTERN_PTED_OFFSET, PTED)) {
    errors.push(`${label}: "PTED"-Endmarker fehlt @ +0x3bfc`);
  }
  for (let i = E2_PATTERN_PTED_OFFSET + 4; i < E2_PATTERN_BODY_SIZE; i++) {
    if (body[i] !== 0) {
      errors.push(`${label}: Null-Padding nach PTED verletzt @ +0x${i.toString(16)}`);
      break;
    }
  }

  const bpmX10 = body[E2_PATTERN_BPM_OFFSET] | (body[E2_PATTERN_BPM_OFFSET + 1] << 8);
  if (bpmX10 > 3000) {
    errors.push(`${label}: BPM×10 = ${bpmX10} > 3000 (Gerätemaximum 300.0)`);
  }
  const stepLen = body[E2_PATTERN_STEPLEN_OFFSET];
  if (stepLen !== 0 && stepLen !== 1 && stepLen !== 3) {
    errors.push(`${label}: Step-Length-Code ${stepLen} ∉ {0,1,3}`);
  }

  for (let p = 0; p < E2_PART_COUNT; p++) {
    const partOff = E2_PART_TABLE_OFFSET + p * E2_PART_STRIDE;
    const ref =
      body[partOff + E2_PART_OSC_REF_OFFSET] |
      (body[partOff + E2_PART_OSC_REF_OFFSET + 1] << 8);
    if (ref > E2_MAX_SAMPLE_REF) {
      errors.push(
        `${label} part ${p}: Sample-Ref ${ref} > ${E2_MAX_SAMPLE_REF} (existiert auf keinem Gerät)`
      );
    }

    for (let s = 0; s < E2_STEPS_PER_PART; s++) {
      const so = partOff + E2_PART_SEQ_OFFSET + s * E2_STEP_RECORD_SIZE;
      const trigger = body[so];
      if (trigger > 1) {
        errors.push(`${label} part ${p} step ${s}: trigger-Byte ${trigger} ∉ {0,1}`);
        continue;
      }
      const note = body[so + 1];
      if (note > 127 && note !== E2_NOTE_TIE_SENTINEL) {
        errors.push(`${label} part ${p} step ${s}: Note ${note} ungültig (0..127 oder 0xFF)`);
      }
      if (body[so + 2] > 127) {
        errors.push(`${label} part ${p} step ${s}: Velocity ${body[so + 2]} > 127`);
      }
      const gateLen = body[so + 4];
      if (gateLen > 127) {
        errors.push(`${label} part ${p} step ${s}: Gate-Länge ${gateLen} > 127`);
      }
      for (let k = 5; k <= 7; k++) {
        if (body[so + k] > 127) {
          errors.push(
            `${label} part ${p} step ${s}: Chord-Noten-Byte ${k} = ${body[so + k]} > 127`
          );
        }
      }
      for (let k = 8; k < 12; k++) {
        if (body[so + k] !== 0) {
          errors.push(`${label} part ${p} step ${s}: Reserved-Byte ${k} = ${body[so + k]} ≠ 0`);
          break;
        }
      }
      if (trigger === 1) {
        if (gateLen === 0) {
          warnings.push(`${label} part ${p} step ${s}: aktiver Step mit Gate-Länge 0`);
        }
        if (body[so + 2] === 0) {
          warnings.push(`${label} part ${p} step ${s}: aktiver Step mit Velocity 0`);
        }
      }
    }
  }
}

/**
 * Vollständige Struktur-Validierung einer .e2sallpat-Bank gegen die
 * stock-verifizierten Invarianten. Läuft in <100 ms über die volle Bank und
 * gehört VOR jeden Datei-Save eines Bank-Exports.
 */
export function verifyE2AllpatBank(
  buffer: ArrayBuffer | Uint8Array
): E2AllpatVerifyResult {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (u8.length !== E2_ALLPAT_FILE_SIZE) {
    errors.push(`Dateigröße ${u8.length} ≠ ${E2_ALLPAT_FILE_SIZE}`);
    return { ok: false, errors, warnings };
  }
  if (!bytesAt(u8, 0, KORG)) errors.push(`"KORG"-Magic fehlt @ 0x0`);
  if (!bytesAt(u8, 0x10, E2SAMPLER)) errors.push(`"e2sampler"-Kennung fehlt @ 0x10`);
  if (u8[0x20] !== 1 || u8[0x21] !== 0 || u8[0x22] !== 0 || u8[0x23] !== 0) {
    errors.push(`Header-Version @ 0x20 ist nicht 1`);
  }
  for (let i = 0x24; i < 0x100; i++) {
    if (u8[i] !== 0xff) {
      errors.push(`Header-Padding verletzt @ 0x${i.toString(16)} (${u8[i]} ≠ 0xFF)`);
      break;
    }
  }
  if (!bytesAt(u8, 0x100, GLST)) errors.push(`"GLST"-Block fehlt @ 0x100`);
  if (!bytesAt(u8, 0x1fc, GLED)) errors.push(`"GLED"-Endmarker fehlt @ 0x1FC`);
  for (let i = 0x200; i < e2AllpatSlotOffset(0); i++) {
    if (u8[i] !== 0xff) {
      errors.push(`Prefix-Padding verletzt @ 0x${i.toString(16)} (${u8[i]} ≠ 0xFF)`);
      break;
    }
  }

  for (let slot = 0; slot < E2_ALLPAT_SLOT_COUNT; slot++) {
    const off = e2AllpatSlotOffset(slot);
    verifyE2PatternBody(
      u8.subarray(off, off + E2_PATTERN_BODY_SIZE),
      `slot ${slot}`,
      errors,
      warnings
    );
    // Eine kaputte Bank produziert sonst zehntausende Folgemeldungen.
    if (errors.length > 50) {
      errors.push(`… Abbruch nach 50 Fehlern (${slot + 1}/${E2_ALLPAT_SLOT_COUNT} Slots geprüft)`);
      break;
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
