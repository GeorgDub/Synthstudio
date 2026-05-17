/**
 * Synthstudio — midiOutput.ts (TASK-230 / v2.83.0)
 *
 * Public, test-friendly helpers für Web-MIDI-Output-Discovery, Lookup und
 * Send. Wird von folgenden Features wiederverwendet:
 *   - MIDI-Clock-Out (TASK-230) → 24 PPQN-Tick + Start/Stop/Continue
 *   - nanoKONTROL2 LED-Feedback (TASK-231) → Note-On/Off für Solo/Mute-LEDs
 *
 * Design-Entscheidung: Wir kapseln `navigator.requestMIDIAccess()` nicht
 * komplett — der bestehende `useMidi`-Hook macht das schon (cached den
 * MIDIAccess-Singleton). Stattdessen exportieren wir pure, getMidiAccess-
 * unabhängige Helpers, die einen optionalen `access`-Parameter akzeptieren.
 * Das macht Unit-Tests trivial: man übergibt einfach ein gemocktes
 * `{ outputs: Map }`-Objekt.
 *
 * Browser-Compatibility:
 *   - Chrome/Edge/Opera: vollständig (sysex=false reicht)
 *   - Firefox: seit 108 (2022-12) supported
 *   - Safari: nicht supported, Helpers liefern leere Listen / null
 *   - Electron 40 (Chromium 130): supported
 *
 * Isomorphic: enthält KEINE React-Imports und KEINE Electron-IPC-Aufrufe.
 */

// ─── Typen ──────────────────────────────────────────────────────────────────

/**
 * Minimaler Output-Info-Record, den UI-Komponenten/Picker rendern können.
 * Spiegelt MIDIOutput-Felder ohne den nicht-serialisierbaren `send()`-Method.
 */
export interface MidiOutputInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
}

/**
 * Subset des `MIDIAccess`-Interfaces, das wir benötigen.
 * Wir typen es lose, damit Mocks in Tests trivial sind.
 */
export interface MidiAccessLike {
  outputs: Map<string, MidiOutputLike> | { forEach: (cb: (output: MidiOutputLike) => void) => void; get(id: string): MidiOutputLike | undefined };
}

/** Subset von MIDIOutput, das wir nutzen. */
export interface MidiOutputLike {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: string;
  send(data: number[] | Uint8Array, timestamp?: number): void;
}

// ─── Persistenz ─────────────────────────────────────────────────────────────

const STORAGE_KEY_CLOCK_OUT_ID  = "synthstudio:midi:clockOutputId";
const STORAGE_KEY_CLOCK_OUT_ON  = "synthstudio:midi:clockOutEnabled";

/** Lädt die zuletzt gewählte Clock-Out-Device-ID aus localStorage. */
export function loadClockOutputId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY_CLOCK_OUT_ID);
    return v && v.length > 0 ? v : null;
  } catch { return null; }
}

/** Persistiert die Clock-Out-Device-ID (oder löscht sie wenn null). */
export function saveClockOutputId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (id) localStorage.setItem(STORAGE_KEY_CLOCK_OUT_ID, id);
    else    localStorage.removeItem(STORAGE_KEY_CLOCK_OUT_ID);
  } catch { /* ignore quota / disabled-storage */ }
}

/** Lädt den Clock-Out-Enable-Flag aus localStorage (default: false). */
export function loadClockOutEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY_CLOCK_OUT_ON) === "1";
  } catch { return false; }
}

/** Persistiert den Clock-Out-Enable-Flag. */
export function saveClockOutEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_CLOCK_OUT_ON, enabled ? "1" : "0");
  } catch { /* ignore */ }
}

// ─── Enumerate / Lookup ─────────────────────────────────────────────────────

/**
 * Wandelt einen `MIDIAccess`-Output-Map-Iterator in eine plain-Array von
 * `MidiOutputInfo`-Records. Stable-sortable, frei von Reactivity.
 *
 * @param access Das MIDIAccess-Objekt (oder ein Mock, oder null).
 * @returns Array (leer wenn access null/undefined ist).
 */
export function enumerateMidiOutputs(access: MidiAccessLike | null | undefined): MidiOutputInfo[] {
  if (!access) return [];
  const result: MidiOutputInfo[] = [];
  access.outputs.forEach((out: MidiOutputLike) => {
    result.push({
      id: out.id,
      name: out.name ?? "Unbekannter Ausgang",
      manufacturer: out.manufacturer ?? "",
      state: (out.state === "connected" ? "connected" : "disconnected"),
    });
  });
  return result;
}

/**
 * Liefert das `MIDIOutput`-Objekt für eine gegebene ID, oder null wenn nicht
 * gefunden / kein Access.
 */
export function getOutputById(
  access: MidiAccessLike | null | undefined,
  id: string | null | undefined,
): MidiOutputLike | null {
  if (!access || !id) return null;
  const map = access.outputs;
  // Map.get exists if it's a real Map; auch das MIDIOutputMap-Interface hat .get()
  if (typeof (map as Map<string, MidiOutputLike>).get === "function") {
    return (map as Map<string, MidiOutputLike>).get(id) ?? null;
  }
  // Fallback: linear scan
  let found: MidiOutputLike | null = null;
  (map as { forEach: (cb: (o: MidiOutputLike) => void) => void }).forEach((o) => {
    if (o.id === id) found = o;
  });
  return found;
}

/**
 * Sendet eine MIDI-Message an die angegebene Output-ID. Schluckt jede
 * Exception (typisch wenn das Gerät während des Sends entkoppelt wird) und
 * liefert false zurück.
 *
 * @returns true wenn der `send()`-Call ohne Throw lief, sonst false.
 */
export function sendMessage(
  access: MidiAccessLike | null | undefined,
  outputId: string | null | undefined,
  bytes: number[] | Uint8Array,
): boolean {
  const out = getOutputById(access, outputId);
  if (!out) return false;
  try {
    out.send(bytes);
    return true;
  } catch {
    return false;
  }
}

// ─── MIDI-Realtime-Konstanten ───────────────────────────────────────────────

/** System-Realtime: Timing Clock. 24 mal pro Quarter-Note. */
export const MIDI_CLOCK_TICK     = 0xf8;
/** System-Realtime: Start. Reset to bar 1, beat 1, start clock. */
export const MIDI_CLOCK_START    = 0xfa;
/** System-Realtime: Continue. Resume ohne Position-Reset. */
export const MIDI_CLOCK_CONTINUE = 0xfb;
/** System-Realtime: Stop. */
export const MIDI_CLOCK_STOP     = 0xfc;
/** System-Common: Song Position Pointer (2 data bytes follow). */
export const MIDI_SPP_STATUS     = 0xf2;

/**
 * 24 PPQN — MIDI 1.0 Standard. Jede Quarter-Note = 24 Clock-Pulse.
 * Bei 120 BPM = 48 Pulse/Sekunde = ~20.83ms zwischen den Pulsen.
 */
export const MIDI_PPQN = 24;

/**
 * Erzeugt die 14-bit Song-Position-Pointer-Bytes für eine gegebene MIDI-Beat-
 * Position. Ein MIDI-Beat = 6 Clock-Pulse = 1/16-Note. Range: 0..16383.
 *
 * @param midiBeat Position in 1/16-Note-Einheiten (z.B. step 0 = Beat 0).
 * @returns 3-Byte Array `[0xF2, lsb, msb]`.
 */
export function buildSongPositionPointer(midiBeat: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(16383, Math.round(midiBeat)));
  const lsb = clamped & 0x7f;
  const msb = (clamped >> 7) & 0x7f;
  return [MIDI_SPP_STATUS, lsb, msb];
}
