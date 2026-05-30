/**
 * FLP-Analyse-Harness (nur bei ANALYZE_FLP=1). Parst das Original-Schizo-FLP
 * mit dem echten Repo-Parser und schreibt die Struktur (Pattern → Channel →
 * 16-Step-Groove + Pitches + Sample-Namen) als JSON, damit der Hardtek/Schizo-
 * Rebuild davon ableiten kann. Kein Disk-Seiteneffekt im normalen Lauf.
 */
import { describe, it, expect } from "vitest";
import { parseFlp, flpPositionToStep, groupNotesByChannel } from "@/utils/flpImport";

describe("FLP-Analyse (Schizo)", () => {
  it("[ANALYZE] dumpt FLP-Struktur als JSON", () => {
    if (process.env.ANALYZE_FLP !== "1") return;
    const fs = require("node:fs");
    const flpPath = "E:\\KOPFCHAOT SCHÄTZE\\38er ShizoStyle\\38er Shizo Style.flp";
    const buf: Buffer = fs.readFileSync(flpPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = parseFlp(ab);
    const ppq = parsed.header.ppq;

    const patterns = parsed.patterns
      .filter((p) => p.notes.length > 0)
      .map((p) => {
        const byChan = groupNotesByChannel(p.notes);
        const channels: Record<string, { name: string; sample: string; steps: number[]; keys: number[]; count: number }> = {};
        for (const [chan, notes] of byChan) {
          const steps = new Set<number>();
          const keys = new Set<number>();
          for (const n of notes) {
            steps.add(flpPositionToStep(n.position, ppq) % 16);
            keys.add(n.key);
          }
          channels[String(chan)] = {
            name: parsed.channelNames.get(chan) ?? "",
            sample: parsed.sampleNames.get(chan) ?? "",
            steps: [...steps].sort((a, b) => a - b),
            keys: [...keys].sort((a, b) => a - b),
            count: notes.length,
          };
        }
        return {
          index: p.index,
          name: parsed.patternNames.get(p.index) ?? "",
          noteCount: p.notes.length,
          channelCount: Object.keys(channels).length,
          channels,
        };
      })
      .sort((a, b) => b.noteCount - a.noteCount);

    const out = {
      ppq,
      numChannels: parsed.header.numChannels,
      channelNames: Object.fromEntries(parsed.channelNames),
      sampleNames: Object.fromEntries(parsed.sampleNames),
      patternCount: patterns.length,
      patterns,
    };
    fs.writeFileSync("scripts/flip/schizo_analysis.json", JSON.stringify(out, null, 2), "utf-8");
    expect(patterns.length).toBeGreaterThan(0);
  });
});
