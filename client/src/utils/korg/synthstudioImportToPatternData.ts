/**
 * synthstudioImportToPatternData — DIE eine Übersetzung des Datei-Imports
 * (`convertParsedPatternToSynthstudio`-Ausgabe) in ein Store-`PatternData`.
 *
 * Warum es diese Datei gibt: DrumMachine.tsx hat ZWEI Schwester-Pfade für
 * denselben Vorgang (`importElectribePatternIntoActive` für das aktive
 * Pattern, `importElectribeBankAsPatterns` für ganze Bänke). Beide bauten
 * ihre Store-Werte selbst — und liefen auseinander: der Bank-Pfad nahm die
 * bereits normalisierten Werte des Konverters, der Einzel-Pfad jagte sie
 * ☠ ein ZWEITES Mal durch die Geräte-Umrechnung (`e2VolumeToUnit`/
 * `e2PanToUnit`, die rohe 0..127-Werte erwarten) — Ergebnis: Volume ≈ 0,
 * Pan hart links. Und Mute kam in keinem der beiden an.
 *
 * Regel (per Meta-Gate in korg-e2-file-import-mute.test.ts erzwungen):
 * jeder Datei-Import-Pfad übersetzt über DIESE Funktion. Sie ist pur und
 * Node-testbar — das Schwester-Modul für den Geräte-Pfad ist
 * `e2PatternToSynthstudio.ts` (dessen Quelle rohe Gerätewerte liefert,
 * deshalb rechnet ES um und diese Funktion NICHT).
 */
import {
  DEFAULT_CHANNEL_FX,
  type PatternData,
  type PartData,
} from "../../audio/AudioEngine";
import type { SynthstudioPatternImport } from "../electribeImport";

/**
 * Baut ein Store-`PatternData` aus einem konvertierten Datei-Import.
 *
 * IDs bleiben leer — `addPatternsData` regeneriert sie ohnehin; der
 * Einzel-Pattern-Pfad wendet die Felder ohnehin per dm-Setter an.
 * Sample-Verlinkung (Blob-URLs aus einer mitgeladenen `.all`-Bank) ist
 * bewusst NICHT hier: sie braucht den Resolver aus der UI-Schicht und
 * überschreibt nur `sampleName`/`sampleUrl` des Ergebnisses.
 */
export function synthstudioImportToPatternData(
  conv: SynthstudioPatternImport
): PatternData {
  const parts: PartData[] = conv.drumParts.map(dp => ({
    id: "",
    name: dp.sampleHint,
    sampleName: dp.sampleHint,
    sourceType: "sample" as const,
    // Mute-Flag (Part+0x01) — kam vorher in KEINEM Datei-Pfad an; was am
    // Gerät stumm war, klang nach dem Import mit.
    muted: dp.muted,
    soloed: false,
    // ☠ NICHT erneut umrechnen: der Konverter liefert bereits 0..1 bzw.
    // −1..+1 (Store-Konvention). Die Geräte-Umrechnung gehört in den
    // Sysex-Pfad, dessen Quelle rohe 0..127-Werte trägt.
    volume: dp.volume,
    pan: dp.pan,
    steps: dp.steps.map((act, i) => ({
      active: act,
      velocity: dp.velocities[i] ?? 100,
      // Per-Step-Pitch (Note − 0x48, inkl. Tie-Sentinel 0xFF → 183) — ohne
      // ihn drückte der Re-Export jede Melodie auf C5 platt. Fallback auf
      // den Part-Pitch (Legacy-Layout ohne Noten-Byte).
      pitch: dp.pitches?.[i] ?? dp.pitchSemitones,
      // Akkord-Noten (E2-Bytes 5..7) index-aligned; undefined = kein Akkord.
      chordNotes: dp.chords[i],
    })),
    fx: { ...DEFAULT_CHANNEL_FX },
  }));

  return {
    id: "",
    name: conv.name,
    stepCount: conv.stepCount,
    stepResolution: "1/16" as const,
    bpm: conv.bpm,
    parts,
    followAction: { type: "none" as const, barsBeforeSwitch: 1 },
  };
}
