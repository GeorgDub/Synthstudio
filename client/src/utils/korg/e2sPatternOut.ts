/**
 * Synthstudio — e2sPatternOut.ts (v3.232)
 *
 * KORG Electribe 2 Sampler (E2S) Pattern-Change-Sender.
 *
 * Hardware-Fakten:
 *   - 250 Patterns user-visible (P.001..P.250), intern 0..249
 *   - Bank/PC-Encoding: bank = patternIndex >> 7, pc = patternIndex & 0x7F
 *   - Pattern 0..127   -> Bank 0 + PC 0..127
 *   - Pattern 128..249 -> Bank 1 + PC 0..121
 *
 * MIDI-Implementierung (laut KORG Electribe 2 MIDI Implementation Chart):
 *   - Bank Select: NUR LSB (CC 32). Bank-MSB (CC 0) wird INTENTIONALLY
 *     OMITTED — KORG E2-Geraete erwarten LSB-only fuer 2-Bank-Devices.
 *   - Message-Reihenfolge: CC32 (Bank-LSB) ZUERST, dann Program Change
 *     (Program Change committet die Bank-Auswahl).
 *   - Channel: KORG-Geraete haben einen Global-MIDI-Channel (Stock-Default 1).
 *
 * Hardware-Limitation: Die Stock-Firmware der E2/E2S sendet bei lokalem
 * Pattern-Wechsel NICHTS auf MIDI-Out. Diese Datei implementiert ausschliesslich
 * die andere Richtung (Synthstudio -> E2S).
 *
 * Pure & isomorphic: keine DOM-, Electron-, oder React-Imports. Trivial unit-testbar.
 */

// ─── Konstanten ────────────────────────────────────────────────────────────

/** Anzahl der Patterns auf einer KORG E2/E2S (P.001..P.250). */
export const PATTERN_COUNT = 250;

/** Hoechster gueltiger 0-basierter Pattern-Index (= 249). */
export const MAX_PATTERN_INDEX = PATTERN_COUNT - 1;

/** Minimaler 0-basierter Pattern-Index. */
export const MIN_PATTERN_INDEX = 0;

/** MIDI-CC-Nummer fuer Bank Select LSB (per MIDI-Standard). */
export const CC_BANK_SELECT_LSB = 32;

/** Default-Channel (0-basiert) fuer Stock-E2S = MIDI-Ch 1. */
export const DEFAULT_CHANNEL = 0;

/** Status-Byte-Nibbles. */
const STATUS_CC = 0xB0;
const STATUS_PC = 0xC0;

// ─── Helper ────────────────────────────────────────────────────────────────

/**
 * Clampt einen Pattern-Index auf [0, 249]. Nicht-Zahlen und non-finite Werte
 * fallen auf 0 zurueck (defensiv, damit invalid Inputs nie unerwartete CCs
 * auslösen).
 */
export function clampPatternIndex(idx: number): number {
  if (typeof idx !== "number" || !Number.isFinite(idx)) return MIN_PATTERN_INDEX;
  const truncated = Math.trunc(idx);
  if (truncated < MIN_PATTERN_INDEX) return MIN_PATTERN_INDEX;
  if (truncated > MAX_PATTERN_INDEX) return MAX_PATTERN_INDEX;
  return truncated;
}

/** Clampt einen MIDI-Channel-Index auf [0, 15] (defensiv). */
export function clampChannel(channel: number): number {
  if (typeof channel !== "number" || !Number.isFinite(channel)) return DEFAULT_CHANNEL;
  const truncated = Math.trunc(channel);
  if (truncated < 0) return 0;
  if (truncated > 15) return 15;
  return truncated;
}

/**
 * Baut die MIDI-Message-Sequenz fuer einen Pattern-Wechsel auf der KORG E2/E2S.
 *
 * Liefert EXAKT 2 Messages:
 *   1. [0xB0|ch, 32, bankLsb]   — Bank Select LSB (KEIN CC0/MSB!)
 *   2. [0xC0|ch, pc]            — Program Change (committet die Bank)
 *
 * Beispiele:
 *   patternIndex=0   -> [[0xB0, 32, 0],   [0xC0, 0]]
 *   patternIndex=127 -> [[0xB0, 32, 0],   [0xC0, 127]]
 *   patternIndex=128 -> [[0xB0, 32, 1],   [0xC0, 0]]
 *   patternIndex=249 -> [[0xB0, 32, 1],   [0xC0, 121]]
 *
 * Inputs werden defensiv geclampt: patternIndex via clampPatternIndex, channel
 * via clampChannel.
 */
export function buildPatternChangeMessages(
  patternIndex: number,
  channel: number = DEFAULT_CHANNEL,
): number[][] {
  const idx = clampPatternIndex(patternIndex);
  const ch = clampChannel(channel);
  const bankLsb = (idx >> 7) & 0x7F;
  const pc = idx & 0x7F;
  return [
    [STATUS_CC | ch, CC_BANK_SELECT_LSB, bankLsb],
    [STATUS_PC | ch, pc],
  ];
}
