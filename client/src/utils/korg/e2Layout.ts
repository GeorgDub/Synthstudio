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
 * ─── ⚠ UNGELÖSTER KONFLIKT (bewusst NICHT hier konsolidiert) ────────────────
 * Das interne Feld-Layout EINES 12-Byte-Step-Records widerspricht sich zwischen
 * den zwei Decodern und ist ohne einen gelabelten Device-Dump nicht auflösbar:
 *   - System A (electribeImport.ts): velocity @ +1, note @ +4
 *   - e2Sysex.ts:                    note     @ +1, velocity @ +2, gate @ +3
 * Beide tragen „verifiziert"-Kommentare + grüne Tests (unterschiedliche
 * Fixtures). trigger @ +0 und die Record-Größe (12 B) sind unstrittig und
 * stehen daher HIER; velocity/note bleiben absichtlich in den jeweiligen
 * Dateien, bis ein Dump mit bekannten Velocity/Note-Werten die Frage klärt.
 * Der vereinheitlichte Import routet über den roundtrip-verifizierten Reader
 * (System A).
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
/** Part-Volume (u8 0..127). */
export const E2_PART_VOLUME_OFFSET = 0x15;
/** Part-Pan (u8 0..127, 64 = center). */
export const E2_PART_PAN_OFFSET = 0x22;

/** Sequenz-Block innerhalb eines Parts: 64 × 12-Byte-Records. */
export const E2_PART_SEQ_OFFSET = 0x30;
export const E2_STEP_RECORD_SIZE = 0x0c; // 12
export const E2_STEPS_PER_PART = 64;

/** Step-Record: trigger-Flag @ +0 (0x01 = aktiv). Unstrittig. */
export const E2_STEP_TRIGGER_OFFSET = 0;

/** Byte-Offset des Pattern-Slots `i` (0..249) im AllPat-Container. */
export function e2AllpatSlotOffset(index: number): number {
  return E2_ALLPAT_PATTERN_OFFSET + index * E2_ALLPAT_PATTERN_STRIDE;
}
