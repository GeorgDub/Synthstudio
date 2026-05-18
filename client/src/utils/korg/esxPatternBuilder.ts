/**
 * Synthstudio – KORG ESX-1 Pattern WRITE (v3.27.0)
 *
 * Encodes a Synthstudio-Pattern into a binary **4280-byte ESX-1 Pattern-Block**.
 * Pure-TypeScript, isomorphic, no Electron/DOM deps.
 *
 * SoT for the binary layout is the verified READ-side parser in
 * `client/src/utils/korg/esxParser.ts` (v3.5/v3.14/v3.20/v3.23). Field offsets,
 * stride values and step-byte encoding are kept in lock-step with the layout
 * documentation there — round-trip tests assert that buildEsxPatternBlock →
 * parseEsxPattern produces the same input back.
 *
 * SCOPE (v3.27.0):
 *   - Only the 4280-byte pattern-block, NOT the full 25 MB .esx-bank
 *   - Full bank write with PCM + sample-headers comes in v3.28+
 *   - Output is suitable for placement at file-offset 0x0200 + i × 4280 in a bank
 *
 * Layout summary (absolute offsets within the 4280-byte block, BIG-ENDIAN):
 *
 *   0x000..0x007  8B    Pattern name, ASCII space-padded (0x20)
 *   0x008..0x009  2B    BPM × 128 (BE u16, e.g. 0x5780 = 22400 → 175.0 BPM)
 *   0x00A..0x00C  3B    Globals (reserved, zero-filled)
 *   0x00D         1B    StepLength - 1 (0x0F = 16 steps)
 *   0x00E         1B    Reserved
 *   0x00F         1B    Swing (best-effort, 0..100)
 *   0x010..0x017  8B    Globals tail (reserved, zero-filled)
 *   0x018..0x163  340B  10 Drum-Parts × 34B
 *     per part (offsets relative to part_start):
 *       +0..+1   sample-id (BE u16, 0x8000 = unassigned)
 *       +2..+3   constant 0xFF00 (invariant in all observed real files)
 *       +4..+7   EG / mod fields (zero-filled defaults)
 *       +8       pitch (signed i8 around 0x40 = neutral)
 *       +9       level (u8, 0..127)
 *       +10      pan (u8, 0..127, 64 = center)
 *       +11      fx-send (u8, 0..127)
 *       +12..+17 modulation/lfo (zero-filled defaults)
 *       +18..+33 16 step-bytes (bit 0 = active, bit 4 = accent)
 *
 *   0x164..0x25B   ~248B  Drum-Motion-Sequencer data (zero-filled defaults)
 *   0x25C..0x27D   34B    Part 10 (Stretch) — same 34B layout as drum parts
 *   0x27E..0x36D   ~240B  Stretch + Sample motion (zero-filled defaults)
 *   0x36E..0x3DD   4×32B  Parts 11..14 (Sample/Slice/Synth) — 16B header + 16B steps
 *     per short part:
 *       +0..+1   sample-id (BE u16)
 *       +2..+5   mode flags (zero-filled defaults)
 *       +6       pitch (signed i8 around 0x40)
 *       +7       level (u8 0..127)
 *       +8       pan (u8 0..127, 0x40 center)
 *       +9       reserved (often 0x7F in real files — written as 0)
 *       +10      fx-send (u8 0..127)
 *       +11..+15 mod flags (zero-filled defaults)
 *       +16..+31 16 step-bytes (bit 0 = active, bit 4 = accent)
 *
 *   0x3DE..0x487   ~170B  Reserve / synth-motion (zero-filled defaults)
 *   0x488..0xXX..  Per-step pitch motion (0x80 = neutral, zero-filled NOT used)
 *
 * Defensive: all caller inputs are range-clamped; missing parts/steps are
 * filled with deterministic defaults so the output is always structurally
 * valid even if the caller supplies sparse input.
 */

import {
  ESX1_CHUNKSIZE_PATTERN,
  ESX1_NAME_MAX_CHARS,
} from "./constants";

// ─── Layout constants (mirror esxParser.ts internals) ───────────────────────

/** Full pattern-block size in bytes (always exactly this). */
export const ESX_PATTERN_BLOCK_SIZE = ESX1_CHUNKSIZE_PATTERN; // 4280

/** Number of drum-parts (Parts 0..9). */
export const ESX_DRUM_PART_COUNT = 10;
/** Offset of the first drum-part header. */
export const ESX_DRUM_PARTS_OFFSET = 0x18;
/** Per-drum-part stride (header + steps). */
export const ESX_DRUM_PART_STRIDE = 34;
/** Drum-part header length (bytes before the step-trigger block). */
export const ESX_DRUM_PART_HEADER_BYTES = 18;
/** Drum-part step-trigger block length. */
export const ESX_DRUM_PART_STEPS_BYTES = 16;

/** Offset of the Part 10 (Stretch) — same 34B layout as drum parts. */
export const ESX_STRETCH_PART_OFFSET = 0x25c;

/** Offsets of Parts 11..14 (Sample/Slice/Synth) — 32B stride. */
export const ESX_SHORT_PART_OFFSETS: ReadonlyArray<number> = [0x36e, 0x38e, 0x3ae, 0x3ce];
/** Short-part header length. */
export const ESX_SHORT_PART_HEADER_BYTES = 16;
/** Short-part step-trigger block length. */
export const ESX_SHORT_PART_STEPS_BYTES = 16;

/** Number of step-trigger bytes per part (== 16 — matches `ESX1_DEFAULT_STEPS`). */
export const ESX_STEPS_PER_PART = 16;

/** Total number of parts in a pattern-block. */
export const ESX_PARTS_PER_PATTERN = 16;

/** Pattern-block field offsets (within the 4280B block). */
export const ESX_PATTERN_NAME_OFFSET = 0x000;
export const ESX_PATTERN_BPM_OFFSET = 0x008;
export const ESX_PATTERN_STEP_LENGTH_OFFSET = 0x00d;
export const ESX_PATTERN_SWING_OFFSET = 0x00f;

/** Drum/Short-part header byte offsets (relative to part start). */
export const ESX_DRUM_PART_SAMPLEID_OFFSET = 0;
export const ESX_DRUM_PART_INVARIANT_OFFSET = 2; // 'ff 00' marker
export const ESX_DRUM_PART_PITCH_OFFSET = 8;
export const ESX_DRUM_PART_LEVEL_OFFSET = 9;
export const ESX_DRUM_PART_PAN_OFFSET = 10;
export const ESX_DRUM_PART_FXSEND_OFFSET = 11;

export const ESX_SHORT_PART_SAMPLEID_OFFSET = 0;
export const ESX_SHORT_PART_PITCH_OFFSET = 6;
export const ESX_SHORT_PART_LEVEL_OFFSET = 7;
export const ESX_SHORT_PART_PAN_OFFSET = 8;
export const ESX_SHORT_PART_FXSEND_OFFSET = 10;

/** Sentinel sample-id for "unassigned/empty" part slot (BE u16 0x8000). */
export const ESX_SAMPLEID_UNASSIGNED = 0x8000;

/** Raw byte representing 0 semitones (neutral) in the pitch field. */
export const ESX_PITCH_NEUTRAL_RAW = 0x40;

/** Step-byte bit masks (verified RE in v3.23). */
export const ESX_STEP_TRIGGER_BIT = 0x01;
export const ESX_STEP_ACCENT_BIT = 0x10;

/** BPM scale factor: on-disk value is BPM × 128 BE u16. */
export const ESX_BPM_SCALE = 128;

/** Hardware BPM range (matches reader clamp). */
export const ESX_MIN_BPM = 20;
export const ESX_MAX_BPM = 300;

/** Hardware step-length range. */
export const ESX_MIN_STEP_LENGTH = 1;
export const ESX_MAX_STEP_LENGTH = 64;

/** Default level when caller doesn't specify (matches reader fallback). */
export const ESX_DEFAULT_LEVEL = 100;
/** Default pan = center. */
export const ESX_DEFAULT_PAN = 64;
/** Default step-length. */
export const ESX_DEFAULT_STEP_LENGTH = 16;

// ─── Public API types ───────────────────────────────────────────────────────

export interface EsxStepInput {
  /** Step is triggered (bit 0). */
  active: boolean;
  /**
   * Accent flag (bit 4). Default false. The reader maps active+accent →
   * velocity 127 (TR-style), active without accent → 100.
   */
  accent?: boolean;
}

/**
 * A drum or stretch part (34-byte stride, 16-byte steps).
 * Used for Parts 0..10 (drum 1..10 + stretch).
 */
export interface EsxDrumPartInput {
  /** 0..511 (lower 9 bits) — ESX-1 sample-slot. undefined / negative → unassigned (0x8000). */
  sampleId?: number;
  /** Pitch in semitones, signed, -64..+63. Default 0. */
  pitch?: number;
  /** Level 0..127. Default 100. */
  level?: number;
  /** Pan 0..127 (64 = center). Default 64. */
  pan?: number;
  /** Effect-send 0..127. Default 0. */
  fxSend?: number;
  /** 16 step triggers. Missing entries are filled with {active:false}. */
  steps: EsxStepInput[];
}

/**
 * A short part (Sample/Slice/Synth, 32-byte stride: 16B header + 16B steps).
 * Used for Parts 11..14.
 */
export interface EsxShortPartInput {
  sampleId?: number;
  pitch?: number;
  level?: number;
  pan?: number;
  fxSend?: number;
  steps: EsxStepInput[];
}

export interface EsxPatternInput {
  /** Pattern name. Truncated to 8 ASCII chars, space-padded. */
  name: string;
  /** BPM 20..300 (encoded as BPM × 128 BE u16). */
  bpm: number;
  /** Step-length 1..64. Stored as (stepLength - 1) byte. Default 16. */
  stepLength: number;
  /** Swing 0..100 (best-effort, byte @ 0x0F). */
  swing?: number;
  /** Parts 0..9 — exactly 10 entries expected. Missing parts default to empty. */
  drumParts: EsxDrumPartInput[];
  /** Part 10 (Stretch). Defaults to empty if undefined. */
  stretchPart?: EsxDrumPartInput;
  /** Parts 11..14 — 4 entries expected. Missing parts default to empty. */
  shortParts?: EsxShortPartInput[];
  /**
   * Part 15 (Audio-In) — typically default-empty in real files; in v3.27
   * we always leave this region at zero defaults (no input field).
   */
  audioInPart?: EsxShortPartInput;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const v = Math.floor(value);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Writes an ASCII string into `view` at `offset`, truncated to `length` bytes
 * and SPACE-padded (0x20). Non-printable / non-ASCII bytes coerced to '?'.
 *
 * Mirrors the read-side `decodeEsxName` behaviour which trims trailing
 * whitespace. NUL-padding is also acceptable to the reader, but the KORG
 * hardware standard is space-padded, so we keep parity.
 */
function writeAsciiSpacePadded(
  view: DataView,
  offset: number,
  value: string,
  length: number,
): void {
  const safe = typeof value === "string" ? value : "";
  for (let i = 0; i < length; i++) {
    const ch = i < safe.length ? safe.charCodeAt(i) : 0x20;
    const byte = ch >= 0x20 && ch <= 0x7e ? ch : 0x3f;
    view.setUint8(offset + i, byte);
  }
}

/**
 * Encodes a single step input into the raw step-byte.
 *
 * Bits (verified in v3.23 reader):
 *   bit 0 = trigger active
 *   bit 4 = accent (best-effort, TR-style)
 *   other bits = zero (1..3, 5..7 are not reliably RE-d)
 */
export function encodeStepByte(step: EsxStepInput | undefined): number {
  if (!step || !step.active) return 0x00;
  let b = ESX_STEP_TRIGGER_BIT;
  if (step.accent === true) b |= ESX_STEP_ACCENT_BIT;
  return b & 0xff;
}

/**
 * Converts semitones (-64..+63) to the raw byte (around 0x40 = neutral).
 * Out-of-range values are clamped.
 */
export function encodePitchByte(semitones: number | undefined): number {
  const semi = clampInt(semitones, -64, 63, 0);
  return (semi + ESX_PITCH_NEUTRAL_RAW) & 0xff;
}

/** Encodes the sample-id as BE u16; undefined / negative → 0x8000 unassigned. */
export function encodeSampleId(sampleId: number | undefined): number {
  if (typeof sampleId !== "number" || !Number.isFinite(sampleId) || sampleId < 0) {
    return ESX_SAMPLEID_UNASSIGNED;
  }
  // Lower 9 bits cover 0..511 valid slot range.
  return Math.floor(sampleId) & 0x01ff;
}

// ─── Builder sub-functions ──────────────────────────────────────────────────

/**
 * Writes a single 34-byte drum or stretch part block at `partStart`.
 *
 * Layout (mirror of decodeDrumPart / decodeStretchPart):
 *   +0..+1   sample-id BE u16 (0x8000 unassigned)
 *   +2..+3   'ff 00' invariant marker
 *   +8       pitch (signed i8 around 0x40)
 *   +9       level (u8 0..127)
 *   +10      pan (u8 0..127, 64=center)
 *   +11      fx-send (u8 0..127)
 *   +18..+33 16 step-bytes (bit 0 = active, bit 4 = accent)
 *
 * All other header bytes are left at 0 (zero-init buffer).
 */
export function writeDrumPartBlock(
  view: DataView,
  partStart: number,
  part: EsxDrumPartInput | undefined,
): void {
  const p: EsxDrumPartInput = part ?? { steps: [] };

  // sample-id BE u16
  const sid = encodeSampleId(p.sampleId);
  view.setUint16(partStart + ESX_DRUM_PART_SAMPLEID_OFFSET, sid, false);

  // 'ff 00' invariant marker @ +2 (verified across all real .esx files)
  view.setUint8(partStart + ESX_DRUM_PART_INVARIANT_OFFSET, 0xff);
  view.setUint8(partStart + ESX_DRUM_PART_INVARIANT_OFFSET + 1, 0x00);

  // pitch @ +8
  view.setUint8(partStart + ESX_DRUM_PART_PITCH_OFFSET, encodePitchByte(p.pitch));

  // level @ +9
  view.setUint8(
    partStart + ESX_DRUM_PART_LEVEL_OFFSET,
    clampInt(p.level, 0, 127, ESX_DEFAULT_LEVEL),
  );

  // pan @ +10
  view.setUint8(
    partStart + ESX_DRUM_PART_PAN_OFFSET,
    clampInt(p.pan, 0, 127, ESX_DEFAULT_PAN),
  );

  // fx-send @ +11
  view.setUint8(
    partStart + ESX_DRUM_PART_FXSEND_OFFSET,
    clampInt(p.fxSend, 0, 127, 0),
  );

  // 16 step-bytes @ +18
  const stepsOff = partStart + ESX_DRUM_PART_HEADER_BYTES;
  const steps = Array.isArray(p.steps) ? p.steps : [];
  for (let s = 0; s < ESX_STEPS_PER_PART; s++) {
    view.setUint8(stepsOff + s, encodeStepByte(steps[s]));
  }
}

/**
 * Writes a single 32-byte short-part block at `partStart`.
 *
 * Layout (mirror of decodeShortPart):
 *   +0..+1   sample-id BE u16
 *   +6       pitch (signed i8 around 0x40)
 *   +7       level (u8 0..127)
 *   +8       pan (u8 0..127, 0x40 center)
 *   +10      fx-send (u8 0..127)
 *   +16..+31 16 step-bytes
 *
 * Header bytes 2..5 / 9 / 11..15 are zero (default — real files have
 * mode-flags here but the reader ignores them).
 */
export function writeShortPartBlock(
  view: DataView,
  partStart: number,
  part: EsxShortPartInput | undefined,
): void {
  const p: EsxShortPartInput = part ?? { steps: [] };

  const sid = encodeSampleId(p.sampleId);
  view.setUint16(partStart + ESX_SHORT_PART_SAMPLEID_OFFSET, sid, false);

  view.setUint8(partStart + ESX_SHORT_PART_PITCH_OFFSET, encodePitchByte(p.pitch));

  view.setUint8(
    partStart + ESX_SHORT_PART_LEVEL_OFFSET,
    clampInt(p.level, 0, 127, ESX_DEFAULT_LEVEL),
  );

  view.setUint8(
    partStart + ESX_SHORT_PART_PAN_OFFSET,
    clampInt(p.pan, 0, 127, ESX_DEFAULT_PAN),
  );

  view.setUint8(
    partStart + ESX_SHORT_PART_FXSEND_OFFSET,
    clampInt(p.fxSend, 0, 127, 0),
  );

  const stepsOff = partStart + ESX_SHORT_PART_HEADER_BYTES;
  const steps = Array.isArray(p.steps) ? p.steps : [];
  for (let s = 0; s < ESX_STEPS_PER_PART; s++) {
    view.setUint8(stepsOff + s, encodeStepByte(steps[s]));
  }
}

// ─── Top-level builder ──────────────────────────────────────────────────────

/**
 * Builds a complete 4280-byte ESX-1 pattern-block from an EsxPatternInput.
 *
 * The output buffer is always exactly `ESX_PATTERN_BLOCK_SIZE` bytes. Caller
 * inputs are range-clamped throughout (BPM, level, pan, pitch, fx-send, …).
 * Missing parts/steps are filled with deterministic defaults.
 *
 * Round-trip invariant (verified in tests):
 *   parseEsxPattern(buildEsxPatternBlock(input), 0) ≈ input
 * (for the fields the reader currently decodes: name, bpm, lengthSteps,
 *  swing, drum+stretch+short parts including pitch/level/pan/fxSend/steps).
 *
 * This block is **not** a complete .esx file. To build a usable bank, place
 * the output at file-offset `0x0200 + i × 4280` (where i is the pattern
 * slot index 0..255) in a properly-magic-prefixed .esx container. Full
 * bank-write support is planned for v3.28+.
 */
export function buildEsxPatternBlock(input: EsxPatternInput): ArrayBuffer {
  const buffer = new ArrayBuffer(ESX_PATTERN_BLOCK_SIZE);
  const view = new DataView(buffer);

  // ── Pattern header ────────────────────────────────────────────────────────
  // Name @ 0x00..0x07, 8B ASCII space-padded.
  writeAsciiSpacePadded(view, ESX_PATTERN_NAME_OFFSET, input.name ?? "", ESX1_NAME_MAX_CHARS);

  // BPM × 128 @ 0x08..0x09, BE u16. Clamp to hardware range and round.
  const bpmClamped =
    typeof input.bpm === "number" && Number.isFinite(input.bpm)
      ? Math.max(ESX_MIN_BPM, Math.min(ESX_MAX_BPM, input.bpm))
      : 120;
  const bpmRaw = Math.round(bpmClamped * ESX_BPM_SCALE) & 0xffff;
  view.setUint16(ESX_PATTERN_BPM_OFFSET, bpmRaw, false);

  // Step-length-1 @ 0x0D.
  const stepLen = clampInt(
    input.stepLength,
    ESX_MIN_STEP_LENGTH,
    ESX_MAX_STEP_LENGTH,
    ESX_DEFAULT_STEP_LENGTH,
  );
  view.setUint8(ESX_PATTERN_STEP_LENGTH_OFFSET, (stepLen - 1) & 0x7f);

  // Swing @ 0x0F (best-effort, 0..100).
  view.setUint8(ESX_PATTERN_SWING_OFFSET, clampInt(input.swing, 0, 100, 0));

  // ── 10 Drum parts (0..9) × 34B @ 0x18 ─────────────────────────────────────
  const drumParts = Array.isArray(input.drumParts) ? input.drumParts : [];
  for (let p = 0; p < ESX_DRUM_PART_COUNT; p++) {
    const partStart = ESX_DRUM_PARTS_OFFSET + p * ESX_DRUM_PART_STRIDE;
    writeDrumPartBlock(view, partStart, drumParts[p]);
  }

  // ── Stretch part (Part 10) @ 0x25C ─────────────────────────────────────────
  writeDrumPartBlock(view, ESX_STRETCH_PART_OFFSET, input.stretchPart);

  // ── Short parts (Parts 11..14) ────────────────────────────────────────────
  const shortParts = Array.isArray(input.shortParts) ? input.shortParts : [];
  for (let i = 0; i < ESX_SHORT_PART_OFFSETS.length; i++) {
    // Last entry (i=3, offset 0x3CE) is also "Audio-In" in some real files —
    // we expose it via `shortParts[3]` AND `audioInPart` (last one wins).
    let partIn: EsxShortPartInput | undefined = shortParts[i];
    if (i === ESX_SHORT_PART_OFFSETS.length - 1 && input.audioInPart) {
      partIn = input.audioInPart;
    }
    writeShortPartBlock(view, ESX_SHORT_PART_OFFSETS[i], partIn);
  }

  return buffer;
}

// ─── Validation helpers (for future IPC layer in v3.28+) ────────────────────

/**
 * Quick structural sanity-check for a built pattern-block. Confirms the block
 * is exactly 4280 bytes and has the invariant 'ff 00' markers in the first
 * drum-part header. Cheap to call before further processing.
 */
export function looksLikeEsxPatternBlock(buffer: ArrayBuffer | Uint8Array): boolean {
  try {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u8.byteLength !== ESX_PATTERN_BLOCK_SIZE) return false;
    // First drum-part invariant marker: 'ff 00' at 0x18 + 2 = 0x1A.
    const inv0 = ESX_DRUM_PARTS_OFFSET + ESX_DRUM_PART_INVARIANT_OFFSET;
    if (u8[inv0] !== 0xff || u8[inv0 + 1] !== 0x00) return false;
    return true;
  } catch {
    return false;
  }
}
