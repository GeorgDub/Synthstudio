/**
 * Synthstudio – midiTemplates.ts
 *
 * Vordefinierte MIDI-Mappings für gängige Hardware-Controller
 * der Techno / Hardtekk / Hardcore / Maschine / MPC-Szene.
 *
 * Jede Vorlage definiert:
 *   - cc-Mappings: CC-Nr → Action (BPM, Volume, Mute, Step etc.)
 *   - noteMappings: MIDI-Note → Drum-Pad (GM Drum Map als Default)
 *
 * Nutzung im MidiSettings-Panel:
 *   loadMidiTemplate("launchpad-mk2") → ersetzt aktuelle Mappings
 */
import type { MidiMapping, MidiNoteMapping } from "@/hooks/useMidi";

export interface MidiTemplate {
  id: string;
  /** Anzeigename */
  name: string;
  /** Hardware-Hersteller */
  manufacturer: string;
  /** Kurzbeschreibung */
  description: string;
  /** CC-Mappings (Knobs, Fader, Buttons) */
  ccMappings: Omit<MidiMapping, "label">[];
  /** Note-Mappings (Drum-Pads, Keyboard) */
  noteMappings: Omit<MidiNoteMapping, "label">[];
}

// ─── Standard GM Drum Map (für alle Pad-Controller) ──────────────────────────

const GM_DRUM_DEFAULTS: Array<{ note: number; partIndex: number }> = [
  { note: 36, partIndex: 0 },  // Kick
  { note: 38, partIndex: 1 },  // Snare
  { note: 42, partIndex: 2 },  // Hi-Hat closed
  { note: 46, partIndex: 3 },  // Hi-Hat open
  { note: 39, partIndex: 4 },  // Clap
  { note: 45, partIndex: 5 },  // Tom Hi
  { note: 41, partIndex: 6 },  // Tom Lo
  { note: 49, partIndex: 7 },  // FX
];

// ─── Templates ────────────────────────────────────────────────────────────────

export const MIDI_TEMPLATES: MidiTemplate[] = [
  {
    id: "launchpad-mk2",
    name: "Launchpad MK2 / MK3",
    manufacturer: "Novation",
    description: "8×8 Pad-Grid für Step-Programming. Pads in Reihe 1–8 für Steps, Top-Row für Transport.",
    ccMappings: [
      // Top-Row Buttons als Transport
      { cc: 104, channel: 0, target: { type: "playStop" } },
      { cc: 105, channel: 0, target: { type: "record" } },
      { cc: 106, channel: 0, target: { type: "patternPrev" } },
      { cc: 107, channel: 0, target: { type: "patternNext" } },
      { cc: 108, channel: 0, target: { type: "patternClear" } },
      { cc: 109, channel: 0, target: { type: "patternFill" } },
      { cc: 110, channel: 0, target: { type: "patternRandomize" } },
      { cc: 111, channel: 0, target: { type: "openSettings" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    id: "push-2",
    name: "Ableton Push 2",
    manufacturer: "Ableton",
    description: "8×8 RGB-Pads, 8 Encoder, Touch-Strip. Pads für Step-Programming, Encoder für Volume.",
    ccMappings: [
      // 8 Encoder als Volume-Slider für Parts 0–7
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 71 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // Transport
      { cc: 85, channel: 0, target: { type: "playStop" } },
      { cc: 86, channel: 0, target: { type: "record" } },
      { cc: 87, channel: 0, target: { type: "tapTempo" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note: 36 + (partIndex < 8 ? partIndex : note - 36),
      channel: 0,
      partId: `part-${partIndex}`,
    })),
  },
  {
    id: "mpc-one",
    name: "Akai MPC One / MPC Live",
    manufacturer: "Akai Professional",
    description: "4×4 Pads + Q-Link Knobs. Klassisches MPC-Layout, perfekt für Beat-Making.",
    ccMappings: [
      // Q-Link 1–4: BPM, Master Volume, Pan, Filter
      { cc: 14, channel: 0, target: { type: "bpm" } },
      { cc: 15, channel: 0, target: { type: "masterVolume" } },
      { cc: 16, channel: 0, target: { type: "volume", partId: "part-0", partName: "Kick" } },
      { cc: 17, channel: 0, target: { type: "volume", partId: "part-1", partName: "Snare" } },
      // Transport
      { cc: 118, channel: 0, target: { type: "playStop" } },
      { cc: 119, channel: 0, target: { type: "record" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    id: "maschine-mikro",
    name: "NI Maschine Mikro MK3",
    manufacturer: "Native Instruments",
    description: "16 Pads (4×4) + Touch-Strip. Ideal für Live-Performance und Step-Sequencing.",
    ccMappings: [
      { cc: 1, channel: 0, target: { type: "bpm" } },
      { cc: 7, channel: 0, target: { type: "masterVolume" } },
      // Footer-Buttons als Transport
      { cc: 112, channel: 0, target: { type: "playStop" } },
      { cc: 113, channel: 0, target: { type: "record" } },
      { cc: 114, channel: 0, target: { type: "patternNext" } },
      { cc: 115, channel: 0, target: { type: "patternPrev" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    id: "nanokontrol2",
    name: "Korg nanoKONTROL2",
    manufacturer: "Korg",
    description: "9 Slider + 9 Knobs + Buttons. Perfekt für Mixer-Kontrolle (Volume + Pan + Mute/Solo pro Kanal).",
    ccMappings: [
      // 8 Slider: Volume Parts 0–7
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // 8 Knobs: Pan Parts 0–7
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 16 + i, channel: 0,
        target: { type: "pan" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // 8 Mute-Buttons
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 32 + i, channel: 0,
        target: { type: "mute" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // 8 Solo-Buttons
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 48 + i, channel: 0,
        target: { type: "solo" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // Master + Transport
      { cc: 7, channel: 0, target: { type: "masterVolume" } },
      { cc: 41, channel: 0, target: { type: "playStop" } },
      { cc: 45, channel: 0, target: { type: "record" } },
    ],
    noteMappings: [],
  },
  {
    id: "mpk-mini-mk3",
    name: "Akai MPK Mini MK3",
    manufacturer: "Akai Professional",
    description: "25-Key Keyboard + 8 Pads + 8 Knobs. Kompakter Controller für Studio und Live.",
    ccMappings: [
      // 8 Knobs: BPM, Master, 6× Volume
      { cc: 70, channel: 0, target: { type: "bpm" } },
      { cc: 71, channel: 0, target: { type: "masterVolume" } },
      ...Array.from({ length: 6 }, (_, i) => ({
        cc: 72 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
    ],
    noteMappings: GM_DRUM_DEFAULTS.slice(0, 8).map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
  {
    id: "behringer-x-touch-mini",
    name: "Behringer X-Touch Mini",
    manufacturer: "Behringer",
    description: "8 Encoder + 1 Slider + 16 Buttons – kostengünstige Mixer-Alternative.",
    ccMappings: [
      // 8 Encoder als Volume
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 1 + i, channel: 0,
        target: { type: "volume" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
      // Slider = Master
      { cc: 9, channel: 0, target: { type: "masterVolume" } },
      // 8 obere Buttons als Mute
      ...Array.from({ length: 8 }, (_, i) => ({
        cc: 89 + i, channel: 0,
        target: { type: "mute" as const, partId: `part-${i}`, partName: `Kanal ${i + 1}` },
      })),
    ],
    noteMappings: [],
  },
  {
    id: "korg-padkontrol",
    name: "Korg padKONTROL",
    manufacturer: "Korg",
    description: "16 Velocity-sensitive Pads + 2 Encoder + X/Y-Pad. Klassiker der elektronischen Musik.",
    ccMappings: [
      { cc: 16, channel: 0, target: { type: "bpm" } },
      { cc: 17, channel: 0, target: { type: "masterVolume" } },
    ],
    noteMappings: GM_DRUM_DEFAULTS.map(({ note, partIndex }) => ({
      note, channel: 0, partId: `part-${partIndex}`,
    })),
  },
];

/** Findet eine Vorlage anhand der ID. */
export function getMidiTemplate(id: string): MidiTemplate | undefined {
  return MIDI_TEMPLATES.find(t => t.id === id);
}

/** Liefert alle verfügbaren Template-IDs. */
export function listTemplateIds(): string[] {
  return MIDI_TEMPLATES.map(t => t.id);
}

/** Konvertiert ein Template zu MidiMapping[] + MidiNoteMapping[] (mit auto-generierten Labels). */
export function templateToMappings(
  template: MidiTemplate,
  partResolver?: (partId: string) => string | undefined,
): { cc: MidiMapping[]; notes: MidiNoteMapping[] } {
  const cc: MidiMapping[] = template.ccMappings.map(m => ({
    ...m,
    label: ccTargetToLabel(m.target),
  }));
  const notes: MidiNoteMapping[] = template.noteMappings.map(n => ({
    ...n,
    label: partResolver?.(n.partId) ?? n.partId,
  }));
  return { cc, notes };
}

function ccTargetToLabel(t: MidiMapping["target"]): string {
  switch (t.type) {
    case "bpm":            return "BPM";
    case "masterVolume":   return "Master Volume";
    case "playStop":       return "Play/Stop";
    case "record":         return "Record";
    case "tapTempo":       return "Tap Tempo";
    case "volume":         return `Volume ${t.partName ?? t.partId}`;
    case "pan":            return `Pan ${t.partName ?? t.partId}`;
    case "mute":           return `Mute ${t.partName ?? t.partId}`;
    case "solo":           return `Solo ${t.partName ?? t.partId}`;
    case "patternNext":    return "Next Pattern";
    case "patternPrev":    return "Previous Pattern";
    case "patternClear":   return "Clear Pattern";
    case "patternFill":    return "Fill Pattern";
    case "patternRandomize": return "Randomize Pattern";
    case "openSettings":   return "Settings";
    default:               return t.type;
  }
}
