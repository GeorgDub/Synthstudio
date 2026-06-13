/**
 * tests/features/e2s-bank-from-esx.test.ts
 *
 * One-shot generator: ports the patterns from a real ESX-1 backup
 * (E:\esx\BOTTROP.ESX) into a KORG Electribe 2 Sampler .e2sallpat bank, so the
 * exported bank mirrors the structure of the ESX file (same pattern names, BPM,
 * step triggers, per-part volume/pan/pitch).
 *
 * ESX-1 and E2 Sampler are DIFFERENT hardware/formats — this is a cross-format
 * port of the *sequencer* content. Samples are NOT carried over (separate path);
 * patterns trigger whatever samples the destination E2S has in those part slots.
 *
 * Conditional: skips if the ESX file isn't present (so it's harmless elsewhere).
 * Writes examples/e2s/bottrop-test.e2sallpat + a convenience copy next to the
 * user's real files.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseEsxBank } from "../../client/src/utils/korg/esxParser";
import type { EsxPattern } from "../../client/src/utils/korg/esxParser";
import { buildE2AllPatFile, E2S_ALLPAT_FILE_SIZE } from "../../client/src/utils/e2sExport";
import type { E2PatternInput } from "../../client/src/utils/electribePatternBuilder";
import { parseElectribeAllPatBank } from "../../client/src/utils/electribeImport";

const ESX_PATH = "E:/esx/BOTTROP.ESX";
const EXAMPLE_DIR = path.resolve(process.cwd(), "examples", "e2s");
const EXAMPLE_FILE = path.join(EXAMPLE_DIR, "bottrop-test.e2sallpat");
const CONVENIENCE_FILE = path.resolve(process.cwd(), "Korg e2s files", "bottrop-test.e2sallpat");

const E2_BASE_NOTE = 0x48; // C5 = "no pitch shift"

/** Map one ESX-1 pattern → E2PatternInput (sequencer content only). */
function esxToE2(p: EsxPattern): E2PatternInput {
  const stepLength: 16 | 32 | 64 =
    p.lengthSteps === 32 ? 32 : p.lengthSteps === 64 ? 64 : 16;

  const parts = p.parts.map((part) => {
    // ESX pitch is per-part; E2 note is per-step → apply the same note to all steps.
    const note = Math.max(0, Math.min(127, E2_BASE_NOTE + (part.pitch ?? 0)));
    const steps = part.steps.map((s) => ({
      active: !!s.active,
      velocity: typeof s.velocity === "number" ? s.velocity : undefined,
      accent: !!s.accent,
      note,
    }));
    return {
      volume: part.volume, // already 0..127 on both formats
      pan: part.pan, // already 0..127, 64 = center
      steps,
    };
  });

  return {
    name: p.name || "ESX Pattern",
    bpm: p.bpm,
    stepLength,
    parts,
  };
}

const ESX_AVAILABLE = (() => {
  try {
    return fs.existsSync(ESX_PATH);
  } catch {
    return false;
  }
})();

const runner = ESX_AVAILABLE ? describe : describe.skip;

runner("e2sExport — port BOTTROP.ESX patterns into a .e2sallpat bank", () => {
  const esx = parseEsxBank(new Uint8Array(fs.readFileSync(ESX_PATH)), "BOTTROP.ESX");

  // Keep all non-empty patterns (a name OR at least one active step), cap at 250.
  const nonEmpty = esx.patterns.filter(
    (p) =>
      (p.name && p.name.trim().length > 0) ||
      p.parts.some((pt) => pt.steps.some((s) => s.active)),
  );
  const selected = nonEmpty.slice(0, 250);
  const e2Inputs = selected.map(esxToE2);
  const buffer = buildE2AllPatFile(e2Inputs);
  const bytes = new Uint8Array(buffer);

  it("logs what was parsed from BOTTROP.ESX", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[BOTTROP.ESX] total patterns=${esx.patterns.length}, non-empty=${nonEmpty.length}, ` +
        `mono samples=${esx.monoSamples.length}, stereo=${esx.stereoSamples.length}, ` +
        `warnings=${esx.warnings.length}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      "[BOTTROP.ESX] first patterns: " +
        selected
          .slice(0, 12)
          .map((p, i) => {
            const hits = p.parts.reduce(
              (n, pt) => n + pt.steps.filter((s) => s.active).length,
              0,
            );
            return `#${i}"${p.name || "(unnamed)"}"(${p.bpm}bpm,${p.lengthSteps}st,${hits}hits)`;
          })
          .join("  "),
    );
    expect(esx.patterns.length).toBeGreaterThan(0);
  });

  it("builds a valid, exact-size bank", () => {
    expect(bytes.byteLength).toBe(E2S_ALLPAT_FILE_SIZE);
    expect([...bytes.slice(0, 4)]).toEqual([0x4b, 0x4f, 0x52, 0x47]); // KORG
    expect([...bytes.slice(0x100, 0x104)]).toEqual([0x47, 0x4c, 0x53, 0x54]); // GLST
    expect([...bytes.slice(0x10100, 0x10104)]).toEqual([0x50, 0x54, 0x53, 0x54]); // PTST
  });

  it("round-trips the ported patterns through parseElectribeAllPatBank", () => {
    const bank = parseElectribeAllPatBank(bytes);
    expect(bank.patterns.length).toBe(250);

    // Names + BPM + step-length survive for every ported pattern.
    selected.forEach((src, i) => {
      const parsed = bank.patterns[i];
      // E2 names are max 16 ASCII; ESX names are max 8 → always fit.
      expect(parsed.name).toBe((src.name || "ESX Pattern").slice(0, 16));
      expect(parsed.bpm).toBeCloseTo(src.bpm, 1);
    });

    // Trigger fidelity: total active-step count per pattern matches the source.
    selected.forEach((src, i) => {
      const srcHits = src.parts.reduce(
        (n, pt) => n + pt.steps.slice(0, src.lengthSteps).filter((s) => s.active).length,
        0,
      );
      const parsed = bank.patterns[i];
      const dstHits = parsed.parts.reduce(
        (n, pt) => n + pt.steps.slice(0, src.lengthSteps).filter((s) => s.active).length,
        0,
      );
      expect(dstHits).toBe(srcHits);
    });
  });

  it("writes the bank to disk", () => {
    fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
    fs.writeFileSync(EXAMPLE_FILE, bytes);
    expect(fs.statSync(EXAMPLE_FILE).size).toBe(E2S_ALLPAT_FILE_SIZE);
    try {
      if (fs.existsSync(path.dirname(CONVENIENCE_FILE))) {
        fs.writeFileSync(CONVENIENCE_FILE, bytes);
      }
    } catch {
      /* non-fatal */
    }
  });
});
