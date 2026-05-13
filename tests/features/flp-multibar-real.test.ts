/**
 * tests/features/flp-multibar-real.test.ts
 *
 * Simuliert den Multi-Bar-Import von handleFlpImport() gegen echte
 * User-FLPs und loggt das Bar-Distribution-Ergebnis.
 *
 * Skipped wenn E:\Flp ProJekTe\ nicht existiert.
 */
import { describe, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseFlp,
  groupNotesByBar,
  calculateBarCount,
  flpPositionToStep,
} from "../../client/src/utils/flpImport";

const FLP_DIR = "E:\\Flp ProJekTe";
const dirAvailable = fs.existsSync(FLP_DIR);
const sampleFlps = dirAvailable
  ? fs.readdirSync(FLP_DIR).filter(f => f.toLowerCase().endsWith(".flp"))
  : [];

const describeReal = dirAvailable && sampleFlps.length > 0 ? describe : describe.skip;

describeReal("FLP-Multi-Bar — echte Dateien", () => {
  for (const file of sampleFlps) {
    const full = path.join(FLP_DIR, file);

    it(`${file} — bar-distribution`, () => {
      const buf = fs.readFileSync(full);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const parsed = parseFlp(ab);
      if (!parsed.patterns.length || !parsed.patterns[0].notes.length) {
        console.log(`\n=== ${file} ===  (no notes)`);
        return;
      }

      const ppq = parsed.header.ppq;
      const STEP_COUNT = 16;       // simuliere aktives Synthstudio-Pattern
      const PART_COUNT = 8;        // typische drum-machine
      const MAX_BARS = 16;

      const totalNotes = parsed.patterns[0].notes.length;
      const totalBars = Math.min(MAX_BARS, calculateBarCount(parsed.patterns[0].notes, ppq, STEP_COUNT));
      const byBar = groupNotesByBar(parsed.patterns[0].notes, ppq, STEP_COUNT);

      console.log(`\n=== ${file} ===`);
      console.log(`Total: ${totalNotes} notes, ${parsed.header.ppq} ppq, ${calculateBarCount(parsed.patterns[0].notes, ppq, STEP_COUNT)} bars detected, importing ${totalBars}`);

      let imported = 0;
      for (let bar = 0; bar < totalBars; bar++) {
        const barNotes = byBar.get(bar) ?? [];
        imported += barNotes.length;
        // Simuliere Step-Verteilung wie der UI-Code es täte
        const stepsByPart = new Map<number, Set<number>>();
        for (const note of barNotes) {
          const step = flpPositionToStep(note.position, ppq) % STEP_COUNT;
          const partIdx = note.channel % PART_COUNT;
          if (!stepsByPart.has(partIdx)) stepsByPart.set(partIdx, new Set());
          stepsByPart.get(partIdx)!.add(step);
        }
        const channels = Array.from(new Set(barNotes.map(n => n.channel))).sort((a, b) => a - b);
        const partsSummary = Array.from(stepsByPart.entries())
          .sort(([a], [b]) => a - b)
          .map(([p, steps]) => `part${p}=[${Array.from(steps).sort((a, b) => a - b).join(",")}]`)
          .join(" ");
        console.log(`  Bar ${bar + 1} (${barNotes.length} notes, ch=[${channels.join(",")}]): ${partsSummary}`);
      }
      const dropped = totalNotes - imported;
      if (dropped > 0) {
        console.log(`  Truncated (jenseits MAX_BARS=${MAX_BARS}): ${dropped} notes`);
      }
    });
  }
});

if (!dirAvailable || sampleFlps.length === 0) {
  describe("FLP-Multi-Bar — echte Dateien", () => {
    it.skip("E:\\Flp ProJekTe nicht verfügbar", () => {});
  });
}
