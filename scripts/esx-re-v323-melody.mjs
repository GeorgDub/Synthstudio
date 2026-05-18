#!/usr/bin/env node
/**
 * v3.23 Find the "melody-like" rows: high distinct-value-count rows where the
 * upper 7 bits could be a NOTE-PITCH.
 *
 * If a row has 11-16 distinct values across 16 steps, that's likely a melodic
 * synth-track. Show those rows and check if (val >> 1) maps to a musical
 * sequence.
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

function decodeName(raw) {
  let s = "";
  for (let i = 0; i < 8; i++) {
    const b = raw[i];
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
  }
  return s.trim();
}

const files = ["BOTTROP.ESX", "ENDLICH.ESX", "KASSEL.esx", "TOBI.ESX", "YOYOY.ESX"];

const melodicRows = [];
for (const f of files) {
  let buf;
  try { buf = new Uint8Array(readFileSync(`${ESX_DIR}/${f}`)); }
  catch { continue; }
  for (let p = 0; p < 256; p++) {
    const off = PATTERN_DATA_OFFSET + p * PATTERN_SIZE;
    if (off + PATTERN_SIZE > buf.length) break;
    const block = buf.subarray(off, off + PATTERN_SIZE);
    if (isEmptyPattern(block)) continue;
    const name = decodeName(block);
    for (let pi = 0; pi < 4; pi++) {
      const pOff = SHORT_PART_OFFSETS[pi];
      const stepBytes = [];
      const setActive = new Set();
      for (let s = 0; s < 16; s++) {
        const v = block[pOff + 16 + s];
        stepBytes.push(v);
        if (v !== 0) setActive.add(v);
      }
      if (setActive.size >= 10) {
        const sid = (block[pOff] << 8) | block[pOff + 1];
        const hdrPitch = block[pOff + 6];
        melodicRows.push({
          file: f, pattern: p, name, part: 11 + pi,
          sid, hdrPitch, stepBytes,
          distinctCount: setActive.size,
        });
      }
    }
  }
}

console.log(`Found ${melodicRows.length} melody-candidate rows (>=10 distinct values)`);
console.log(`\nShowing first 12:`);
for (const r of melodicRows.slice(0, 12)) {
  const hex = r.stepBytes.map(v => v.toString(16).padStart(2, "0")).join(" ");
  const upper = r.stepBytes.map(v => (v >> 1).toString(16).padStart(2, "0")).join(" ");
  console.log(`\n${r.file} Pat[${r.pattern}] "${r.name}" Part${r.part} sid=0x${r.sid.toString(16).padStart(4,"0")} hdrPitch=0x${r.hdrPitch.toString(16).padStart(2,"0")} distinct=${r.distinctCount}`);
  console.log(`  steps (raw): ${hex}`);
  console.log(`  steps (>>1): ${upper}`);
  // Check if upper 7 bits look like MIDI notes (in 0..127 range — they always are)
  // and form a MUSICAL pattern (e.g. monotonic, scale-degrees, repeated motifs)
  const upperVals = r.stepBytes.filter(v => v !== 0).map(v => v >> 1);
  const sorted = [...upperVals].sort((a, b) => a - b);
  const range = sorted[sorted.length - 1] - sorted[0];
  console.log(`  upper-vals: min=${sorted[0]}, max=${sorted[sorted.length - 1]}, range=${range}`);
}

// Theory: if upper-7-bits is a note, range across a typical bassline would be 12-36 semis
// If range is 100+ → not a note (too wide)
// If range is 0-30 → plausible note range
console.log(`\n\nUpper-7-bit range distribution across all melody-candidate rows:`);
const ranges = melodicRows.map(r => {
  const active = r.stepBytes.filter(v => v !== 0);
  if (active.length === 0) return 0;
  const uppers = active.map(v => v >> 1);
  return Math.max(...uppers) - Math.min(...uppers);
});
ranges.sort((a, b) => a - b);
console.log(`  min range: ${ranges[0]}`);
console.log(`  median:    ${ranges[Math.floor(ranges.length / 2)]}`);
console.log(`  max:       ${ranges[ranges.length - 1]}`);
console.log(`  mean:      ${(ranges.reduce((a, b) => a + b, 0) / ranges.length).toFixed(1)}`);

// Count how many fit in a 36-semitone "musical" range
const musical = ranges.filter(r => r <= 36).length;
console.log(`  <=36 semis: ${musical}/${ranges.length} (${(100*musical/ranges.length).toFixed(1)}%)`);
const wide = ranges.filter(r => r > 64).length;
console.log(`  >64 (impossible-as-note): ${wide}/${ranges.length}`);
