// Phase 4: find the remaining part-headers. Try smaller strides.
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
const factory = load("Korg ESX files/ESX_FILE.ESX");
const p = bottrop[0].blk;

// Inspect 0x3xx region — saw structure
console.log("=== BOTTROP[0] 0x270..0x500 detail ===");
for (let off = 0x270; off < 0x500; off += 32) {
  console.log(`  0x${off.toString(16)}: ${hex(p.slice(off, off+32))}`);
}

// The 0x25C 34B-block contains: 00 1f ff 00 40 03 7f 00 40 7f 40 7f 01 15 92 57 5e 00 21 bc bc bc bc bc bc bc bc bc bc bc bc bc bc bc
// then more bc bc until 0x2EC
// then 0x2EE = 6d 02 ...02 (16 bytes) — that's a motion lane?
// then 0x2FE = 64 02 02 ...
// Looks like Pattern 11 = stretch with sample-id 0x001F and motion data (the bc/02 stuff is per-step modulation).

// Let's see pattern 1's similar region:
console.log("\n=== BOTTROP[1] 0x250..0x500 ===");
const p1 = bottrop[1].blk;
for (let off = 0x250; off < 0x500; off += 32) {
  console.log(`  0x${off.toString(16)}: ${hex(p1.slice(off, off+32))}`);
}

// Hmm — look at offsets 0x358..0x3D8 of bottrop[0]: looks like part-headers WITHOUT the ff00 prefix
// 0x358: 02 02 02 ... 02 00 54 00 7f 00 40 5e 6e 40 7f 00 05 82 58 68 00 (this is a 16-byte step area?)
// Actually 0x36E onward: 00 54 00 7f 00 40 5e 6e 40 7f 00 05 82 58 68 00 — this looks like a part HEADER (level=0x6e, pan=0x40, fx=0x05)
// Then 0x37F: 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 → 16 step bytes (active on bit 0 at positions 2,10)

console.log("\n=== Hypothesis: parts 11..15 use NO ff-00 marker, smaller header (maybe 18 or 16B) ===");
console.log("BOTTROP[0] 0x36E header attempt: " + hex(p.slice(0x36e, 0x36e+18)));
console.log("BOTTROP[0] 0x36E + 18 (step bytes): " + hex(p.slice(0x36e+18, 0x36e+34)));

console.log("\n=== Inspect ESX_FILE 'Tekk 175' pattern (factory) at offset 0x25C+ ===");
const f0 = factory[0].blk;
for (let off = 0x250; off < 0x500; off += 32) {
  console.log(`  0x${off.toString(16)}: ${hex(f0.slice(off, off+32))}`);
}

// Also check if part-count is greater than 11 by scanning for ALL ff-bytes-pattern in factory
console.log("\n=== Factory pattern 0 'Tekk 175' — ff 00 markers ===");
const fOffs = [];
for (let off = 0; off < f0.length-1; off++) {
  if (f0[off] === 0xff && f0[off+1] === 0x00) fOffs.push(off);
}
console.log(`  ${fOffs.length} markers: ${fOffs.slice(0,30).map(o=>'0x'+o.toString(16)).join(', ')}`);
