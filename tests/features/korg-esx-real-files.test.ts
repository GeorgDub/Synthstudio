/**
 * tests/features/korg-esx-real-files.test.ts
 *
 * Regressions-Harness über die realen .esx-Bänke in „Korg ESX files/".
 *
 * Diese Tests laufen NUR lokal (der Ordner ist gross — in Summe ~1.6 GB — und
 * liegt nicht in jeder CI-Umgebung). `describeReal` self-skipt, wenn das
 * Verzeichnis fehlt oder leer ist → die Suite bleibt in CI grün ohne die Dateien.
 *
 * Ein EINZIGER Pass liest jede Datei genau einmal (`headersOnly` ⇒ kein
 * Float32-Decode der PCM-Masse) und prüft pro Datei drei Dinge:
 *   1. Robustheit — parst ohne Exception, mit plausiblen Slot-Zahlen/Indizes
 *      (keine geratenen Werte, nur harte Struktur-Grenzen).
 *   2. Bit-Exakt — `renameEsxBankSample` ist byte-identisch ausser den 8
 *      Name-Bytes des angefassten Slots (kein PCM-Anfassen, keine Grössen-
 *      Änderung). Native `Buffer.compare` über die Regionen vor/nach dem
 *      Name-Fenster → schnell auch bei ~24 MB-Dateien.
 *   3. Semantik — nach dem Rename liest `parseEsxBank` exakt den neuen Namen
 *      zurück, alle übrigen Slot-Namen/Frames unverändert (echter Round-Trip).
 *
 * Index-Konvention (wichtig): `EsxSample.index` ist ein GLOBALER Namensraum —
 * Mono = 0..255, Stereo = 256..383 (= ESX1_MAX_MONO_SLOTS + i). Der Patcher
 * `getEsxStereoHeaderOffset(i)` erwartet dagegen den LOKALEN Stereo-Index
 * 0..127. Der Rename-Teil dieses Harness betrifft nur Mono-Slots, wo global ==
 * lokal (0..255), also keine Umrechnung nötig.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseEsxBank } from "@/utils/korg/esxParser";
import {
  renameEsxBankSample,
  getEsxMonoHeaderOffset,
} from "@/utils/korg/esxSamplePatcher";
import {
  ESX1_NAME_MAX_CHARS,
  ESX1_MAX_MONO_SLOTS,
  ESX1_MAX_STEREO_SLOTS,
} from "@/utils/korg/constants";

const REAL_FILES_DIR = path.resolve(__dirname, "../../Korg ESX files");

function listRealEsx(): string[] {
  try {
    if (!fs.statSync(REAL_FILES_DIR).isDirectory()) return [];
    return fs
      .readdirSync(REAL_FILES_DIR)
      .filter(f => f.toLowerCase().endsWith(".esx"))
      .sort();
  } catch {
    return [];
  }
}

const REAL_FILES = listRealEsx();
const describeReal = REAL_FILES.length > 0 ? describe : describe.skip;

function readFileBytes(name: string): Uint8Array {
  const b = fs.readFileSync(path.join(REAL_FILES_DIR, name));
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

describeReal(
  `korg/esxParser — Real-File-Regression (${REAL_FILES.length} Dateien)`,
  () => {
    it("parse + bit-exakter Rename + Semantik-Round-Trip über alle realen Bänke", () => {
      const failures: string[] = [];
      let totalMono = 0;
      let totalStereo = 0;
      let renameChecked = 0;

      for (const file of REAL_FILES) {
        try {
          const original = readFileBytes(file);
          const bank = parseEsxBank(original, file, { headersOnly: true });

          // ── 1. Struktur-Invarianten ─────────────────────────────────────
          expect(bank.source).toBe(file);
          expect(bank.monoSamples.length).toBeLessThanOrEqual(
            ESX1_MAX_MONO_SLOTS
          );
          expect(bank.stereoSamples.length).toBeLessThanOrEqual(
            ESX1_MAX_STEREO_SLOTS
          );
          for (const s of bank.monoSamples) {
            expect(s.channels).toBe(1);
            expect(s.frames).toBeGreaterThanOrEqual(0);
            // Mono-Index im globalen Namensraum: 0..255.
            expect(s.index).toBeGreaterThanOrEqual(0);
            expect(s.index).toBeLessThan(ESX1_MAX_MONO_SLOTS);
            expect(s.pcmData.length).toBe(0); // headersOnly ⇒ kein PCM
          }
          for (const s of bank.stereoSamples) {
            expect(s.channels).toBe(2);
            expect(s.frames).toBeGreaterThanOrEqual(0);
            // Stereo-Index im globalen Namensraum: 256..383.
            expect(s.index).toBeGreaterThanOrEqual(ESX1_MAX_MONO_SLOTS);
            expect(s.index).toBeLessThan(
              ESX1_MAX_MONO_SLOTS + ESX1_MAX_STEREO_SLOTS
            );
            expect(s.pcmData.length).toBe(0);
          }
          totalMono += bank.monoSamples.length;
          totalStereo += bank.stereoSamples.length;

          // ── 2. + 3. Rename nur bei vorhandenem Mono-Slot ────────────────
          if (bank.monoSamples.length === 0) continue;
          const slot = bank.monoSamples[0];
          const newName = "RTX7";
          const patched = new Uint8Array(
            renameEsxBankSample(original, {
              index: slot.index,
              channels: 1,
              name: newName,
            })
          );

          // Gleiche Grösse — kein Anwachsen/Schrumpfen.
          expect(patched.byteLength).toBe(original.byteLength);

          // Bit-exakt ausser den 8 Name-Bytes (native memcmp der Regionen).
          const off = getEsxMonoHeaderOffset(slot.index);
          const nameEnd = off + ESX1_NAME_MAX_CHARS;
          const o = Buffer.from(
            original.buffer,
            original.byteOffset,
            original.byteLength
          );
          const p = Buffer.from(
            patched.buffer,
            patched.byteOffset,
            patched.byteLength
          );
          expect(o.compare(p, 0, off, 0, off)).toBe(0);
          expect(o.compare(p, nameEnd, o.length, nameEnd, o.length)).toBe(0);

          // Semantik-Round-Trip: neuer Name zurückgelesen, Rest unverändert.
          const after = parseEsxBank(patched, file, { headersOnly: true });
          const target = after.monoSamples.find(s => s.index === slot.index);
          expect(target?.name).toBe(newName);
          for (const b of bank.monoSamples) {
            if (b.index === slot.index) continue;
            const a = after.monoSamples.find(s => s.index === b.index);
            expect(a?.name).toBe(b.name);
            expect(a?.frames).toBe(b.frames);
          }
          renameChecked++;
        } catch (e) {
          failures.push(`  - ${file}: ${(e as Error).message}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${REAL_FILES.length} Dateien fehlgeschlagen:\n` +
            failures.join("\n")
        );
      }
      // Sanity: über alle Bänke liegen irgendwo Samples, und mind. eine Bank
      // hatte einen Mono-Slot für den Rename-Round-Trip.
      expect(totalMono + totalStereo).toBeGreaterThan(0);
      expect(renameChecked).toBeGreaterThan(0);
    }, 300_000);
  }
);
