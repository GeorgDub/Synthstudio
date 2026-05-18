#!/usr/bin/env node
/**
 * ESX-1 v3.23.0 Reverse-Engineering: Synth-Part Step-Byte Note-Encoding
 *
 * Question: in Parts 11..14 (32B-stride), step-bytes carry values like 0x11,
 * 0x15, 0x55 — these are NOT pure 0x01 (trigger-only). Hypothesis: upper bits
 * encode note/velocity.
 *
 * Approach:
 *  1) Open BOTTROP.ESX + 3 other files
 *  2) For each non-empty pattern, extract Parts 11..14 step-bytes (16B each)
 *  3) Collect distinct values + distribution
 *  4) Look for bit-pattern that maps to MIDI notes plausibly
 */

import { readFileSync } from "node:fs";

const ESX_DIR = "G:/IdeaProjects/Synthstudio/Korg ESX files";
const PATTERN_DATA_OFFSET = 0x0200;
const PATTERN_SIZE = 4280;
const NUM_PATTERNS = 256;
const SHORT_PART_OFFSETS = [0x36e, 0x38e, 0x3ae, 0x3ce]; // Parts 11..14
const SHORT_PART_HEADER_BYTES = 16;
const STEPS_PER_PART = 16;

// Init-Pattern-Signatur
const INIT_SIG = Uint8Array.from([
  0x3c, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x3c, 0x00, 0x00, 0x7f, 0xff,
]);

function isEmptyPattern(raw) {
  // all-zero in first 32 bytes
  let allZero = true;
  for (let i = 0; i < 32; i++) {
    if (raw[i] !== 0) { allZero = false; break; }
  }
  if (allZero) return true;
  // Init-Signatur
  let hasName = false;
  for (let i = 0; i < 8; i++) {
    const b = raw[i];
    if (b !== 0 && b !== 0x20) { hasName = true; break; }
  }
  if (hasName) return false;
  for (let i = 0; i < INIT_SIG.length; i++) {
    if (raw[8 + i] !== INIT_SIG[i]) return false;
  }
  return true;
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

function analyzeFile(filename) {
  const buf = new Uint8Array(readFileSync(`${ESX_DIR}/${filename}`));
  console.log(`\n========== ${filename} (${buf.length} bytes) ==========`);

  // Collect global step-byte stats per part-position
  const globalStats = new Map(); // value (number) -> count
  const sampleStepBytesByPattern = []; // [{name, partIndex, headerSampleId, headerPitch, steps[16]}]

  for (let p = 0; p < NUM_PATTERNS; p++) {
    const off = PATTERN_DATA_OFFSET + p * PATTERN_SIZE;
    if (off + PATTERN_SIZE > buf.length) break;
    const block = buf.subarray(off, off + PATTERN_SIZE);
    if (isEmptyPattern(block)) continue;
    const name = decodeName(block);

    for (let pi = 0; pi < SHORT_PART_OFFSETS.length; pi++) {
      const partOff = SHORT_PART_OFFSETS[pi];
      if (partOff + 32 > PATTERN_SIZE) continue;
      const sampleId = (block[partOff] << 8) | block[partOff + 1];
      const headerPitch = block[partOff + 6]; // raw byte
      const headerLevel = block[partOff + 7];

      const stepsOff = partOff + SHORT_PART_HEADER_BYTES;
      const steps = new Uint8Array(16);
      for (let s = 0; s < STEPS_PER_PART; s++) {
        steps[s] = block[stepsOff + s];
      }
      // Count distinct step-byte values where bit-0=1 (trigger active)
      let anyActive = false;
      for (let s = 0; s < STEPS_PER_PART; s++) {
        const v = steps[s];
        if ((v & 0x01) === 0) continue;
        anyActive = true;
        globalStats.set(v, (globalStats.get(v) ?? 0) + 1);
      }

      if (anyActive && sampleStepBytesByPattern.length < 12) {
        sampleStepBytesByPattern.push({
          patternIndex: p,
          patternName: name,
          partIndex: 11 + pi,
          sampleId,
          headerPitch,
          headerLevel,
          steps: Array.from(steps),
        });
      }
    }
  }

  // Sort by count desc
  const sorted = [...globalStats.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nDistinct active step-byte values (top 20):`);
  for (const [val, cnt] of sorted.slice(0, 20)) {
    console.log(`  0x${val.toString(16).padStart(2, "0")} (b${val.toString(2).padStart(8, "0")}) : ${cnt}`);
  }

  console.log(`\nSample step-byte rows (showing up to 12):`);
  for (const r of sampleStepBytesByPattern) {
    const hex = r.steps.map(v => v.toString(16).padStart(2, "0")).join(" ");
    console.log(`  Pat[${r.patternIndex}] "${r.patternName}" Part${r.partIndex} sid=0x${r.sampleId.toString(16).padStart(4,"0")} hdrPitch=0x${r.headerPitch.toString(16).padStart(2,"0")} hdrLvl=0x${r.headerLevel.toString(16).padStart(2,"0")}`);
    console.log(`    steps: ${hex}`);
  }

  return { globalStats, sampleStepBytesByPattern };
}

// Analyze 4 files
const files = ["BOTTROP.ESX", "ENDLICH.ESX", "KASSEL.esx", "DUSSELBUNKAAA.esx"];
const allStats = new Map();
for (const f of files) {
  try {
    const r = analyzeFile(f);
    for (const [v, c] of r.globalStats) {
      allStats.set(v, (allStats.get(v) ?? 0) + c);
    }
  } catch (e) {
    console.error(`${f}: ${e.message}`);
  }
}

console.log(`\n========== GLOBAL across 4 files (Parts 11..14 active step bytes) ==========`);
const sortedAll = [...allStats.entries()].sort((a, b) => b[1] - a[1]);
for (const [val, cnt] of sortedAll.slice(0, 30)) {
  const b = val.toString(2).padStart(8, "0");
  console.log(`  0x${val.toString(16).padStart(2, "0")} (b${b}) : ${cnt}`);
}

// Bit-mask analysis: for each bit position, count how often it's set
console.log(`\nPer-bit frequency (only across triggered steps):`);
const bitCounts = [0, 0, 0, 0, 0, 0, 0, 0];
let totalTriggered = 0;
for (const [val, cnt] of allStats) {
  totalTriggered += cnt;
  for (let bit = 0; bit < 8; bit++) {
    if ((val >> bit) & 1) bitCounts[bit] += cnt;
  }
}
for (let bit = 0; bit < 8; bit++) {
  const pct = ((bitCounts[bit] / totalTriggered) * 100).toFixed(1);
  console.log(`  bit ${bit}: ${bitCounts[bit]} / ${totalTriggered} (${pct}%)`);
}
