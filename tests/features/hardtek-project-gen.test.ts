/**
 * Hardtek-150-Projekt-Generator + Validierung.
 *
 * Baut aus einem Manifest (Kit-Pfade + Pattern-Grids, erzeugt von
 * scripts/flip/gen_hardtek.py) ein echtes SynthProject über den realen
 * serializeProject und validiert es über den realen parseProject — so ist die
 * generierte .synth garantiert ladbar (kein fragiles Hand-JSON).
 *
 * - Der Always-Run-Test round-trippt ein winziges Inline-Manifest (keepable,
 *   keine Datei-Seiteneffekte).
 * - Die echte .synth wird NUR geschrieben wenn GEN_HARDTEK=1 gesetzt ist
 *   (liest E:\…\manifest.json, schreibt E:\…\Hardtek 150.synth). Damit
 *   verschmutzt der normale Testlauf keine Disk.
 */
import { describe, it, expect } from "vitest";
import {
  serializeProject,
  toJson,
  parseProject,
  type SynthProject,
} from "@/utils/projectSerializer";
import { DEFAULT_CHANNEL_FX } from "@/audio/AudioEngine";
import type { PatternData, PartData, StepData } from "@/audio/AudioEngine";

interface Manifest {
  bpm: number;
  projectName: string;
  kit: Record<string, { file: string; path: string }>;
  gains: Record<string, number>;
  patterns: Record<string, Record<string, Record<string, number>>>;
  patternOrder: string[];
}

const STEP_COUNT = 16;

function buildPart(role: string, lane: Record<string, number>, mani: Manifest): PartData {
  const k = mani.kit[role];
  const gain = mani.gains[role] ?? 0.8;
  const steps: StepData[] = Array.from({ length: STEP_COUNT }, (_, i) => {
    const key = String(i);
    if (key in lane) {
      return { active: true, velocity: 110, pitch: lane[key] || 0 };
    }
    return { active: false };
  });
  return {
    id: `part-${role}`,
    name: role,
    sampleUrl: k.path,
    sampleName: k.file,
    muted: false,
    soloed: false,
    volume: Math.max(0, Math.min(1, gain)),
    pan: 0,
    steps,
    fx: { ...DEFAULT_CHANNEL_FX },
    sourceType: "sample",
  };
}

function buildProject(mani: Manifest): SynthProject {
  const patterns: PatternData[] = mani.patternOrder.map((name, pi) => {
    const lanes = mani.patterns[name];
    const parts = Object.entries(lanes).map(([role, lane]) => buildPart(role, lane, mani));
    return {
      id: `pat-${pi}`,
      name,
      stepCount: STEP_COUNT,
      stepResolution: "1/16",
      bpm: null,
      parts,
    };
  });
  const samples = Object.entries(mani.kit).map(([role, k]) => ({
    id: `smp-${role}`,
    name: k.file,
    path: k.path,
    category: "hardtek",
    tags: [role],
  }));
  const empty = {
    masterVolume: 1,
    channels: [],
    returnTracks: [],
    insertChains: {},
    eq16: {},
    sidechains: {},
    transientShapers: {},
  } as SynthProject["mixer"];
  return serializeProject({
    projectName: mani.projectName,
    bpm: mani.bpm,
    samples,
    patterns,
    activePatternId: patterns[0]?.id ?? "",
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: empty,
    humanizer: { global: {} as SynthProject["humanizer"]["global"] },
    automation: { lanes: [], stepCount: 16 },
    audioTracks: [],
    scripts: [],
  });
}

const TINY: Manifest = {
  bpm: 150,
  projectName: "Hardtek 150",
  kit: {
    kick: { file: "HT_Kick.wav", path: "C:/x/HT_Kick.wav" },
    bass: { file: "HT_AcidBass_F.wav", path: "C:/x/HT_AcidBass_F.wav" },
  },
  gains: { kick: 1.0, bass: 0.9 },
  patterns: { "HT150 Main": { kick: { "0": 0, "4": 0, "8": 0, "12": 0 }, bass: { "2": 0, "14": 3 } } },
  patternOrder: ["HT150 Main"],
};

describe("Hardtek-Projekt-Generator", () => {
  it("baut ein über parseProject valides .synth (Round-Trip)", () => {
    const proj = buildProject(TINY);
    const json = toJson(proj);
    const parsed = parseProject(json); // wirft bei invalidem Schema
    expect(parsed.bpm).toBe(150);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].parts).toHaveLength(2);
    expect(parsed.samples).toHaveLength(2);
  });

  it("Step-Grid + Pitch korrekt übertragen", () => {
    const proj = buildProject(TINY);
    const kick = proj.patterns[0].parts.find((p) => p.name === "kick")!;
    expect(kick.steps.filter((s) => s.active).map((_, i) => i)).toBeTruthy();
    expect(kick.steps[0].active).toBe(true);
    expect(kick.steps[1].active).toBe(false);
    const bass = proj.patterns[0].parts.find((p) => p.name === "bass")!;
    expect(bass.steps[14].active).toBe(true);
    expect(bass.steps[14].pitch).toBe(3);
    expect(kick.sampleUrl).toContain("HT_Kick.wav");
    expect(kick.fx).toBeDefined();
  });

  it("[GEN] schreibt echte .synth aus E:\\…\\manifest.json (nur bei GEN_HARDTEK=1)", () => {
    if (process.env.GEN_HARDTEK !== "1") return;
    // dynamische Imports, damit der normale Lauf node:fs nicht braucht
    const fs = require("node:fs");
    const path = require("node:path");
    const root = "E:\\KOPFCHAOT SCHÄTZE\\Hardtek150_Projekt";
    const mani: Manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf-8"));
    const proj = buildProject(mani);
    const json = toJson(proj);
    parseProject(json); // validiert vor dem Schreiben
    const out = path.join(root, "Hardtek 150.synth");
    fs.writeFileSync(out, json, "utf-8");
    expect(fs.existsSync(out)).toBe(true);
  });
});
