#!/usr/bin/env node
/**
 * v3.23 ACCENT-Hypothesis check:
 *   bit-4 = accent (special-emphasis flag, like Roland TR-style)
 *
 * Test: in BOTTROP[0] Part13 we see "11 11 11 11 55 55 11 11 11 11 11 11 55 55 11 11"
 * Pattern: every step has bit-4 set (0x11 = 0b00010001 with both bit-0 + bit-4).
 *          steps 4,5 + 12,13 also have bits 2+6 → 0x55 = 0b01010101 = bits 0,2,4,6
 *
 * If "11" is "trigger + accent", and "55" is "trigger + accent + roll1 + roll2",
 * then bit-4=accent is consistent with all of bit-2/4/6 being part of an
 * accent/roll/slide-flag-set.
 *
 * Final hypothesis (CONSERVATIVE / DEFENSIVE):
 *   bit 0 = trigger active (CONFIRMED v3.20)
 *   bit 4 = accent (HIGH-CONFIDENCE based on freq + pattern-consistency)
 *   bits 1-3, 5-7 = roll/slide/velocity (BEST-EFFORT, not RE-d)
 *
 * Plan for parser:
 *   - EsxStepEvent gets new `accent?: boolean` field
 *   - velocity = (accent ? 127 : 100) for active steps (Roland-style logic)
 *   - DO NOT export `note?: number` because we can't reliably decode it
 *
 * This keeps API conservative: no false-positive note assignments.
 */

import { readFileSync } from "node:fs";

const ESX_DIR = "G:/IdeaProjects/Synthstudio/Korg ESX files";
const PATTERN_DATA_OFFSET = 0x0200;
const PATTERN_SIZE = 4280;
const SHORT_PART_OFFSETS = [0x36e, 0x38e, 0x3ae, 0x3ce];
const DRUM_PART_OFFSET = 24;
const DRUM_PART_STRIDE = 34;
const DRUM_PARTS = 10;

function isEmptyPattern(raw) {
  let allZero = true;
  for (let i = 0; i < 32; i++) if (raw[i] !== 0) { allZero = false; break; }
  return allZero;
}

const files = ["BOTTROP.ESX", "ENDLICH.ESX", "KASSEL.esx", "TOBI.ESX", "YOYOY.ESX"];

// Check: how often does bit-4 appear in DRUM-PART step-bytes (where we know
// the layout is simpler)? If drum-parts also have many 0x11 vs 0x01 → accent
// is also a drum-feature, supporting accent-hypothesis.
let drumActive = 0;
let drumBit4 = 0;
let shortActive = 0;
let shortBit4 = 0;

for (const f of files) {
  let buf;
  try { buf = new Uint8Array(readFileSync(`${ESX_DIR}/${f}`)); }
  catch { continue; }
  for (let p = 0; p < 256; p++) {
    const off = PATTERN_DATA_OFFSET + p * PATTERN_SIZE;
    if (off + PATTERN_SIZE > buf.length) break;
    const block = buf.subarray(off, off + PATTERN_SIZE);
    if (isEmptyPattern(block)) continue;
    // Drum parts: 34B-stride, steps at +18
    for (let pi = 0; pi < DRUM_PARTS; pi++) {
      const partOff = DRUM_PART_OFFSET + pi * DRUM_PART_STRIDE;
      for (let s = 0; s < 16; s++) {
        const v = block[partOff + 18 + s];
        if ((v & 0x01) === 0) continue;
        drumActive++;
        if ((v & 0x10) !== 0) drumBit4++;
      }
    }
    // Short parts: 32B-stride, steps at +16
    for (const partOff of SHORT_PART_OFFSETS) {
      for (let s = 0; s < 16; s++) {
        const v = block[partOff + 16 + s];
        if ((v & 0x01) === 0) continue;
        shortActive++;
        if ((v & 0x10) !== 0) shortBit4++;
      }
    }
  }
}

console.log(`Drum-Parts (Parts 0..9):`);
console.log(`  Total active steps: ${drumActive}`);
console.log(`  with bit-4 set:     ${drumBit4} (${(100*drumBit4/drumActive).toFixed(1)}%)`);

console.log(`\nShort-Parts (Parts 11..14):`);
console.log(`  Total active steps: ${shortActive}`);
console.log(`  with bit-4 set:     ${shortBit4} (${(100*shortBit4/shortActive).toFixed(1)}%)`);

// If accent appears in both drum AND short parts at similar rates,
// the bit-4=accent hypothesis is consistent. If only short-parts have it
// at high rate, it's something else (e.g. synth-specific gate/slide).
