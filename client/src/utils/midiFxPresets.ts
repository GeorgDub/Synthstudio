/**
 * Synthstudio – midiFxPresets.ts (v3.94.0)
 *
 * Built-In MIDI-FX Chain-Presets. Jedes Preset ist ein factory-Helper, der
 * eine fertig konfigurierte Node-Liste (mit frischen IDs) liefert. Konsumenten
 * (UI / Tests) rufen `loadPreset(id)` und übergeben das Ergebnis an
 * `useMidiFxStore.setAllNodes(chain)`.
 *
 * Design-Entscheidung:
 *   - Factory-Funktionen (nicht Konstanten), damit jeder Aufruf frische
 *     UUIDs erzeugt — sonst Konflikte beim mehrfachen Laden.
 *   - Wir nutzen `makeDefaultNode(kind)` aus dem Store und überschreiben
 *     dann nur die Parameter, die vom Default abweichen. So bleiben wir
 *     auch bei späteren Schema-Erweiterungen (neue Felder mit Defaults)
 *     automatisch up-to-date.
 *   - Hartes Cap: MAX_MIDI_FX_CHAIN (= 6). Presets bleiben darunter.
 *
 * Pure-TS, DOM-frei, Node-testbar. KEIN Audio-Side-Effect.
 *
 * Caveats:
 *   - PRESET_ARP_UP nutzt Chord-Expander + Note-Repeat zusammen — bei
 *     hoher Repeat-Count + Chord-Größe kann die Event-Explosion das
 *     256-Event-Limit im Engine erreichen. Wir bleiben mit count=4 und
 *     Triad-Chord sicher unter dem Limit.
 *   - PRESET_GLISSANDO ist eine vereinfachte Approximation — ein echtes
 *     Glissando bräuchte einen separaten Pitch-Sweep-Node, den die Engine
 *     (noch) nicht hat. Wir kombinieren Scale-Snap + 7th-Chord + 8 Repeats
 *     um den auf- und absteigenden Effekt anzunähern.
 */

import {
  makeDefaultNode,
  type MidiFxNode,
} from "@/store/useMidiFxStore";

// ─── Preset-ID Union ─────────────────────────────────────────────────────────

export type MidiFxPresetId =
  | "strum"
  | "glissando"
  | "arp-up"
  | "octave-double"
  | "hard-hits";

export interface MidiFxPresetMeta {
  id: MidiFxPresetId;
  label: string;
  /** Kurze Beschreibung für UI-Tooltip. */
  description: string;
}

/** Vollständige Preset-Liste — Reihenfolge = UI-Dropdown-Reihenfolge. */
export const MIDI_FX_PRESETS: readonly MidiFxPresetMeta[] = [
  {
    id: "strum",
    label: "Strum",
    description:
      "Major-Chord + 4× Note-Repeat — simuliert ein angeschlagenes Gitarren-Strumming.",
  },
  {
    id: "glissando",
    label: "Glissando",
    description:
      "C-Major-Snap + 7th-Chord + 8× Note-Repeat — fließender Lauf über die Tonleiter.",
  },
  {
    id: "arp-up",
    label: "Arp Up",
    description: "Major-Chord + 4× Note-Repeat 1/16 — klassisches Aufwärts-Arpeggio.",
  },
  {
    id: "octave-double",
    label: "Octave Double",
    description: "Octave -12 + +12 — verdoppelt jede Note in Oktav-Schichten.",
  },
  {
    id: "hard-hits",
    label: "Hard Hits",
    description: "Exponential Velocity-Curve + Scale-Snap — härtere Anschlagsdynamik in Tonart.",
  },
];

// ─── Factory-Helper ──────────────────────────────────────────────────────────

/**
 * Liefert eine Chain für das angegebene Preset. Jeder Aufruf produziert
 * frische Node-IDs (kein UUID-Konflikt beim mehrmaligen Laden). NIE
 * mutierende Side-Effects — der Caller entscheidet, ob er via
 * `useMidiFxStore.setAllNodes(chain)` aktiviert.
 *
 * @returns Array von MidiFxNode (1..MAX_MIDI_FX_CHAIN), nie null.
 */
export function loadPreset(id: MidiFxPresetId): MidiFxNode[] {
  switch (id) {
    case "strum":
      return buildStrum();
    case "glissando":
      return buildGlissando();
    case "arp-up":
      return buildArpUp();
    case "octave-double":
      return buildOctaveDouble();
    case "hard-hits":
      return buildHardHits();
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return [];
    }
  }
}

// ─── Preset-Builders ─────────────────────────────────────────────────────────

function buildStrum(): MidiFxNode[] {
  const chord = makeDefaultNode("chord-expander");
  if (chord.kind === "chord-expander") chord.chordType = "major";
  const repeat = makeDefaultNode("note-repeat");
  if (repeat.kind === "note-repeat") {
    repeat.rate = "1/32";
    repeat.count = 4;
  }
  return [chord, repeat];
}

function buildGlissando(): MidiFxNode[] {
  const snap = makeDefaultNode("scale-snap");
  if (snap.kind === "scale-snap") {
    snap.scale = "major";
    snap.root = 0; // C
  }
  const chord = makeDefaultNode("chord-expander");
  if (chord.kind === "chord-expander") chord.chordType = "7th";
  const repeat = makeDefaultNode("note-repeat");
  if (repeat.kind === "note-repeat") {
    repeat.rate = "1/32";
    repeat.count = 8;
  }
  return [snap, chord, repeat];
}

function buildArpUp(): MidiFxNode[] {
  const chord = makeDefaultNode("chord-expander");
  if (chord.kind === "chord-expander") chord.chordType = "major";
  const repeat = makeDefaultNode("note-repeat");
  if (repeat.kind === "note-repeat") {
    repeat.rate = "1/16";
    repeat.count = 4;
  }
  return [chord, repeat];
}

function buildOctaveDouble(): MidiFxNode[] {
  const down = makeDefaultNode("octave-shift");
  if (down.kind === "octave-shift") down.semitones = -12;
  const up = makeDefaultNode("octave-shift");
  if (up.kind === "octave-shift") up.semitones = 12;
  return [down, up];
}

function buildHardHits(): MidiFxNode[] {
  const vel = makeDefaultNode("velocity-curve");
  if (vel.kind === "velocity-curve") {
    vel.curve = "exp";
    vel.amount = 0.7;
  }
  const snap = makeDefaultNode("scale-snap");
  if (snap.kind === "scale-snap") {
    snap.scale = "major";
    snap.root = 0;
  }
  return [vel, snap];
}

/** Hilfslookup für UI — liefert die Metadaten zur ID. */
export function getPresetMeta(id: MidiFxPresetId): MidiFxPresetMeta | undefined {
  return MIDI_FX_PRESETS.find((p) => p.id === id);
}
