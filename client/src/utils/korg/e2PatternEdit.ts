/**
 * e2PatternEdit.ts — Nicht-destruktive Feld-Editoren auf einem gepullten
 * Pattern-Body (0x4000, post-Header). Erlaubt gezieltes Ändern der bereits
 * VERIFIZIERTEN Felder und Zurückschreiben über die Bridge (0x40/0x4C).
 *
 * Wie beim IFX/Groove-Editor: jeder Setter kopiert und rührt NUR die adressierten
 * Bytes an. Alle unbekannten/opaken Bytes (inkl. der Motion-Region +0x05..+0x0B)
 * bleiben exakt erhalten → round-trip-safe. Es werden ausschließlich Offsets
 * benutzt, die in e2Sysex.ts gegen echte Daten verifiziert sind — keine
 * geratenen Part-Struct-Felder (Filter/EG etc. sind bewusst NICHT dabei).
 */
import {
  PART_COUNT,
  PART_TABLE_OFFSET,
  PART_STRIDE,
  PART_OSC_REF_OFFSET,
  PART_VOLUME_OFFSET,
  PART_PAN_OFFSET,
  PART_SEQ_OFFSET,
  PART_SEQ_STEP_SIZE,
  STEPS_PER_PART,
  STEP_TRIGGER_OFFSET,
  STEP_NOTE_OFFSET,
  STEP_VELOCITY_OFFSET,
  STEP_GATE_OFFSET,
  STEP_GATELEN_OFFSET,
  PATTERN_NAME_OFFSET,
  PATTERN_NAME_LEN,
  PATTERN_BPM_OFFSET,
} from "./e2Sysex";

const clamp7 = (n: number) => Math.max(0, Math.min(127, Math.floor(n) || 0));
const clampU8 = (n: number) => Math.max(0, Math.min(255, Math.floor(n) || 0));

function partBase(part: number): number {
  return PART_TABLE_OFFSET + part * PART_STRIDE;
}
function stepBase(part: number, step: number): number {
  return partBase(part) + PART_SEQ_OFFSET + step * PART_SEQ_STEP_SIZE;
}

export type StepField = "active" | "note" | "velocity" | "gate" | "gateLen";

/**
 * Setzt ein Step-Feld (nicht-destruktive Kopie). `active`/`gate` sind Flags
 * (0/nicht-0). Note/Velocity 0..127, gateLen 0..255. Motion-Bytes bleiben.
 */
export function setStepField(
  body: Uint8Array,
  part: number,
  step: number,
  field: StepField,
  value: number
): Uint8Array {
  const out = body.slice();
  if (part < 0 || part >= PART_COUNT || step < 0 || step >= STEPS_PER_PART) {
    return out;
  }
  const base = stepBase(part, step);
  switch (field) {
    case "active":
      out[base + STEP_TRIGGER_OFFSET] = value ? 1 : 0;
      break;
    case "note":
      out[base + STEP_NOTE_OFFSET] = clamp7(value);
      break;
    case "velocity":
      out[base + STEP_VELOCITY_OFFSET] = clamp7(value);
      break;
    case "gate":
      out[base + STEP_GATE_OFFSET] = value ? 1 : 0;
      break;
    case "gateLen":
      out[base + STEP_GATELEN_OFFSET] = clampU8(value);
      break;
  }
  return out;
}

export type PartField = "volume" | "pan" | "sampleRef";

/**
 * Setzt ein Part-Feld (nicht-destruktive Kopie). volume/pan 0..127 (pan 64 =
 * Mitte), sampleRef als u16 LE (Osc/Sample-Nummer, 0..999+).
 */
export function setPartField(
  body: Uint8Array,
  part: number,
  field: PartField,
  value: number
): Uint8Array {
  const out = body.slice();
  if (part < 0 || part >= PART_COUNT) return out;
  const base = partBase(part);
  if (field === "volume") {
    out[base + PART_VOLUME_OFFSET] = clamp7(value);
  } else if (field === "pan") {
    out[base + PART_PAN_OFFSET] = clamp7(value);
  } else {
    const v = Math.max(0, Math.min(0xffff, Math.floor(value) || 0));
    out[base + PART_OSC_REF_OFFSET] = v & 0xff;
    out[base + PART_OSC_REF_OFFSET + 1] = (v >> 8) & 0xff;
  }
  return out;
}

/** Setzt das BPM×10-Feld (u16 LE). z.B. 128.0 BPM → 1280. */
export function setPatternBpm(body: Uint8Array, bpm: number): Uint8Array {
  const out = body.slice();
  const v = Math.max(200, Math.min(3000, Math.round((bpm || 0) * 10)));
  out[PATTERN_BPM_OFFSET] = v & 0xff;
  out[PATTERN_BPM_OFFSET + 1] = (v >> 8) & 0xff;
  return out;
}

/** Setzt den Pattern-Namen (ASCII, 16 Zeichen, space-/NUL-pad). */
export function setPatternName(body: Uint8Array, name: string): Uint8Array {
  const out = body.slice();
  for (let i = 0; i < PATTERN_NAME_LEN; i++) {
    const ch = i < name.length ? name.charCodeAt(i) : 0x20;
    out[PATTERN_NAME_OFFSET + i] = ch >= 0x20 && ch <= 0x7e ? ch : 0x20;
  }
  return out;
}
