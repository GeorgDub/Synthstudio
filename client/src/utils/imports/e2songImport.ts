/**
 * e2songImport.ts — Sprint-98: OmniTribe-Song-Format (.e2song) Importer.
 *
 * Spec-Mirror von OmniTribe's tools/formats/e2song_reader.py
 * (src/firmware/include/format/e2song.h).
 *
 * Layout:
 *   Header (0x40 B):
 *     0x00  "OMNTSONG"     (8 B Magic)
 *     0x08  u16 version
 *     0x0A  u16 section_count
 *     0x0C  char name[32]
 *     0x2C  u16 global_tempo (×100, 0 = use pattern)
 *     0x2E  u16 flags
 *     0x30  reserved (16 B)
 *   Sections (0x40 .. 0x40 + N×16):
 *     u16 pattern_slot
 *     u16 repeat_count
 *     u8  transition_mode
 *     u8  transition_beats
 *     u16 flags
 *     char label[8]
 *
 * Max 64 Sections. Importer ist read-only; Writes laufen ueber das
 * OmniTribe-Tooling (e2song_reader.py --write).
 */

import { ImportError } from "./types";

const E2SONG_MAGIC = "OMNTSONG";
const E2SONG_HEADER_SIZE = 0x40;
const E2SONG_SECTION_SIZE = 16;
const E2SONG_MAX_SECTIONS = 64;

export const TransitionMode = {
  IMMEDIATE: 0,
  PATTERN_END: 1,
  CROSSFADE: 2,
  HOLD_AND_WAIT: 3,
} as const;

export const SongFlags = {
  LOOP: 1 << 0,
  RETRIG: 1 << 1,
} as const;

export const SectionFlags = {
  MUTE_FX: 1 << 0,
  RESET: 1 << 1,
} as const;

export interface ImportedSongSection {
  patternSlot: number;
  repeatCount: number;
  transitionMode: number;
  transitionBeats: number;
  flags: number;
  label: string;
}

export interface ImportedSong {
  name: string;
  version: number;
  globalTempo: number;    // ×100 (z.B. 12000 = 120.00 BPM); 0 = use pattern tempo
  flags: number;
  sections: ImportedSongSection[];
}

function readAscii(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  let end = bytes.indexOf(0);
  if (end === -1) end = length;
  let out = "";
  for (let i = 0; i < end; i++) {
    const c = bytes[i];
    if (c >= 0x20 && c <= 0x7E) out += String.fromCharCode(c);
  }
  return out;
}

/**
 * Importiert ein .e2song-File. Wirft ImportError bei:
 *  - falscher Magic
 *  - Buffer zu kurz fuer Header
 *  - section_count > E2SONG_MAX_SECTIONS
 *  - Buffer kuerzer als Header + section_count × 16
 */
export function importE2Song(buffer: ArrayBuffer | Uint8Array): ImportedSong {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < E2SONG_HEADER_SIZE) {
    throw new ImportError(
      `e2song-Buffer zu kurz: ${data.length} < ${E2SONG_HEADER_SIZE}`,
      "e2song",
    );
  }
  // Magic-Check
  const magicBytes = data.slice(0, 8);
  let magic = "";
  for (const b of magicBytes) magic += String.fromCharCode(b);
  if (magic !== E2SONG_MAGIC) {
    throw new ImportError(
      `e2song: falsche Magic "${magic}" — erwartet "${E2SONG_MAGIC}"`,
      "e2song",
    );
  }

  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  );
  const version = view.getUint16(8, true);
  const sectionCount = view.getUint16(10, true);

  if (sectionCount > E2SONG_MAX_SECTIONS) {
    throw new ImportError(
      `e2song: zu viele Sections: ${sectionCount} > ${E2SONG_MAX_SECTIONS}`,
      "e2song",
    );
  }

  const name = readAscii(view, 12, 32);
  const globalTempo = view.getUint16(0x2C, true);
  const flags = view.getUint16(0x2E, true);

  const minLength = E2SONG_HEADER_SIZE + sectionCount * E2SONG_SECTION_SIZE;
  if (data.length < minLength) {
    throw new ImportError(
      `e2song: Buffer zu kurz fuer ${sectionCount} Sections: ${data.length} < ${minLength}`,
      "e2song",
    );
  }

  const sections: ImportedSongSection[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const base = E2SONG_HEADER_SIZE + i * E2SONG_SECTION_SIZE;
    const patternSlot = view.getUint16(base + 0, true);
    const repeatCount = view.getUint16(base + 2, true);
    const transitionMode = view.getUint8(base + 4);
    const transitionBeats = view.getUint8(base + 5);
    const sectionFlags = view.getUint16(base + 6, true);
    const label = readAscii(view, base + 8, 8);
    sections.push({
      patternSlot,
      repeatCount,
      transitionMode,
      transitionBeats,
      flags: sectionFlags,
      label,
    });
  }

  return {
    name,
    version,
    globalTempo,
    flags,
    sections,
  };
}

/**
 * Helper: gibt true zurueck wenn der Buffer mit dem OMNTSONG-Magic startet.
 * Praktisch fuer file-dispatch im UI ohne ganzen Parse-Lauf zu starten.
 */
export function isE2Song(buffer: ArrayBuffer | Uint8Array): boolean {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== E2SONG_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}
