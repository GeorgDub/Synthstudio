#!/usr/bin/env node
/**
 * v3.23 Final hypothesis-check:
 *
 * Bit-distribution shows:
 *   bit 0 = trigger (100%)
 *   bit 4 = special (38.7%)
 *   bits 1,2,3,5,6,7 = ~13-18% each
 *
 * Distinct top values: 0x01, 0x11, 0x41, 0x15, 0x05, 0x81, 0x09, 0x03,
 * 0x21, 0x51, 0x55, 0x19, 0x0b, 0x45, 0x13, 0x89, 0x0d, 0x31, 0x61, 0xc1
 *
 * Theory check: ESX-1 has ROLL TYPES per step.
 *   - Trigger only (no roll)        = 0x01
 *   - Trigger + roll               = 0x?? with bit-X set
 *   - Different roll-divisions (1/16, 1/24, 1/32, 1/48) require 2 bits
 *
 * Alternative: ESX-1 has GATE (slide / tie) per step.
 *
 * The hypothesis "note-pitch in step-byte" requires variable values per step,
 * but BOTTROP Pat[3] Part13 shows extremely regular pattern:
 *   11 11 15 11 11 51 11 11 15 11 11 11 15 11 11 51
 * → not note-pitch (too uniform), more like accent/roll/slide flags.
 *
 * Hypothesis: bits 1..7 are STEP-FLAGS:
 *   bit 4 = accent
 *   bit 2 = roll
 *   bit 6 = slide
 * etc.
 *
 * Plan: count bit-combinations across all real-files and verify there's NO
 * pattern that would suggest note-pitch encoding (e.g. monotonically
 * increasing values like a scale).
 */

import { readFileSync } from "node:fs";

const ESX_DIR = "G:/IdeaProjects/Synthstudio/Korg ESX files";
const PATTERN_DATA_OFFSET = 0x0200;
const PATTERN_SIZE = 4280;
const SHORT_PART_OFFSETS = [0x36e, 0x38e, 0x3ae, 0x3ce];

function isEmptyPattern(raw) {
  let allZero = true;
  for (let i = 0; i < 32; i++) if (raw[i] !== 0) { allZero = false; break; }
  return allZero;
}

const files = ["BOTTROP.ESX", "ENDLICH.ESX", "KASSEL.esx", "TOBI.ESX", "YOYOY.ESX"];

// Build distribution of step-byte values across all parts/patterns/files
const dist = new Map();
let totalActive = 0;
for (const f of files) {
  let buf;
  try { buf = new Uint8Array(readFileSync(`${ESX_DIR}/${f}`)); }
  catch { continue; }
  for (let p = 0; p < 256; p++) {
    const off = PATTERN_DATA_OFFSET + p * PATTERN_SIZE;
    if (off + PATTERN_SIZE > buf.length) break;
    const block = buf.subarray(off, off + PATTERN_SIZE);
    if (isEmptyPattern(block)) continue;
    for (const pOff of SHORT_PART_OFFSETS) {
      for (let s = 0; s < 16; s++) {
        const v = block[pOff + 16 + s];
        if ((v & 0x01) === 0) continue;
        totalActive++;
        dist.set(v, (dist.get(v) ?? 0) + 1);
      }
    }
  }
}

console.log(`Total active steps (Parts 11..14, 5 files): ${totalActive}`);
console.log(`Distinct values: ${dist.size}`);
console.log(`\nAll values sorted by count:`);
const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, c] of sorted) {
  console.log(`  0x${v.toString(16).padStart(2, "0")} (b${v.toString(2).padStart(8, "0")}) : ${c}`);
}

// Look at masked-without-trigger:
console.log(`\n\nUpper 7 bits distribution (val >> 1):`);
const upperDist = new Map();
for (const [v, c] of dist) {
  const upper = v >> 1;
  upperDist.set(upper, (upperDist.get(upper) ?? 0) + c);
}
const sortedUpper = [...upperDist.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, c] of sortedUpper.slice(0, 15)) {
  console.log(`  0x${v.toString(16).padStart(2, "0")} (b${v.toString(2).padStart(7, "0")}) : ${c}`);
}

// Check note-pitch hypothesis: are step values for a single part-row showing
// "musical progression" (e.g. typical bassline pattern)?
// → if step values were notes, we'd expect 4-8 distinct values per pattern
//   (a melodic phrase) NOT just 0x01/0x11/0x15.
console.log(`\n\nDistinct step-byte values WITHIN single (file, pattern, part) tuple:`);
const buckets = []; // {distinctCount, name}
for (const f of files) {
  let buf;
  try { buf = new Uint8Array(readFileSync(`${ESX_DIR}/${f}`)); }
  catch { continue; }
  for (let p = 0; p < 256; p++) {
    const off = PATTERN_DATA_OFFSET + p * PATTERN_SIZE;
    if (off + PATTERN_SIZE > buf.length) break;
    const block = buf.subarray(off, off + PATTERN_SIZE);
    if (isEmptyPattern(block)) continue;
    for (let pi = 0; pi < 4; pi++) {
      const pOff = SHORT_PART_OFFSETS[pi];
      const set = new Set();
      let activeCount = 0;
      for (let s = 0; s < 16; s++) {
        const v = block[pOff + 16 + s];
        if (v !== 0) { set.add(v); activeCount++; }
      }
      if (activeCount > 0) {
        buckets.push({ distinctCount: set.size, activeCount, file: f, p, part: 11+pi });
      }
    }
  }
}

const distinctBuckets = new Map(); // distinctCount -> count
for (const b of buckets) {
  distinctBuckets.set(b.distinctCount, (distinctBuckets.get(b.distinctCount) ?? 0) + 1);
}
console.log(`Distinct-value-counts within a part-row (across ${buckets.length} active rows):`);
for (const [dc, c] of [...distinctBuckets].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${dc} distinct value(s) in row: ${c} rows`);
}

// If most rows have 1-3 distinct values, it's NOT a melody — it's flags.
console.log(`\nInterpretation: If most rows have ≤3 distinct values, step-bytes are FLAGS not NOTES.`);
