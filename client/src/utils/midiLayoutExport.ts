/**
 * Synthstudio – MIDI Layout Export (v1.73)
 *
 * Komplementär zu `midiLayoutImport.ts`: serialisiert die aktuelle
 * MidiMapping[]+MidiNoteMapping[]-Konfiguration als JSON-Datei im selben
 * `synthstudioLayout: "v1"`-Format. Damit kann ein User nach Auto-Learn
 * seine Hardware-Konfiguration als Template speichern + teilen.
 *
 * Pure Funktionen — kein DOM/Storage-Zugriff. UI-Komponenten nutzen das
 * Output über einen Blob+Anchor-Download.
 */
import type { MidiMapping, MidiNoteMapping } from "@/hooks/useMidi";

/** Layout-Format-Version (muss zu parseMidiLayoutJson passen). */
export const LAYOUT_VERSION = "v1";

export interface MidiLayoutExportInput {
  /** Human-readable Name des Layouts (z.B. "Mein Electribe 2"). */
  name: string;
  ccMappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
}

/**
 * Serialisiert die Mappings in den gleichen JSON-Schema-Dialekt den
 * `parseMidiLayoutJson` versteht. Pretty-printed (2-space-Indent) damit
 * User die Datei manuell editieren können.
 *
 * Garantie: `parseMidiLayoutJson(buildMidiLayoutJson(input))` ist round-trip
 * für `name`, `ccMappings`, `noteMappings`. Siehe Tests.
 */
export function buildMidiLayoutJson(input: MidiLayoutExportInput): string {
  return JSON.stringify(
    {
      synthstudioLayout: LAYOUT_VERSION,
      name: input.name,
      ccMappings: input.ccMappings.map((m) => ({
        cc: m.cc,
        channel: m.channel,
        target: m.target,
        label: m.label,
      })),
      noteMappings: input.noteMappings.map((m) => ({
        note: m.note,
        channel: m.channel,
        partId: m.partId,
        label: m.label,
      })),
    },
    null,
    2,
  );
}

/**
 * Macht einen User-input-Namen für einen Datei-Download safe — entfernt
 * Path-Separator, Quotes, etc. Leerer Input → "midi-layout".
 *
 * Beispiel: "Mein Electribe 2 / Slim" → "Mein-Electribe-2-Slim"
 */
/**
 * Generiert einen sinnvollen Default-Layout-Namen aus dem aktuell aktiven
 * MIDI-Device. Wird vom Export-Form als Vorbelegung verwendet damit der User
 * nicht jedes Mal manuell "Mein Setup" tippen muss.
 *
 *   "Korg Electribe 2"  → "Korg Electribe 2-Setup"
 *   undefined / leer    → "Mein MIDI-Setup"
 *
 * Pure Funktion — public exportiert für Tests + Verwendung in MidiSettings.
 * v1.79.
 */
export function defaultLayoutNameForDevice(deviceName?: string | null): string {
  const trimmed = (deviceName ?? "").trim();
  if (trimmed.length === 0) return "Mein MIDI-Setup";
  return `${trimmed}-Setup`;
}

export function sanitizeLayoutFileName(name: string): string {
  // Keine NFKD-Normalization — die würde Umlaute (ö → o+◌̈) zerlegen und der
  // Strip-Schritt würde die Combining-Marks entfernen → "ö" → "o". Stattdessen
  // erlauben wir Unicode-Letters (\p{L}) und -Numbers (\p{N}) direkt.
  const cleaned = name
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "midi-layout";
}
