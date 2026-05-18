// Phase 3: find ALL part headers — scan whole 4280B block.
import { readFileSync } from "node:fs";

const PATTERN_AREA = 0x0200;
const PATTERN_SIZE = 4280;

function load(path) {
  const buf = readFileSync(path);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const off = PATTERN_AREA + i * PATTERN_SIZE;
    if (off + PATTERN_SIZE > buf.length) break;
    const blk = buf.slice(off, off + PATTERN_SIZE);
    let allZero = true;
    for (let k = 0; k < 32; k++) if (blk[k] !== 0) { allZero = false; break; }
    if (allZero) continue;
    out.push({ idx: i, blk });
  }
  return out;
}

function hex(arr) { return Array.from(arr).map(b => b.toString(16).padStart(2,"0")).join(" "); }

// Hypothesis: parts have shape: <2B sampleId-or-flag> <ff 00> <misc 14B> <16B steps>
// or after pattern 9 — different. Let's catalog ff 00 occurrences in pattern across patterns.

const bottrop = load("Korg ESX files/BOTTROP.ESX");
const kassel = load("Korg ESX files/KASSEL.esx");

console.log("=== Scan: 'ff 00' marker positions across BOTTROP[0..3] (relative to pattern start) ===");
for (const { idx, blk } of bottrop.slice(0, 4)) {
  const offs = [];
  for (let off = 0; off < blk.length - 1; off++) {
    if (blk[off] === 0xff && blk[off+1] === 0x00) offs.push(off);
  }
  console.log(`Pattern ${idx}: ${offs.length} 'ff 00' markers → first 20:`);
  console.log(`  ${offs.slice(0,20).map(o=>'0x'+o.toString(16)).join(", ")}`);
}

// Distinct: find which 'ff 00' offsets are PART HEADERS (look 2 bytes back for plausible sample-id, look forward for steps shape).
// Known drum headers: 0x18, 0x3A, 0x5C, 0x7E, 0xA0, 0xC2, 0xE4, 0x106, 0x128, 0x14A — that's 10 parts, each +34.
// 10th: 0x14A. Next would be 0x16C, but 0x16C is motion-default region. So drum-stride breaks at part 10.
// First non-drum header was at 0x25C.

console.log("\n\n=== Hypothesis test: are there more part headers after 0x25C? ===");
// Check: does the part at 0x25C have step-data at 0x25C+18..+34?
const p = bottrop[0].blk;
console.log("Part-candidate at 0x25C:");
console.log("  header: " + hex(p.slice(0x25c, 0x25c+18)));
console.log("  steps:  " + hex(p.slice(0x25c+18, 0x25c+34)));

// Hex at 0x35C — 0x25C + 256? or look further
console.log("\n--- Scanning every 0x100 from 0x35C for plausible header (+2,+3 = ff 00) ---");
for (let off = 0x300; off < 0x800; off++) {
  if (p[off+2] === 0xff && p[off+3] === 0x00 && (p[off]===0 || p[off]===1)) {
    console.log(`  0x${off.toString(16)}: ${hex(p.slice(off, off+34))}`);
  }
}

// Pattern 1 to see if part-after-25c shifts:
console.log("\n--- BOTTROP[1] same scan ---");
const p1 = bottrop[1].blk;
for (let off = 0x300; off < 0x800; off++) {
  if (p1[off+2] === 0xff && p1[off+3] === 0x00 && (p1[off]===0 || p1[off]===1)) {
    console.log(`  0x${off.toString(16)}: ${hex(p1.slice(off, off+34))}`);
  }
}

// Approach: locate ALL FF 00 occurrences and cluster by relative offset
console.log("\n\n=== ALL 'ff 00' offsets BOTTROP[0] (excl 0x800-end which is mostly motion 0x80 region) ===");
const allFF = [];
for (let off = 0; off < 0x800; off++) {
  if (p[off] === 0xff && p[off+1] === 0x00) allFF.push(off);
}
console.log(`  count: ${allFF.length}`);
console.log(`  offsets: ${allFF.map(o=>'0x'+o.toString(16)).join(", ")}`);

// Diff: known drum part headers at 0x18+2 = 0x1A, 0x3A+2 = 0x3C, ...
// Recompute: 0x18+2 = 0x1A, 0x18+34+2 = 0x3C, +34 = 0x5E, +34 = 0x80, +34 = 0xA2, +34 = 0xC4, +34 = 0xE6, +34 = 0x108, +34 = 0x12A, +34 = 0x14C
console.log("\n  Expected drum-part 'ff 00' offsets: 0x1A, 0x3C, 0x5E, 0x80, 0xA2, 0xC4, 0xE6, 0x108, 0x12A, 0x14C");

// Now: 0x25E (the +2 of the 0x25C candidate). What comes AFTER? If there's no struct, parts 10-15 might be elsewhere
// Let's also check what's in motion area 0x16C..0x25C — 240 bytes, suspicious.
console.log("\n\n=== Detail: BOTTROP[0] 0x16C..0x25C ===");
for (let off = 0x16C; off < 0x25C; off += 32) {
  console.log(`  0x${off.toString(16)}: ${hex(p.slice(off, off+32))}`);
}
// what's at 0x16C looks like 16 bytes × 15 = 240. So this might be a 16×16=256? No, 16×15 = 240.
// 240 bytes = 16 steps × 15 parts? Or 15 × 16 bytes per part? With first byte 'amplitude' / 0xbc default?
// Pattern: every 16th byte slightly different. Let's see 0x16C, 0x17C, 0x18C, ...

console.log("\n=== Try 16-byte stride starting at 0x16C ===");
for (let i = 0; i < 16; i++) {
  const off = 0x16C + i*16;
  console.log(`  block ${i} @0x${off.toString(16)}: ${hex(p.slice(off, off+16))}`);
}
