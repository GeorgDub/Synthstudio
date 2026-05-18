// Phase 2: confirm pitch/fxSend hypothesis + map parts 10..15.
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
const kassel = load("Korg ESX files/KASSEL.esx");
const endlich = load("Korg ESX files/ENDLICH.ESX");
const factory = load("Korg ESX files/ESX_FILE.ESX");

console.log("=== Phase A: Confirm 'pitch' at +8 is signed two's-complement (range -64..+63) ===");
console.log("Look for parts where +8 is large (>0x7F = negative)");
for (const file of [{name:"BOTTROP", pats:bottrop}, {name:"KASSEL", pats:kassel}]) {
  console.log(`\n[${file.name}]`);
  let lo = 999, hi = -999, lo7 = 999, hi7 = -999;
  const dist = new Map();
  for (const { blk } of file.pats) {
    for (let p = 0; p < 10; p++) {
      const off = 0x18 + p * 34;
      const b8 = blk[off + 8];
      lo = Math.min(lo, b8); hi = Math.max(hi, b8);
      const sgn = b8 >= 0x80 ? b8 - 0x100 : b8;
      lo7 = Math.min(lo7, sgn); hi7 = Math.max(hi7, sgn);
      dist.set(b8, (dist.get(b8) || 0) + 1);
    }
  }
  console.log(`  +8 raw u8 range: ${lo}..${hi}  (signed: ${lo7}..${hi7})`);
  const sorted = Array.from(dist.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log(`  +8 top values: ${sorted.map(([v,c])=>`0x${v.toString(16).padStart(2,"0")}(${c})`).join(", ")}`);
}

console.log("\n\n=== Phase B: Region 0x25C..0x800 — find structured part headers for parts 10..15 ===");
const p0 = bottrop[0].blk;
// Dump 16B blocks starting at 0x25C; look for 'ff 00' marker (which all drum-parts had at +2..+3)
console.log("0x25C..0x800 in 32B rows:");
for (let off = 0x258; off < 0x500; off += 32) {
  const slice = p0.slice(off, off + 32);
  console.log(`  0x${off.toString(16).padStart(3,"0")}: ${hex(slice)}`);
}

console.log("\n\n=== Phase C: Scan for 'ff 00' marker positions in BOTTROP[0] (excluding known drum-part headers) ===");
const knownPartHeaderFf00 = new Set();
for (let p = 0; p < 10; p++) knownPartHeaderFf00.add(0x18 + p*34 + 2);
for (let off = 0; off < p0.length - 1; off++) {
  if (p0[off] === 0xff && p0[off+1] === 0x00) {
    if (!knownPartHeaderFf00.has(off) && off > 0x100) {
      // ignore the all-0x80 padding-region tails
      const surrounding = p0.slice(Math.max(0, off-6), Math.min(p0.length, off+16));
      console.log(`  0x${off.toString(16).padStart(4,"0")}: ...${hex(surrounding)}...`);
      if (off > 0x800) {
        // limit verbosity
      }
    }
  }
}

console.log("\n\n=== Phase D: Find candidate part-headers by scanning for plausible 'sample-id + ff 00' shape ===");
// Pattern: b0=0x00/0x01, b1=varies, b2=0xff, b3=0x00
for (let off = 0x16C; off < 0x800; off++) {
  if ((p0[off] === 0x00 || p0[off] === 0x01) && p0[off+2] === 0xff && p0[off+3] === 0x00) {
    console.log(`  found ff 00 marker at 0x${off.toString(16)}: ${hex(p0.slice(off, off+34))}`);
  }
}

console.log("\n\n=== Phase E: Same scan in KASSEL[0] ===");
const k0 = kassel[0].blk;
console.log(`KASSEL[0] name = '${String.fromCharCode(...k0.slice(0,8)).replace(/\0/g,"")}'`);
for (let off = 0x16C; off < 0x800; off++) {
  if ((k0[off] === 0x00 || k0[off] === 0x01) && k0[off+2] === 0xff && k0[off+3] === 0x00) {
    console.log(`  found ff 00 marker at 0x${off.toString(16)}: ${hex(k0.slice(off, off+34))}`);
  }
}

console.log("\n\n=== Phase F: ESX_FILE (factory) BodyTalk-style patterns ===");
// Find pattern with name "BodyTalk" or similar synth-heavy name
for (const { idx, blk } of factory.slice(0, 30)) {
  let s = "";
  for (let i = 0; i < 8; i++) {
    const b = blk[i];
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
  }
  console.log(`  [${idx}] '${s.trim()}'`);
}
