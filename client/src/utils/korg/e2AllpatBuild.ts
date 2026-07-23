/**
 * e2AllpatBuild.ts — Patcht Pattern-Bodies in einen bestehenden
 * `.e2sallpat`/`.all`-Container (Bank-Export).
 *
 * SICHERHEIT / „ohne Haftung": Wir FABRIZIEREN den Container NICHT. Der Aufrufer
 * liefert eine echte, vom Gerät stammende Basis-Bank; wir überschreiben nur
 * ausgewählte Pattern-Slots mit device-validen Bodies (jeder Body kommt aus
 * `buildE2PatternBody`, das auf einem echten Init-Pattern-Template basiert und
 * nur verifizierte Felder patcht). Header/Filler/Footer + nicht angefasste Slots
 * bleiben byte-exakt erhalten.
 *
 * Verifiziertes Layout (bit-exakt vs. bangcorrupt e2_merge_patterns.py /
 * e2pat_shift.py): Pattern i @ `0x10100 + i*0x4000`, Slot-Größe `0x4000`,
 * 250 Slots.
 */

// Konstanten aus der gemeinsamen Layout-Quelle (e2Layout.ts). Namen bleiben
// erhalten (Backward-Compat für Consumer + Tests); die Werte leben jetzt an
// EINER Stelle.
import {
  E2_ALLPAT_PATTERN_OFFSET,
  E2_ALLPAT_PATTERN_STRIDE,
  E2_ALLPAT_SLOT_COUNT,
  E2_PATTERN_BODY_SIZE as _E2_PATTERN_BODY_SIZE,
  e2AllpatSlotOffset,
} from "./e2Layout";

export const ALLPAT_PATTERN_OFFSET = E2_ALLPAT_PATTERN_OFFSET;
export const ALLPAT_PATTERN_STRIDE = E2_ALLPAT_PATTERN_STRIDE;
export const ALLPAT_PATTERN_COUNT = E2_ALLPAT_SLOT_COUNT;
export const E2_PATTERN_BODY_SIZE = _E2_PATTERN_BODY_SIZE;

/** Byte-Offset des Pattern-Slots `i` (0..249) im Container. */
export function allpatSlotOffset(index: number): number {
  return e2AllpatSlotOffset(index);
}

/** Minimale Container-Größe, damit Slot `i` vollständig hineinpasst. */
export function allpatMinSizeFor(index: number): number {
  return allpatSlotOffset(index) + ALLPAT_PATTERN_STRIDE;
}

export class E2AllpatError extends Error {}

/**
 * Schreibt einen 0x4000-Body in Slot `index` einer Kopie von `base`.
 * Nicht-destruktiv. Wirft bei ungültigem Slot, falscher Body-Größe oder zu
 * kleinem Container (statt still zu überschreiben/abzuschneiden).
 */
export function writePatternBodyIntoAllpat(
  base: Uint8Array,
  index: number,
  body: Uint8Array
): Uint8Array {
  if (index < 0 || index >= ALLPAT_PATTERN_COUNT) {
    throw new E2AllpatError(
      `pattern slot ${index} out of range (0..${ALLPAT_PATTERN_COUNT - 1})`
    );
  }
  if (body.length !== E2_PATTERN_BODY_SIZE) {
    throw new E2AllpatError(
      `pattern body must be ${E2_PATTERN_BODY_SIZE} bytes, got ${body.length}`
    );
  }
  const need = allpatMinSizeFor(index);
  if (base.length < need) {
    throw new E2AllpatError(
      `base container too small (${base.length} < ${need}) for slot ${index}`
    );
  }
  const out = base.slice();
  out.set(body, allpatSlotOffset(index));
  return out;
}

export interface AllpatSlotWrite {
  index: number;
  body: Uint8Array;
}

/**
 * Schreibt mehrere Bodies in ihre Slots (der Reihe nach, nicht-destruktiv).
 * Ein Fehler in einem Write bricht ab, bevor irgendetwas zurückgegeben wird —
 * es gibt keinen halb-gepatchten Container.
 */
export function writePatternBodiesIntoAllpat(
  base: Uint8Array,
  writes: AllpatSlotWrite[]
): Uint8Array {
  // Vorab validieren, damit ein später Fehler nicht einen Teil-Patch hinterlässt.
  const seen = new Set<number>();
  for (const w of writes) {
    if (w.index < 0 || w.index >= ALLPAT_PATTERN_COUNT) {
      throw new E2AllpatError(`pattern slot ${w.index} out of range`);
    }
    if (w.body.length !== E2_PATTERN_BODY_SIZE) {
      throw new E2AllpatError(
        `slot ${w.index}: body must be ${E2_PATTERN_BODY_SIZE} bytes, got ${w.body.length}`
      );
    }
    if (seen.has(w.index)) {
      throw new E2AllpatError(`duplicate slot ${w.index} in write list`);
    }
    seen.add(w.index);
  }
  const maxIndex = writes.reduce((m, w) => Math.max(m, w.index), -1);
  if (maxIndex >= 0 && base.length < allpatMinSizeFor(maxIndex)) {
    throw new E2AllpatError(
      `base container too small for slot ${maxIndex} (${base.length} < ${allpatMinSizeFor(maxIndex)})`
    );
  }
  const out = base.slice();
  for (const w of writes) out.set(w.body, allpatSlotOffset(w.index));
  return out;
}

/**
 * Plausibilitäts-Check für eine Basis-Bank: erwartete Voll-Größe (Header + Filler
 * + 250 Slots). Gibt true, wenn die Datei mindestens die 250 Slots abdeckt.
 */
export function isFullAllpatContainer(base: Uint8Array): boolean {
  return base.length >= allpatMinSizeFor(ALLPAT_PATTERN_COUNT - 1);
}
