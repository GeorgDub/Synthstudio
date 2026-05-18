#!/usr/bin/env node
/**
 * v3.23 Deeper RE: bit-4 analysis + 0x80 mystery + motion-region cross-check.
 *
 * Hypotheses:
 *  H1: bit-4 = accent
 *  H2: 0x80 (bit-7 only, no trigger) = tied/slide marker
 *  H3: Note-Pitch is in the per-step pitch-motion region 0x488+, NOT in step-byte
 *
 * Check: 0x488+ region in BOTTROP[0]. v3.20 mentions "Per-Step Pitch-Motion
 * (0x80 neutral)". Could it be: bytes 0x488+ are per-part-per-step note-pitch?
 */

import { readFileSync } from "node:fs";

const ESX_DIR = "G:/IdeaProjects/Synthstudio/Korg ESX files";
const PATTERN_DATA_OFFSET = 0x0200;
const PATTERN_SIZE = 4280;
const SHORT_PART_OFFSETS = [0x36e, 0x38e, 0x3ae, 0x3ce];

function dumpRange(buf, start, len, label) {
  const hex = Array.from(buf.slice(start, start + len))
    .map(v => v.toString(16).padStart(2, "0"))
    .join(" ");
  console.log(`  [${label}] @0x${start.toString(16)}: ${hex}`);
}

const f = "BOTTROP.ESX";
const buf = new Uint8Array(readFileSync(`${ESX_DIR}/${f}`));
console.log(`Analyzing ${f}`);

// Pattern 0
const p0 = buf.subarray(PATTERN_DATA_OFFSET, PATTERN_DATA_OFFSET + PATTERN_SIZE);
console.log(`\n========== BOTTROP Pattern 0 ==========`);

// Show the part 13 (0x3AE) area with steps
const partOff = 0x3ae;
console.log(`Part 13 @0x${partOff.toString(16)} (32B):`);
dumpRange(p0, partOff, 16, "hdr");
dumpRange(p0, partOff + 16, 16, "steps");

// Show "Per-Step Pitch-Motion Region" from 0x488 onwards
// If parts 11..14 each carry 16 bytes of per-step pitch, we'd expect:
// 4 parts × 16 steps × 1 byte = 64 bytes per region
console.log(`\nMotion region around 0x488 (256B):`);
for (let row = 0; row < 16; row++) {
  dumpRange(p0, 0x488 + row * 16, 16, `0x${(0x488 + row * 16).toString(16)}`);
}

// Look at footer area 0x466..0x488
console.log(`\nFooter region 0x466..0x488:`);
dumpRange(p0, 0x466, 0x488 - 0x466, "footer");

// Look at region between 0x3DE and 0x466
console.log(`\nReserve region 0x3DE..0x466 (136B):`);
for (let row = 0; row < 9; row++) {
  dumpRange(p0, 0x3de + row * 16, 16, `0x${(0x3de + row * 16).toString(16)}`);
}

// Look at total file size
console.log(`\nTotal pattern size: 0x${PATTERN_SIZE.toString(16)} = ${PATTERN_SIZE} bytes`);

// Now: KASSEL Pattern 1 Part 11 has steps "01 00 11 00 11 01 11 11 ..."
// Let's look at its 0x488+ region
const buf2 = new Uint8Array(readFileSync(`${ESX_DIR}/KASSEL.esx`));
const k1 = buf2.subarray(PATTERN_DATA_OFFSET + 1 * PATTERN_SIZE, PATTERN_DATA_OFFSET + 2 * PATTERN_SIZE);
console.log(`\n========== KASSEL Pattern 1 ==========`);
console.log(`Part 11 @0x${SHORT_PART_OFFSETS[0].toString(16)}:`);
dumpRange(k1, SHORT_PART_OFFSETS[0], 16, "hdr");
dumpRange(k1, SHORT_PART_OFFSETS[0] + 16, 16, "steps");
console.log(`Part 12 @0x${SHORT_PART_OFFSETS[1].toString(16)}:`);
dumpRange(k1, SHORT_PART_OFFSETS[1], 16, "hdr");
dumpRange(k1, SHORT_PART_OFFSETS[1] + 16, 16, "steps");

console.log(`\nMotion region around 0x488 (256B):`);
for (let row = 0; row < 16; row++) {
  dumpRange(k1, 0x488 + row * 16, 16, `0x${(0x488 + row * 16).toString(16)}`);
}

// Count distinct values per absolute offset across Pattern 0..50 in BOTTROP
// for parts 11..14 step regions
console.log(`\n========== Per-step-byte distinct-value-count across patterns ==========`);
const positionStats = new Map(); // offset -> Set of distinct values
for (let p = 0; p < 100; p++) {
  const off = PATTERN_DATA_OFFSET + p * PATTERN_SIZE;
  if (off + PATTERN_SIZE > buf.length) break;
  const block = buf.subarray(off, off + PATTERN_SIZE);
  // skip empty
  let allZero = true;
  for (let i = 0; i < 32; i++) {
    if (block[i] !== 0) { allZero = false; break; }
  }
  if (allZero) continue;
  // skip init
  if (block[0] === 0x00 || (block[0] >= 0x20 && block[0] <= 0x7e)) {
    // probably valid; continue
  }

  for (const pOff of SHORT_PART_OFFSETS) {
    for (let s = 0; s < 16; s++) {
      const stepOff = pOff + 16 + s;
      const val = block[stepOff];
      if (val === 0) continue;
      if (!positionStats.has(stepOff)) positionStats.set(stepOff, new Map());
      const m = positionStats.get(stepOff);
      m.set(val, (m.get(val) ?? 0) + 1);
    }
  }
}

// Show top 5 step positions
const sortedPos = [...positionStats.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`\nStep positions with most distinct values (top 8):`);
for (const [off, m] of sortedPos.slice(0, 8)) {
  const dist = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, c]) => `0x${v.toString(16)}(${c})`).join(" ");
  console.log(`  0x${off.toString(16)}: ${m.size} distinct, top: ${dist}`);
}
