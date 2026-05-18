// One-shot RE script for ESX-1 pattern layout v3.20
// Goal: pin down pitch + fxSend bytes in drum-part header (34B stride),
//       and discover parts 10..15 layout (Stretch / Slice / Audio-In / Synth).

import { readFileSync } from "node:fs";

const PATTERN_AREA = 0x0200;
const PATTERN_SIZE = 4280;
const DRUM_PART_OFFSET = 0x18;
const DRUM_STRIDE = 34;
const DRUM_PARTS = 10;
const STEPS = 16;

function loadPatterns(path) {
  const buf = readFileSync(path);
  const patterns = [];
  for (let i = 0; i < 256; i++) {
    const off = PATTERN_AREA + i * PATTERN_SIZE;
    if (off + PATTERN_SIZE > buf.length) break;
    const blk = buf.slice(off, off + PATTERN_SIZE);
    // skip "all zero" pattern (synthetic init)
    let allZero = true;
    for (let k = 0; k < 32; k++) if (blk[k] !== 0) { allZero = false; break; }
    if (allZero) continue;
    // skip init signature
    const sig = [0x3c,0x00,0x00,0x00,0x00,0x0f,0x00,0x3c,0x00,0x00,0x7f,0xff];
    let isInit = true;
    for (let k = 0; k < 8; k++) {
      const b = blk[k];
      if (b >= 0x20 && b <= 0x7e && b !== 0x20) { isInit = false; break; }
    }
    if (isInit) {
      for (let k = 0; k < 12; k++) {
        if (blk[8+k] !== sig[k]) { isInit = false; break; }
      }
    }
    if (isInit) continue;
    patterns.push({ idx: i, blk });
  }
  return patterns;
}

function decodeName(blk) {
  let s = "";
  for (let i = 0; i < 8; i++) {
    const b = blk[i];
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
    else break;
  }
  return s.replace(/\s+$/, "");
}

function hex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2,"0")).join(" ");
}

function dumpPartHeader(blk, partIdx) {
  const off = DRUM_PART_OFFSET + partIdx * DRUM_STRIDE;
  return blk.slice(off, off + 18); // 18B header
}

function dumpPartSteps(blk, partIdx) {
  const off = DRUM_PART_OFFSET + partIdx * DRUM_STRIDE + 18;
  return blk.slice(off, off + 16);
}

// ── Phase 1: dump header bytes for non-empty parts in BOTTROP[0..3] ──
console.log("=== Phase 1: BOTTROP drum-part headers (find pitch/fxSend var) ===\n");
const bottrop = loadPatterns("Korg ESX files/BOTTROP.ESX");
console.log(`BOTTROP non-empty patterns: ${bottrop.length}`);

// Look at first 4 patterns, show all 10 drum part headers
for (const { idx, blk } of bottrop.slice(0, 3)) {
  console.log(`\n--- Pattern ${idx} "${decodeName(blk)}" BPM=${((blk[8]<<8)|blk[9])/128} ---`);
  for (let p = 0; p < DRUM_PARTS; p++) {
    const h = dumpPartHeader(blk, p);
    const s = dumpPartSteps(blk, p);
    let stepCount = 0;
    for (const sb of s) if (sb & 1) stepCount++;
    if (stepCount === 0) continue;
    console.log(`  P${p}: header=${hex(h)}  steps(${stepCount})`);
  }
}

// ── Phase 2: compare a specific part header BYTE-BY-BYTE across many patterns
// to identify which positions vary — those are the candidates for pitch/fxSend.
console.log("\n\n=== Phase 2: Per-byte variance in part-0 header across all BOTTROP patterns ===");
const variance = new Map(); // byteOff -> Set of values
for (let i = 0; i < 18; i++) variance.set(i, new Set());
for (const { blk } of bottrop) {
  for (let p = 0; p < DRUM_PARTS; p++) {
    const h = dumpPartHeader(blk, p);
    // only count parts that are active (have at least 1 trigger)
    const s = dumpPartSteps(blk, p);
    let any = false;
    for (const b of s) if (b & 1) { any = true; break; }
    if (!any) continue;
    for (let k = 0; k < 18; k++) variance.get(k).add(h[k]);
  }
}
for (let k = 0; k < 18; k++) {
  const vals = Array.from(variance.get(k));
  console.log(`  +${k.toString().padStart(2)}: ${vals.length} unique values: [${vals.slice(0,12).map(v=>v.toString(16).padStart(2,"0")).join(",")}${vals.length>12?",…":""}]`);
}

// ── Phase 3: compare Part 5 (Kick) vs Part 6 (Snare/HiHat) headers in pattern 0
console.log("\n\n=== Phase 3: BOTTROP[0] Part 5 vs Part 6 header diff ===");
const p0 = bottrop[0].blk;
const h5 = dumpPartHeader(p0, 5);
const h6 = dumpPartHeader(p0, 6);
console.log(`  P5: ${hex(h5)}`);
console.log(`  P6: ${hex(h6)}`);
for (let k = 0; k < 18; k++) {
  if (h5[k] !== h6[k]) {
    console.log(`    differ at +${k}: P5=0x${h5[k].toString(16).padStart(2,"0")} vs P6=0x${h6[k].toString(16).padStart(2,"0")}`);
  }
}

// ── Phase 4: Dump region 0x16C..0x300 for BOTTROP[0] to spot parts 10..15 layout
console.log("\n\n=== Phase 4: BOTTROP[0] region 0x16C..0x300 (parts 10..15 candidates) ===");
for (let off = 0x16C; off < Math.min(0x300, p0.length); off += 32) {
  const slice = p0.slice(off, Math.min(off+32, p0.length));
  console.log(`  0x${off.toString(16).padStart(3,"0")}: ${hex(slice)}`);
}

// ── Phase 5: end of pattern block (motion seq / footer) ──
console.log("\n\n=== Phase 5: BOTTROP[0] region 0x800..0xA00 (mid block) ===");
for (let off = 0x800; off < Math.min(0xA00, p0.length); off += 32) {
  const slice = p0.slice(off, Math.min(off+32, p0.length));
  console.log(`  0x${off.toString(16).padStart(3,"0")}: ${hex(slice)}`);
}
console.log("\n=== Phase 5b: BOTTROP[0] region 0x1000..0x1100 ===");
for (let off = 0x1000; off < Math.min(0x1100, p0.length); off += 32) {
  const slice = p0.slice(off, Math.min(off+32, p0.length));
  console.log(`  0x${off.toString(16).padStart(3,"0")}: ${hex(slice)}`);
}
