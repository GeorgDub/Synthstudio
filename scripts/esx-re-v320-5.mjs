// Phase 5: nail down 16B header + 16B step parts (parts 11..15 / Stretch×2 + Sample×2 + Slice + ...)
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

const bottrop = load("Korg ESX files/BOTTROP.ESX");

console.log("=== Step structure scan: BOTTROP[1] parts at 0x36E, 0x38E, 0x3AE, 0x3CE ===");
const p1 = bottrop[1].blk;
const POSITIONS = [0x36e, 0x38e, 0x3ae, 0x3ce];
for (const off of POSITIONS) {
  const hdr = p1.slice(off, off+16);
  const steps = p1.slice(off+16, off+32);
  let activeSteps = 0;
  for (const s of steps) if (s & 1) activeSteps++;
  console.log(`  0x${off.toString(16)}: hdr=${hex(hdr)}  steps=${hex(steps)} (active=${activeSteps})`);
}

// Look across multiple BOTTROP patterns to see variation
console.log("\n\n=== Same parts across BOTTROP[0..4] ===");
for (const off of POSITIONS) {
  console.log(`\nPart @ pattern-rel 0x${off.toString(16)}:`);
  for (const { idx, blk } of bottrop.slice(0, 5)) {
    const hdr = blk.slice(off, off+16);
    const steps = blk.slice(off+16, off+32);
    let activeSteps = 0;
    for (const s of steps) if (s & 1) activeSteps++;
    console.log(`  P${idx}: hdr=${hex(hdr)} steps(${activeSteps})=${hex(steps)}`);
  }
}

// Also: what comes between 0x3DE and 0x40E?
console.log("\n=== BOTTROP[1] 0x3D0..0x46E ===");
for (let off = 0x3d0; off < 0x46e; off += 32) {
  console.log(`  0x${off.toString(16)}: ${hex(p1.slice(off, off+32))}`);
}

// At 0x3CE we saw: 00 7f 00 40 64 40 7f 00 82 5c 7f 00 00 00 00 00
// Could be accent or synth pattern. Let's check 0x3DE..0x3FE if there's a 5th part
// 0x3D0: 00 40 64 40 7f 00 82 5c 7f 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 02 02 02 02 02 02
// Hmm: bytes 0x3D0..0x3DD are 14 bytes of header continuation; then 0x3DE = all-zero 16 bytes; then 0x3EE+ is 02-padded motion-region

// Actually 0x3CE..0x3DD = 16 byte header, 0x3DE..0x3ED = 16 byte step (all zero = empty)
// So that's still a part header just with no triggers (Synth 2 = unused).

// Let me look at the END of pattern block — 0x466..0x4FE is the "footer" with patterns 0d 4b 7f 00 etc
console.log("\n=== BOTTROP[1] 0x46C..0x4A0 (footer) ===");
for (let off = 0x466; off < 0x4a8; off += 32) {
  console.log(`  0x${off.toString(16)}: ${hex(p1.slice(off, off+32))}`);
}
// 0x46C: 40 00 ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff 0d 4b 7f 00 03 32 7f 00 01 34 00 00 ff ff
// This looks like the Audio-In/Accent area or pattern-tail signature

// Now check 0x800..1100 — that's the motion-sequencer-per-step region (16 lanes × 64 bytes?)
console.log("\n=== Region 0x800..0x830 ===");
console.log(`  0x800: ${hex(p1.slice(0x800, 0x820))}`);

// The pattern footer / chord-data region
// And 0x500..0x800?
console.log("\n=== BOTTROP[1] 0x4A0..0x508 (post-footer) ===");
for (let off = 0x4a0; off < 0x508; off += 32) {
  console.log(`  0x${off.toString(16)}: ${hex(p1.slice(off, off+32))}`);
}

// Tally:
// 0x000 .. 0x017 = global pattern header (24B)
// 0x018 .. 0x16B = 10 drum-parts × 34B (340B)
// 0x16C .. 0x25B = ~240B motion-lanes for drum parts (15 lanes × 16B)
// 0x25C .. 0x27D = part 10 (Stretch-Slot 1): 34B
// 0x27E .. 0x2ED = motion for stretch part (~112B = 7 lanes × 16B)
// 0x2EE .. 0x35D = ~112B more motion lanes (or another part's motion)
// 0x35E .. ... = 5 more parts × 32B = 160B = parts 11-15 (Stretch 2, Sample 1, Sample 2, Slice 1, Slice 2 + accent?)
// Let's verify the math: 0x35E + 5*32 = 0x35E + 0xA0 = 0x3FE
// Then 0x3FE..0x466 = 104B "unknown"
// 0x466 = 'audio-in / accent' footer
// 0x478 = 'ff ff' bookend?
// 0x47A.. = misc

console.log("\n\n=== Try to find ALL part-header starts in BOTTROP[1] by step-pattern signature ===");
// signature: 16 bytes where >=1 byte has bit-0 set and remaining bytes are mostly 0
function looksLikeStepArray(buf, off) {
  let actives = 0;
  let zeros = 0;
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    if (b === 0) zeros++;
    else if ((b & 1) && (b < 0x20 || b === 0x55 || b === 0x15 || b === 0x11)) actives++;
  }
  return actives >= 1 && (actives + zeros) >= 12;
}

console.log("Candidate step arrays in 0x300..0x500:");
for (let off = 0x300; off < 0x500; off++) {
  if (looksLikeStepArray(p1, off)) {
    console.log(`  steps at 0x${off.toString(16)} → header may be at 0x${(off-16).toString(16)}: hdr=${hex(p1.slice(off-16, off))}`);
  }
}
