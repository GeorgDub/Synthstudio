/**
 * e2Layout.ts — EINZIGE Quelle der Wahrheit für die Byte-Layout-Konstanten der
 * Korg Electribe 2 (Sampler) Pattern-/AllPat-Container.
 *
 * Motiv (Import-Cleanup): dieselben Magic-Numbers (0x10100 / 0x4000 / 250 …)
 * lagen bisher 4× kopiert herum — in `electribeImport.ts`, `imports/
 * electribeImport.ts`, `e2AllpatBuild.ts` und `e2sExport.ts` — jeweils unter
 * anderem Namen. Das ist eine Wartungsfalle (ein Wert korrigiert, drei
 * vergessen). Diese Datei bündelt die Werte; die alten Module re-exportieren
 * sie unter ihren bestehenden Namen (Backward-Compat für Consumer + Tests).
 *
 * Alle Werte sind gegen die primären Quellen (hacktribe/e2-scripts + Oe2sSLE)
 * und die Roundtrip-Tests verifiziert und über die Systeme A/B hinweg
 * BYTE-IDENTISCH — ihre Konsolidierung ändert kein Verhalten.
 *
 * ─── Step-Record-Feld-Layout (GEKLÄRT gegen echte KORG-Dateien) ─────────────
 * Das interne 12-Byte-Step-Record-Layout ist gegen REALE .e2spat-Dateien
 * byte-diff-verifiziert (siehe e2sExport.ts v3.271 Header, "Korg e2s files/"):
 *   byte 0 trigger · byte 1 note · byte 2 velocity · byte 3 gate · byte 4 gatelen
 * `e2Sysex.ts` (decodePatternBody) und der e2sExport-Writer nutzen dieses
 * korrekte Layout. `electribeImport.ts` (System A) trägt noch das ALTE, falsche
 * Spec (velocity @ +1, note @ +4 — note/velocity vertauscht); sein Roundtrip-
 * Test grünt nur, weil dort Reader und Writer dasselbe falsche Spec teilen.
 * → Der vereinheitlichte Import routet über den real-file-verifizierten Decoder
 *   (e2Sysex), NICHT über System A. Die kanonischen Offsets stehen unten; die
 *   falschen bleiben vorerst in System A (Fix = eigener, test-begleiteter
 *   Schritt, da dessen Tests aufs alte Spec geschrieben sind).
 */

// ─── AllPat-Container (.e2sallpat) ───────────────────────────────────────────

/** Offset des ersten PTST-Pattern-Records = Größe des Header/GLST-Prefix. */
export const E2_ALLPAT_PATTERN_OFFSET = 0x10100; // 65792

/** Stride zwischen Pattern-Records = Pattern-Body-Größe. */
export const E2_ALLPAT_PATTERN_STRIDE = 0x4000; // 16384

/** Hardware-feste Slot-Anzahl in einer Bank. */
export const E2_ALLPAT_SLOT_COUNT = 250;

/** Gesamt-Dateigröße eines vollständigen .e2sallpat. */
export const E2_ALLPAT_FILE_SIZE =
  E2_ALLPAT_PATTERN_OFFSET + E2_ALLPAT_SLOT_COUNT * E2_ALLPAT_PATTERN_STRIDE; // 4_161_792

// ─── Einzel-Pattern-Datei (.e2spat / .e2pat) ─────────────────────────────────

/** Größe des Pattern-Bodys (identisch zum AllPat-Stride). */
export const E2_PATTERN_BODY_SIZE = 0x4000; // 16384

/** 0x100-KORG-Header vor dem Body einer Standalone-.e2spat-Datei. */
export const E2_FILE_HEADER_SIZE = 0x100; // 256

/** Gesamt-Größe einer Standalone-.e2spat-Datei (Header + Body). */
export const E2_SINGLE_FILE_SIZE = E2_FILE_HEADER_SIZE + E2_PATTERN_BODY_SIZE; // 16640

// ─── Pattern-Body-interne Layout-Konstanten (body-relativ) ───────────────────
// Über System A + e2Sysex hinweg identisch (nur velocity/note im Step-Record
// sind strittig — siehe Kopf-Kommentar; die bleiben in den Dateien).

/** Pattern-Name: 16 ASCII-Bytes. */
export const E2_PATTERN_NAME_OFFSET = 0x10;
export const E2_PATTERN_NAME_LEN = 16;

/** BPM: u16 LE, ×10 (1200 = 120.0). */
export const E2_PATTERN_BPM_OFFSET = 0x22;

/** Step-Length-Code (0→16, 1→32, 3→64). */
export const E2_PATTERN_STEPLEN_OFFSET = 0x25;

/** Part-Tabelle: 16 Parts ab hier. */
export const E2_PART_TABLE_OFFSET = 0x800;
export const E2_PART_COUNT = 16;
export const E2_PART_STRIDE = 0x330; // 816

/** OSC/Sample-Referenz innerhalb eines Parts (u16 LE). */
export const E2_PART_OSC_REF_OFFSET = 0x08;
/**
 * Höchste gültige Sample-/OSC-Referenz. Die Geräte-Slots enden bei 999
 * (Factory ≤ ~421, User ab 501); die Stock-Bank e2s-2016 nutzt max. 419.
 * Vorher clampte der Export auf 0xFFFF — damit konnten Bodies mit
 * Referenzen auf nicht existierende Samples entstehen.
 */
export const E2_MAX_SAMPLE_REF = 999;
/**
 * Part-Volume = Amp Level (u8 0..127) @ +0x18.
 *
 * v3.297-KORREKTUR (am Gerät bestätigt): vorher wurde 0x15 geschrieben —
 * das ist laut Korgs offizieller "electribe MIDI Implementation Rev 1.00"
 * (TABLE 6: Part Parameter) aber **EG Decay/Release**, nicht Level. Symptom
 * auf realer Hardware: per SysEx gepushte Patterns hatten korrekte Steps,
 * aber falsche Lautstärken (Level blieb Template-Wert, Decay wurde zerschossen).
 * TABLE 6 (dreifach quell-verifiziert + Gerätebefund): Amp Level @ 24 (0x18).
 */
export const E2_PART_VOLUME_OFFSET = 0x18;
/**
 * Part-Pan = Amp Pan (i8, **0 = Center**, -63..+63 ≙ L..R) @ +0x19.
 *
 * v3.297-KORREKTUR: vorher u8@0x22 mit 64-Center — 0x22 ist laut TABLE 6
 * **IFX Edit**. Achtung Semantik: Gerät speichert SIGNED mit 0 = Mitte;
 * UI-seitige 0..127-Werte (64 = Mitte) müssen beim Schreiben nach i8
 * (wert-64) und beim Lesen zurück (+64) konvertiert werden.
 */
export const E2_PART_PAN_OFFSET = 0x19;
/** EG Decay/Release (u8) @ +0x15 — das Feld, das fälschlich als Volume beschrieben wurde. */
export const E2_PART_EG_DECAY_OFFSET = 0x15;
/** IFX Edit (u8) @ +0x22 — das Feld, das fälschlich als Pan beschrieben wurde. */
export const E2_PART_IFX_EDIT_OFFSET = 0x22;

/** UI-Pan (0..127, 64=Center) → Geräte-i8-Byte (0=Center), geclampt -63..+63. */
export function e2PanUiToDevice(pan0127: number): number {
  const centered = Math.max(-63, Math.min(63, Math.round(pan0127) - 64));
  return centered & 0xff; // two's complement als Byte
}
/** Geräte-Pan-Byte (i8, 0=Center) → UI-Pan 0..127 (64=Center). */
export function e2PanDeviceToUi(byte: number): number {
  const signed = byte > 127 ? byte - 256 : byte;
  return Math.max(0, Math.min(127, signed + 64));
}

/** Sequenz-Block innerhalb eines Parts: 64 × 12-Byte-Records. */
export const E2_PART_SEQ_OFFSET = 0x30;
export const E2_STEP_RECORD_SIZE = 0x0c; // 12
export const E2_STEPS_PER_PART = 64;

// Step-Record-Feld-Offsets — verifiziert gegen echte KORG-Dateien (siehe
// Kopf-Kommentar). Dies ist das kanonische Layout; e2Sysex.ts nutzt es bereits.
/** trigger-Flag @ +0 (0x01 = aktiv). */
export const E2_STEP_TRIGGER_OFFSET = 0;
/** note @ +1 (0x48 = C5 default). */
export const E2_STEP_NOTE_OFFSET = 1;
/** velocity @ +2 (0x60 = 96 default, 0x7F max). */
export const E2_STEP_VELOCITY_OFFSET = 2;
/** gate-Flag @ +3 (1 auf aktiven Steps). */
export const E2_STEP_GATE_OFFSET = 3;
/** gate-length @ +4. */
export const E2_STEP_GATELEN_OFFSET = 4;

/** Byte-Offset des Pattern-Slots `i` (0..249) im AllPat-Container. */
export function e2AllpatSlotOffset(index: number): number {
  return E2_ALLPAT_PATTERN_OFFSET + index * E2_ALLPAT_PATTERN_STRIDE;
}
