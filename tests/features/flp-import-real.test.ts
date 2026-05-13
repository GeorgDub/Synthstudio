/**
 * tests/features/flp-import-real.test.ts
 *
 * Smoke-Test gegen ECHTE FL Studio .flp Dateien aus E:\Flp ProJekTe\.
 * Wir überprüfen NUR Robustheit: kein Crash, plausible Header-Werte,
 * Patterns werden detected. Spezifische Note-Counts sind FL-Projekt-
 * abhängig und nicht stabil über Versions.
 *
 * Tests werden geskippt wenn das Verzeichnis fehlt (z.B. CI / fresh clone).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseFlp, flpPositionToStep } from "../../client/src/utils/flpImport";

const FLP_DIR = "E:\\Flp ProJekTe";
const dirAvailable = fs.existsSync(FLP_DIR);
const sampleFlps = dirAvailable
  ? fs.readdirSync(FLP_DIR).filter(f => f.toLowerCase().endsWith(".flp")).slice(0, 5)
  : [];

const describeReal = dirAvailable && sampleFlps.length > 0 ? describe : describe.skip;

describeReal("FLP-Import — echte FL-Studio Dateien", () => {
  for (const file of sampleFlps) {
    const full = path.join(FLP_DIR, file);

    it(`${file} — parsed ohne Crash + plausible Header`, () => {
      const buf = fs.readFileSync(full);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const parsed = parseFlp(ab);

      console.log(`\n=== ${file} (${buf.length} bytes) ===`);
      console.log(`Header: format=${parsed.header.format}, channels=${parsed.header.numChannels}, ppq=${parsed.header.ppq}`);
      console.log(`Patterns: ${parsed.patterns.length}`);
      for (const p of parsed.patterns.slice(0, 5)) {
        const positions = p.notes.map(n => n.position);
        const minPos = positions.length ? Math.min(...positions) : 0;
        const maxPos = positions.length ? Math.max(...positions) : 0;
        const channels = new Set(p.notes.map(n => n.channel));
        console.log(`  Pattern ${p.index}: ${p.notes.length} notes, channels=[${Array.from(channels).sort((a, b) => a - b).join(",")}], pos=${minPos}..${maxPos}`);
      }

      // Plausibilität
      expect(parsed.header.format).toBeGreaterThanOrEqual(0);
      expect(parsed.header.format).toBeLessThanOrEqual(2);
      expect(parsed.header.numChannels).toBeGreaterThan(0);
      expect(parsed.header.ppq).toBeGreaterThan(0);
      // Im Realfall haben FL-Projekte mindestens ein Pattern
      // (kann aber leer sein); wir prüfen nur dass kein Crash passierte
    });
  }
});

if (!dirAvailable || sampleFlps.length === 0) {
  // Fallback test damit die Suite nicht "no tests" reportet
  describe("FLP-Import — echte FL-Studio Dateien", () => {
    it.skip("E:\\Flp ProJekTe nicht verfügbar — überspringe Real-Tests", () => {});
  });
}
