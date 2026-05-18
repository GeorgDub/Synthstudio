/**
 * Synthstudio – useMidiNoteOutStore (TASK-240 / v2.92.0)
 *
 * Custom Observer Store für Per-Part MIDI-Note-Out Configs.
 *
 * Wird vom ChannelInspector befüllt (User wählt Output/Channel/Note pro
 * Drum-Part), und vom App.tsx in die laufende AudioEngine + useMidi
 * gebridged. localStorage-persistiert, damit ein User-Setup über Reloads
 * überlebt.
 *
 * Hinweise:
 *   - Wir speichern KEINEN Sender-Callback hier — das ist die Domäne von
 *     useMidi.
 *   - Die `outputId` ist gerätespezifisch und kann sich beim Reconnect der
 *     Hardware ändern. Wenn die ID nicht mehr aufgelöst werden kann, ist das
 *     ein soft-fail (kein Send) — ChannelInspector zeigt einen Hinweis.
 *
 * State-Schema persistiert via localStorage-Key `synthstudio:midi:noteout:v1`.
 */
import { useEffect, useReducer } from "react";
import type { MidiPartConfig } from "../audio/MidiNoteOut";
import {
  clampMidiChannel,
  clampMidiNote,
  clampNoteDuration,
  DEFAULT_NOTE_DURATION_MS,
} from "../audio/MidiNoteOut";

const STORAGE_KEY = "synthstudio:midi:noteout:v1";
const ENABLED_KEY = "synthstudio:midi:noteout:enabled:v1";

interface PersistedState {
  enabled: boolean;
  configs: Record<string, MidiPartConfig>;
}

// ─── Internal state ───────────────────────────────────────────────────────────

function loadState(): PersistedState {
  if (typeof localStorage === "undefined") {
    return { enabled: false, configs: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const enabledRaw = localStorage.getItem(ENABLED_KEY);
    const enabled = enabledRaw === "1";
    if (!raw) return { enabled, configs: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.configs) {
      return { enabled, configs: {} };
    }
    // Defensive: nur valid-shape configs durchlassen.
    const out: Record<string, MidiPartConfig> = {};
    for (const [partId, cfgRaw] of Object.entries(parsed.configs as Record<string, unknown>)) {
      const cfg = cfgRaw as Partial<MidiPartConfig>;
      if (!cfg || typeof cfg !== "object") continue;
      if (typeof cfg.outputId !== "string" || !cfg.outputId) continue;
      out[partId] = {
        outputId: cfg.outputId,
        channel: clampMidiChannel(cfg.channel ?? 0),
        note: clampMidiNote(cfg.note ?? 36),
        noteDurationMs: clampNoteDuration(cfg.noteDurationMs ?? DEFAULT_NOTE_DURATION_MS),
        localSoundEnabled: cfg.localSoundEnabled !== false,
      };
    }
    return { enabled, configs: out };
  } catch {
    return { enabled: false, configs: {} };
  }
}

function saveState(state: PersistedState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ configs: state.configs }));
    localStorage.setItem(ENABLED_KEY, state.enabled ? "1" : "0");
  } catch {
    /* ignore quota / disabled-storage */
  }
}

let _state: PersistedState = loadState();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach(l => l());
}

// ─── Public Actions ───────────────────────────────────────────────────────────

export function getMidiNoteOutEnabled(): boolean {
  return _state.enabled;
}

export function setMidiNoteOutEnabled(enabled: boolean): void {
  if (_state.enabled === enabled) return;
  _state = { ..._state, enabled };
  saveState(_state);
  notify();
}

export function getPartMidiOutConfig(partId: string): MidiPartConfig | null {
  return _state.configs[partId] ?? null;
}

export function getAllPartMidiOutConfigs(): Record<string, MidiPartConfig> {
  return { ..._state.configs };
}

export function setPartMidiOutConfig(partId: string, config: MidiPartConfig): void {
  const normalized: MidiPartConfig = {
    outputId: config.outputId,
    channel: clampMidiChannel(config.channel),
    note: clampMidiNote(config.note),
    noteDurationMs: clampNoteDuration(config.noteDurationMs ?? DEFAULT_NOTE_DURATION_MS),
    localSoundEnabled: config.localSoundEnabled ?? true,
  };
  _state = {
    ..._state,
    configs: { ..._state.configs, [partId]: normalized },
  };
  saveState(_state);
  notify();
}

export function clearPartMidiOutConfig(partId: string): void {
  if (!_state.configs[partId]) return;
  const next = { ..._state.configs };
  delete next[partId];
  _state = { ..._state, configs: next };
  saveState(_state);
  notify();
}

export function clearAllPartMidiOutConfigs(): void {
  if (Object.keys(_state.configs).length === 0) return;
  _state = { ..._state, configs: {} };
  saveState(_state);
  notify();
}

/**
 * Applied das KORG-Electribe-Drum-Map-Template. Mapped die ersten 8 Parts
 * auf GM-Drum-Notes (Note 36/38/42/46/39/45/41/49) auf Channel 10 (=9 in
 * 0-indexed). Falls die Drum-Bank mehr Parts hat, werden die folgenden auf
 * Note 50+ Step (jeweils +1) gemappt.
 *
 * @param partIds Liste der Part-IDs in Reihenfolge (z.B. ["part-0","part-1",…]).
 * @param outputId Ziel-MIDI-Output (Electribe-Device).
 */
export function applyElectribeDrumMap(partIds: string[], outputId: string): void {
  if (!outputId || partIds.length === 0) return;
  // GM Drum Map standard for first 8 parts. Channel 10 = ch index 9.
  const GM_DRUM_NOTES = [36, 38, 42, 46, 39, 45, 41, 49];
  const next: Record<string, MidiPartConfig> = { ..._state.configs };
  partIds.forEach((partId, i) => {
    const note = i < GM_DRUM_NOTES.length ? GM_DRUM_NOTES[i] : 50 + (i - GM_DRUM_NOTES.length);
    next[partId] = {
      outputId,
      channel: 9, // MIDI Channel 10 (0-indexed = 9) — GM Drum
      note: clampMidiNote(note),
      noteDurationMs: DEFAULT_NOTE_DURATION_MS,
      localSoundEnabled: true,
    };
  });
  _state = { ..._state, configs: next };
  saveState(_state);
  notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export function useMidiNoteOutStore(): PersistedState {
  const [, rerender] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

// ─── Test Helper ──────────────────────────────────────────────────────────────

export function __resetMidiNoteOutStoreForTests(): void {
  _state = { enabled: false, configs: {} };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ENABLED_KEY);
    } catch { /* ignore */ }
  }
}
