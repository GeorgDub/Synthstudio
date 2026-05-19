/**
 * Synthstudio – sampleDurationAggregator.ts (v3.162.0)
 *
 * Pure-Helper für die Aggregation der Gesamt-Dauer einer Sample-Liste.
 * Foundation für ein v3.155-Caveat: Duration-Display in der Sample-Browser
 * Bulk-Bar (z.B. "5 Samples · 1:23 total").
 *
 * Pro Kandidat probiert der Aggregator in dieser Reihenfolge:
 *   1. durationSec, wenn finite & >= 0
 *   2. buffer.length / buffer.sampleRate (AudioBuffer-Pattern)
 *   3. sizeBytes / (sampleRate * 4)  — grober WAV-Stereo-16bit-Estimate,
 *      Header (44 Bytes) wird subtrahiert. Default sampleRate = 48000.
 *   4. unknown — knownCount nicht erhöhen.
 *
 * formatDuration(sec) liefert "M:SS" (<1h) bzw. "H:MM:SS" (>=1h).
 *
 * Pure & Node-testbar.
 *
 * Tests: tests/features/sample-duration-aggregator.test.ts
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface DurationCandidate {
  /** Optional: durationSec falls bereits bekannt (z.B. aus Analyse-Cache). */
  durationSec?: number;
  /** Optional: AudioBuffer (length + sampleRate liefert duration). */
  buffer?: { length: number; sampleRate: number };
  /** Optional: explizite Bytes (für rough estimate fallback bei WAV). */
  sizeBytes?: number;
  /** Optional: sample rate für sizeBytes-Estimate (default 48000, 16-bit, stereo). */
  sampleRate?: number;
}

export interface DurationAggregateResult {
  /** Gesamt-Dauer in Sekunden. */
  totalSec: number;
  /** Anzahl Samples mit bekannter Duration. */
  knownCount: number;
  /** Anzahl Samples ohne Duration-Info. */
  unknownCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** WAV-Header-Größe (RIFF + fmt + data Chunks für Standard-PCM). */
const WAV_HEADER_BYTES = 44;
/** Default für Estimate-Fallback: 48 kHz, 16-bit (2 Bytes), Stereo (2 Channels) = 4 Bytes/Sample. */
const DEFAULT_SAMPLE_RATE = 48000;
const STEREO_16BIT_BYTES_PER_SAMPLE = 4;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Aggregiert die Gesamt-Dauer einer Sample-Liste.
 *
 * Defensive bei leerem Array oder ungültigen Quellen → 0/0/0.
 * Pure & deterministisch.
 */
export function aggregateSampleDuration(
  samples: readonly DurationCandidate[],
): DurationAggregateResult {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { totalSec: 0, knownCount: 0, unknownCount: 0 };
  }

  let totalSec = 0;
  let knownCount = 0;
  let unknownCount = 0;

  for (const s of samples) {
    const dur = resolveDuration(s);
    if (dur !== null) {
      totalSec += dur;
      knownCount++;
    } else {
      unknownCount++;
    }
  }

  return { totalSec, knownCount, unknownCount };
}

/**
 * Formatiert Sekunden als "M:SS" oder "H:MM:SS" (ab 1h).
 *
 *  - sec < 0, NaN, Infinity → "0:00"
 *  - Sekunden werden gefloored
 *  - < 1h: Minutes nicht gepadded (90 → "1:30", 5 → "0:05")
 *  - >= 1h: Minutes + Seconds gepadded (3661 → "1:01:01")
 */
export function formatDuration(sec: number): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) {
    return "0:00";
  }
  const total = Math.floor(sec);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours >= 1) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${minutes}:${pad2(seconds)}`;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function resolveDuration(s: DurationCandidate): number | null {
  // 1. Explicit durationSec
  if (
    typeof s.durationSec === "number" &&
    Number.isFinite(s.durationSec) &&
    s.durationSec >= 0
  ) {
    return s.durationSec;
  }
  // 2. AudioBuffer-Style
  if (
    s.buffer &&
    typeof s.buffer.length === "number" &&
    typeof s.buffer.sampleRate === "number" &&
    s.buffer.length > 0 &&
    s.buffer.sampleRate > 0 &&
    Number.isFinite(s.buffer.length) &&
    Number.isFinite(s.buffer.sampleRate)
  ) {
    return s.buffer.length / s.buffer.sampleRate;
  }
  // 3. Size-Bytes Estimate
  if (
    typeof s.sizeBytes === "number" &&
    Number.isFinite(s.sizeBytes) &&
    s.sizeBytes >= 0
  ) {
    const sr =
      typeof s.sampleRate === "number" &&
      Number.isFinite(s.sampleRate) &&
      s.sampleRate > 0
        ? s.sampleRate
        : DEFAULT_SAMPLE_RATE;
    const dataBytes = s.sizeBytes - WAV_HEADER_BYTES;
    const bytesPerSec = sr * STEREO_16BIT_BYTES_PER_SAMPLE;
    return Math.max(0, dataBytes / bytesPerSec);
  }
  // 4. Unknown
  return null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
