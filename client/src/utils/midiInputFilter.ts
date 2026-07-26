/**
 * Synthstudio — MIDI-Input-Filter (v3.269.0)
 *
 * Reine Logik für die Frage „darf diese eingehende MIDI-Nachricht Synthstudio
 * überhaupt erreichen?".
 *
 * Motivation (Live-Setup): Korg Electribe 2 und ein Fader-Controller (z. B.
 * AKAI MIDImix) hängen gleichzeitig am Rechner. Wer auf der Korg spielt, will
 * NICHT, dass deren Noten/CCs/Program-Changes nebenbei das Synthstudio-Pattern
 * verstellen — der Controller soll aber weiter durchkommen. Also zwei
 * unabhängige Achsen:
 *
 *   1. **pro Gerät**  — „von der Korg nichts annehmen"
 *   2. **pro Nachrichtenklasse** — „Clock ja, Program-Change nein"
 *
 * Geräte werden über den **Namen** gemutet, nicht über die Port-ID: Web-MIDI
 * vergibt IDs pro Session neu, der Name bleibt stabil. Damit überlebt eine
 * Mute-Einstellung Reload und Re-Plug.
 *
 * Keine Seiteneffekte, kein DOM, kein Web-MIDI — voll unit-testbar.
 * Zustand + Persistenz liegen in `store/useMidiInputFilterStore.ts`.
 */

/** Die Klassen, nach denen gefiltert werden kann. */
export type MidiMessageClass =
  | "note"
  | "cc"
  | "programChange"
  | "pitchBend"
  | "aftertouch"
  | "clock"
  | "sysex";

/** Stabile Reihenfolge für UI-Chips (nicht alphabetisch — nach Häufigkeit). */
export const MIDI_MESSAGE_CLASSES: readonly MidiMessageClass[] = [
  "note",
  "cc",
  "programChange",
  "pitchBend",
  "aftertouch",
  "clock",
  "sysex",
] as const;

/** Kurzes Label für Chips (Deutsch, wie der Rest der Oberfläche). */
export function labelForMidiClass(cls: MidiMessageClass): string {
  switch (cls) {
    case "note": return "Noten";
    case "cc": return "CC";
    case "programChange": return "Prog";
    case "pitchBend": return "Bend";
    case "aftertouch": return "AT";
    case "clock": return "Clock";
    case "sysex": return "Sysex";
  }
}

/** Ausführliche Beschreibung für Tooltips. */
export function describeMidiClass(cls: MidiMessageClass): string {
  switch (cls) {
    case "note": return "Note-On / Note-Off — spielt Parts an und füttert Step-Recording";
    case "cc": return "Control-Change — alle gelernten Regler-Bindings";
    case "programChange": return "Program-Change / Bank-Select — wechselt Patterns";
    case "pitchBend": return "Pitch-Bend";
    case "aftertouch": return "Aftertouch (Channel + Polyphon)";
    case "clock": return "Clock, Start/Stop/Continue, Song-Position — externe Tempo-Sync";
    case "sysex": return "System-Exclusive — Geräte-Dumps (z. B. Pattern von der Electribe)";
  }
}

/**
 * Ordnet ein MIDI-Status-Byte einer Filterklasse zu.
 *
 * @returns `null` für alles, was kein gültiges Status-Byte ist (Data-Bytes,
 *          Müll). Unbekanntes wird bewusst NICHT gefiltert — siehe
 *          {@link shouldPassMidiMessage}.
 */
export function classifyMidiStatus(status: number): MidiMessageClass | null {
  if (!Number.isFinite(status) || status < 0x80 || status > 0xff) return null;

  if (status < 0xf0) {
    switch (status & 0xf0) {
      case 0x80: // Note-Off
      case 0x90: // Note-On
        return "note";
      case 0xa0: // Polyphonic Aftertouch
        return "aftertouch";
      case 0xb0:
        return "cc";
      case 0xc0:
        return "programChange";
      case 0xd0: // Channel Aftertouch
        return "aftertouch";
      case 0xe0:
        return "pitchBend";
      default:
        return null;
    }
  }

  // System-Messages.
  switch (status) {
    case 0xf0: // Sysex Start
    case 0xf7: // Sysex End (EOX)
      return "sysex";
    case 0xf1: // MTC Quarter Frame
    case 0xf2: // Song Position Pointer
    case 0xf3: // Song Select
    case 0xf6: // Tune Request
    case 0xf8: // Clock
    case 0xfa: // Start
    case 0xfb: // Continue
    case 0xfc: // Stop
    case 0xfe: // Active Sensing
    case 0xff: // Reset
      return "clock";
    default:
      return null;
  }
}

/** Persistierbarer Filterzustand. Siehe `useMidiInputFilterStore`. */
export interface MidiInputFilterState {
  /** Not-Aus: blockt ausnahmslos alles. Überstimmt jede andere Einstellung. */
  masterMute: boolean;
  /**
   * Auf ALLEN Eingängen lauschen statt nur auf dem in den MIDI-Einstellungen
   * gewählten. Ohne das lässt sich kein Zwei-Geräte-Setup fahren (Korg +
   * Controller gleichzeitig) — und ein Pro-Gerät-Mute wäre sinnlos.
   */
  listenAllInputs: boolean;
  /** Gemutete Eingänge, per Gerätename (siehe Modul-Kopf: IDs sind flüchtig). */
  mutedDeviceNames: string[];
  /** Pro Nachrichtenklasse: durchlassen (`true`) oder verwerfen (`false`). */
  classes: Record<MidiMessageClass, boolean>;
}

/** Was über eine eingehende Nachricht bekannt ist. */
export interface IncomingMidiInfo {
  /** Erstes Byte der Nachricht. */
  status: number;
  /** Port-Name des Absenders, falls Web-MIDI ihn liefert. */
  deviceName?: string | null;
}

/**
 * Namensvergleich für Gerätenamen: Groß/Kleinschreibung und Randleerzeichen
 * egal. Betriebssysteme schreiben denselben Port gern unterschiedlich
 * („MIDIMIX" vs. „MIDI Mix" bleiben allerdings verschieden — das ist gewollt,
 * unscharfes Matching würde falsche Geräte stummschalten).
 */
function normalizeDeviceName(name: string): string {
  return name.trim().toLowerCase();
}

/** Ist dieser Eingang stummgeschaltet? */
export function isDeviceMuted(
  state: Pick<MidiInputFilterState, "mutedDeviceNames">,
  deviceName: string | null | undefined,
): boolean {
  if (!deviceName) return false;
  const needle = normalizeDeviceName(deviceName);
  if (!needle) return false;
  return state.mutedDeviceNames.some((n) => normalizeDeviceName(n) === needle);
}

/**
 * Die eine Frage, die der MIDI-Handler stellt.
 *
 * Reihenfolge ist Absicht: Not-Aus → Gerät → Klasse. Ein gemutetes Gerät wird
 * komplett ignoriert, unabhängig davon welche Klassen offen sind.
 *
 * Unbekannte Status-Bytes (`classifyMidiStatus` → `null`) werden
 * **durchgelassen**. Ein Filter, der Unbekanntes verschluckt, macht Geräte
 * kaputt, die wir nie getestet haben; ein Filter, der es durchlässt, verhält
 * sich schlimmstenfalls wie vorher.
 */
export function shouldPassMidiMessage(
  state: MidiInputFilterState,
  msg: IncomingMidiInfo,
): boolean {
  if (state.masterMute) return false;
  if (isDeviceMuted(state, msg.deviceName)) return false;

  const cls = classifyMidiStatus(msg.status);
  if (cls === null) return true;
  return state.classes[cls] !== false;
}

/** Alle Klassen offen — der Auslieferungszustand. */
export function allClassesEnabled(): Record<MidiMessageClass, boolean> {
  return {
    note: true,
    cc: true,
    programChange: true,
    pitchBend: true,
    aftertouch: true,
    clock: true,
    sysex: true,
  };
}

/**
 * Wie viele Klassen sind zu? Treibt den „N gefiltert"-Badge in der Toolbar,
 * damit ein vergessener Filter nicht als Fehlfunktion missverstanden wird.
 */
export function countBlockedClasses(
  classes: Record<MidiMessageClass, boolean>,
): number {
  return MIDI_MESSAGE_CLASSES.reduce((n, c) => (classes[c] === false ? n + 1 : n), 0);
}

/**
 * Ein Satz Namen (Groß/Klein normalisiert, Duplikate raus) — für das Umschalten
 * eines Gerät-Mutes.
 */
export function toggleMutedDeviceName(
  mutedDeviceNames: readonly string[],
  deviceName: string,
): string[] {
  const needle = normalizeDeviceName(deviceName);
  if (!needle) return [...mutedDeviceNames];
  const without = mutedDeviceNames.filter((n) => normalizeDeviceName(n) !== needle);
  return without.length === mutedDeviceNames.length
    ? [...mutedDeviceNames, deviceName.trim()]
    : without;
}
