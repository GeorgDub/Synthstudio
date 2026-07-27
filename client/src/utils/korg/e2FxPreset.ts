/**
 * e2FxPreset.ts — Feld-Decode/-Edit des IFX/MFX-Preset-Blobs (0x20C) und des
 * Groove-Templates (0x140), gelesen/geschrieben über hacktribe-RAM-SysEx.
 *
 * Quelle (verifiziert): bangcorrupt/hacktribe-editor
 *   utils/ht_fx_preset_format.py (0x20C `preset`-Struct)
 *   extra/e2_groove_template.py (0x140 Groove)
 *
 * Nicht-destruktiv: Editoren setzen NUR die adressierten Bytes auf einer Kopie;
 * alle unbekannten/Reserved-Bytes bleiben exakt erhalten (Round-Trip-safe).
 */
import { fxTypeDef } from "./e2FxParams";
import { fxDefaults } from "./e2FxDefaults";

// ─── IFX/MFX-Preset (0x20C) Layout ───────────────────────────────────────────
export const IFX_PRESET_SIZE = 0x20c;
const PRESET_NAME_OFFSET = 0x001;
const PRESET_NAME_LEN = 0x0f; // 15
// Pro FX-Slot: device-Byte, pre/post-Level, params-Region (Wert @ region + 2*k).
const SLOTS = {
  ifx1: {
    device: 0x12a,
    postLevel: 0x12b,
    preLevel: 0x12f,
    params: 0x135,
    isMfx: false,
  },
  ifx2: {
    device: 0x174,
    postLevel: 0x175,
    preLevel: 0x179,
    params: 0x17f,
    isMfx: false,
  },
  mfx: {
    device: 0x1be,
    postLevel: 0x1bf,
    preLevel: 0x1c3,
    params: 0x1c9,
    isMfx: true,
  },
} as const;
export type PresetSlotRole = keyof typeof SLOTS;
export const PRESET_SLOT_ROLES: PresetSlotRole[] = ["ifx1", "ifx2", "mfx"];

export interface PresetSlotDecoded {
  role: PresetSlotRole;
  device: number;
  deviceName: string;
  preLevel: number;
  postLevel: number;
  paramNames: string[];
  params: number[]; // an param-Index-Positionen (0..127)
}
export interface IfxPresetDecoded {
  name: string;
  slots: PresetSlotDecoded[]; // ifx1, ifx2, mfx
}

function readAscii(bytes: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const b = bytes[off + i];
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
  }
  return s.replace(/\s+$/, "");
}

function decodeSlot(
  bytes: Uint8Array,
  role: PresetSlotRole
): PresetSlotDecoded {
  const l = SLOTS[role];
  const device = bytes[l.device] ?? 0;
  const def = fxTypeDef(device, l.isMfx);
  const paramNames = def ? def.params : [];
  const params = paramNames.map((_, k) => bytes[l.params + 2 * k] ?? 0);
  return {
    role,
    device,
    deviceName: def?.name ?? `Unknown (0x${device.toString(16)})`,
    preLevel: bytes[l.preLevel] ?? 0,
    postLevel: bytes[l.postLevel] ?? 0,
    paramNames,
    params,
  };
}

/** Zerlegt ein 0x20C-Preset in Name + 3 FX-Slots (ifx1/ifx2/mfx). */
export function decodeIfxPreset(bytes: Uint8Array): IfxPresetDecoded {
  return {
    name: readAscii(bytes, PRESET_NAME_OFFSET, PRESET_NAME_LEN),
    slots: PRESET_SLOT_ROLES.map(r => decodeSlot(bytes, r)),
  };
}

const clamp7 = (n: number) => Math.max(0, Math.min(127, Math.floor(n) || 0));

/** Setzt einen FX-Param in einem Slot (nicht-destruktive Kopie). */
export function setIfxPresetParam(
  bytes: Uint8Array,
  role: PresetSlotRole,
  paramIndex: number,
  value: number
): Uint8Array {
  const out = bytes.slice();
  out[SLOTS[role].params + 2 * paramIndex] = clamp7(value);
  return out;
}

/** Region-Ende (exklusiv) der Param-Bytes eines Slots — bis zum nächsten Feld. */
function slotParamsEnd(role: PresetSlotRole): number {
  if (role === "ifx1") return SLOTS.ifx2.device;
  if (role === "ifx2") return SLOTS.mfx.device;
  return IFX_PRESET_SIZE;
}

/**
 * Wechselt den FX-Typ (device-Byte) eines Slots und initialisiert die Param-
 * Region mit den werkseitigen Defaults dieses Typs (bit-exakt aus hacktribe).
 * Höhere, vom alten (längeren) Typ übrig gebliebene Param-Slots werden genullt,
 * damit kein Fremd-Zustand zurückbleibt. Pre/Post-Level + Name bleiben erhalten.
 */
export function setIfxPresetDevice(
  bytes: Uint8Array,
  role: PresetSlotRole,
  deviceId: number
): Uint8Array {
  const out = bytes.slice();
  const l = SLOTS[role];
  out[l.device] = deviceId & 0xff;
  const defs = fxDefaults(deviceId, l.isMfx);
  const maxK = Math.floor((slotParamsEnd(role) - l.params) / 2);
  for (let k = 0; k < maxK; k++) {
    out[l.params + 2 * k] = k < defs.length ? clamp7(defs[k]) : 0;
  }
  return out;
}

/** Setzt pre/post-Level eines Slots. */
export function setIfxPresetLevel(
  bytes: Uint8Array,
  role: PresetSlotRole,
  which: "pre" | "post",
  value: number
): Uint8Array {
  const out = bytes.slice();
  out[which === "pre" ? SLOTS[role].preLevel : SLOTS[role].postLevel] =
    clamp7(value);
  return out;
}

/** Setzt den Preset-Namen (ASCII, 15 Zeichen, NUL-pad). */
export function setIfxPresetName(bytes: Uint8Array, name: string): Uint8Array {
  const out = bytes.slice();
  for (let i = 0; i < PRESET_NAME_LEN; i++) {
    const ch = i < name.length ? name.charCodeAt(i) : 0;
    out[PRESET_NAME_OFFSET + i] = ch >= 0x20 && ch <= 0x7e ? ch : 0;
  }
  return out;
}

// ─── Preset-eigene Control-Map (persistent, im 0x20C-Blob) ───────────────────
// Quelle: ht_fx_preset_format.py `preset`-Struct: name@0x01(15) + Padding(2),
// dann control_map = fx_control[10] @0x12. Jeder fx_control ist 28 B:
// source_control@+0, chain_index@+1, target_param@+2, pad, min@+4, pad, max@+6, pad×21.
// Anders als die LIVE-Map (e2FxParams, 6 B, im RAM-Buffer) bleibt DIESE im Preset
// gespeichert und wirkt beim Laden. Andere Source-Enum-Werte (0x41..0x4A).
export const PRESET_CONTROL_MAP_OFFSET = 0x12;
export const PRESET_CONTROL_SLOT_SIZE = 0x1c; // 28
export const PRESET_CONTROL_MAP_SLOTS = 10;

/** Source-Controls im PRESET-Blob (nicht identisch mit der Live-RAM-Map!). */
export const PRESET_FX_SOURCES: Record<number, string> = {
  0x00: "none",
  0x41: "FX On",
  0x42: "FX Edit X",
  0x43: "FX Edit Y",
  0x44: "FX Edit X Hi",
  0x45: "FX Edit X Lo",
  0x46: "FX Edit Y Hi",
  0x47: "FX Edit Y Lo",
  0x48: "Key (Part)",
  0x49: "Key (Global)",
  0x4a: "Play/Start",
};

/** chain_index: auf welches Kettenglied der target_param zeigt. */
export const PRESET_CHAIN_INDEX: Record<number, string> = {
  0x00: "IFX 1",
  0x01: "IFX 2",
  0x02: "MFX",
  0x07: "Input Level",
  0x0a: "Output Level",
};

export interface PresetControlSlot {
  sourceControl: number;
  chainIndex: number; // welcher FX (ifx1/ifx2/mfx/…)
  targetParam: number; // Param-Index im gewählten Kettenglied
  minValue: number;
  maxValue: number;
}

/** Dekodiert die 10 preset-eigenen Control-Map-Slots (@0x12, 28 B/Slot). */
export function decodePresetControlMap(bytes: Uint8Array): PresetControlSlot[] {
  const slots: PresetControlSlot[] = [];
  for (let i = 0; i < PRESET_CONTROL_MAP_SLOTS; i++) {
    const o = PRESET_CONTROL_MAP_OFFSET + i * PRESET_CONTROL_SLOT_SIZE;
    slots.push({
      sourceControl: bytes[o] ?? 0,
      chainIndex: bytes[o + 1] ?? 0,
      targetParam: bytes[o + 2] ?? 0,
      minValue: bytes[o + 4] ?? 0,
      maxValue: bytes[o + 6] ?? 0,
    });
  }
  return slots;
}

/** Setzt einen preset-eigenen Control-Map-Slot (nicht-destruktive Kopie). */
export function setPresetControlSlot(
  bytes: Uint8Array,
  slotIndex: number,
  slot: PresetControlSlot
): Uint8Array {
  const out = bytes.slice();
  if (slotIndex < 0 || slotIndex >= PRESET_CONTROL_MAP_SLOTS) return out;
  const o = PRESET_CONTROL_MAP_OFFSET + slotIndex * PRESET_CONTROL_SLOT_SIZE;
  out[o] = slot.sourceControl & 0xff;
  out[o + 1] = slot.chainIndex & 0xff;
  out[o + 2] = slot.targetParam & 0xff;
  out[o + 4] = clamp7(slot.minValue);
  out[o + 6] = clamp7(slot.maxValue);
  return out;
}

// ─── Groove-Template (0x140) Layout ──────────────────────────────────────────
export const GROOVE_SIZE = 0x140;
const GROOVE_NAME_OFFSET = 0x010;
const GROOVE_NAME_LEN = 0x0f;
const GROOVE_LENGTH_OFFSET = 0x022;
const GROOVE_STEPS_OFFSET = 0x030;
const GROOVE_STEP_STRIDE = 4;
export const GROOVE_STEP_COUNT = 64;

export interface GrooveStep {
  trigger: number; // micro-timing, signed (−0x30..+0x30)
  velocity: number; // 0..0x7F
  gate: number; // 0..0x60
}
export interface GrooveDecoded {
  name: string;
  length: number;
  steps: GrooveStep[]; // 64
}

function toSigned8(b: number): number {
  return b >= 0x80 ? b - 0x100 : b;
}

/** Zerlegt ein 0x140-Groove-Template in Name + Länge + 64 Steps. */
export function decodeGroove(bytes: Uint8Array): GrooveDecoded {
  const steps: GrooveStep[] = [];
  for (let i = 0; i < GROOVE_STEP_COUNT; i++) {
    const o = GROOVE_STEPS_OFFSET + i * GROOVE_STEP_STRIDE;
    steps.push({
      trigger: toSigned8(bytes[o] ?? 0),
      velocity: bytes[o + 1] ?? 0,
      gate: bytes[o + 2] ?? 0,
    });
  }
  return {
    name: readAscii(bytes, GROOVE_NAME_OFFSET, GROOVE_NAME_LEN),
    length: bytes[GROOVE_LENGTH_OFFSET] ?? 0,
    steps,
  };
}

/** Setzt ein Feld eines Groove-Steps (nicht-destruktive Kopie). */
export function setGrooveStep(
  bytes: Uint8Array,
  stepIndex: number,
  field: keyof GrooveStep,
  value: number
): Uint8Array {
  const out = bytes.slice();
  const o = GROOVE_STEPS_OFFSET + stepIndex * GROOVE_STEP_STRIDE;
  if (field === "trigger") {
    const clamped = Math.max(-0x30, Math.min(0x30, Math.floor(value) || 0));
    out[o] = clamped < 0 ? clamped + 0x100 : clamped;
  } else if (field === "velocity") {
    out[o + 1] = clamp7(value);
  } else {
    out[o + 2] = Math.max(0, Math.min(0x60, Math.floor(value) || 0));
  }
  return out;
}
