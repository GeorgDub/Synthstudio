/**
 * Synthstudio — useAudioEngineConfigStore (v3.0.0 / TASK-236-ALT)
 *
 * Konfiguration für den Web-Audio-AudioContext.
 *
 * Dieser Store ist die sichere Alternative zu TASK-236 (WASAPI Exclusive):
 * statt nativ ins OS einzugreifen, nutzen wir die Browser-eigenen
 * `AudioContextOptions` (`latencyHint`, `sampleRate`). Auf Windows reduziert
 * `latencyHint: 'interactive'` die Output-Latenz von default ~30-50 ms auf
 * ~10-20 ms — ohne native Bindings, ohne Build-Risiko.
 *
 * Architektur (analog useThemeStore / useApiSettingsStore):
 *   - Singleton-State + manueller Observer
 *   - useEffect-Subscription per Hook
 *   - localStorage-Persistenz mit sanitize-on-load
 *
 * Wichtig: Änderungen werden NICHT automatisch auf einen laufenden
 * AudioContext angewendet — der AudioContext muss zerstört und neu erzeugt
 * werden (`AudioEngine.reinit()`). Der Settings-UI ruft das explizit nach
 * dem User-"Apply"-Click und zeigt einen Hinweis "Audio wird kurz
 * unterbrochen".
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "ss-audio-engine-config:v1";

/** AudioContext latencyHint — direkt aus der Web-Audio-Spec. */
export type LatencyHint = "interactive" | "balanced" | "playback";

/** Sample-Rate-Option: 'auto' delegiert an den Browser/das Default-Device. */
export type SampleRateOption = 44100 | 48000 | 96000 | "auto";

export interface AudioEngineConfig {
  latencyHint: LatencyHint;
  sampleRate: SampleRateOption;
}

export const DEFAULT_CONFIG: AudioEngineConfig = {
  latencyHint: "interactive",
  sampleRate: "auto",
};

const VALID_HINTS: ReadonlySet<LatencyHint> = new Set(["interactive", "balanced", "playback"]);
const VALID_SAMPLE_RATES: ReadonlySet<SampleRateOption> = new Set([44100, 48000, 96000, "auto"]);

// ─── State + Listeners ────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();
let _state: AudioEngineConfig = loadState();

function loadState(): AudioEngineConfig {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_CONFIG };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AudioEngineConfig>;
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function sanitize(input: Partial<AudioEngineConfig> | null | undefined): AudioEngineConfig {
  const out: AudioEngineConfig = { ...DEFAULT_CONFIG };
  if (!input || typeof input !== "object") return out;
  if (typeof input.latencyHint === "string" && VALID_HINTS.has(input.latencyHint as LatencyHint)) {
    out.latencyHint = input.latencyHint as LatencyHint;
  }
  if (
    (typeof input.sampleRate === "number" || input.sampleRate === "auto") &&
    VALID_SAMPLE_RATES.has(input.sampleRate as SampleRateOption)
  ) {
    out.sampleRate = input.sampleRate as SampleRateOption;
  }
  return out;
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* swallow — quota/private-mode */
  }
}

function notify(): void {
  _listeners.forEach((l) => l());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getAudioEngineConfig(): AudioEngineConfig {
  return { ..._state };
}

export function setLatencyHint(hint: LatencyHint): void {
  if (!VALID_HINTS.has(hint)) return;
  if (_state.latencyHint === hint) return;
  _state = { ..._state, latencyHint: hint };
  persist();
  notify();
}

export function setSampleRate(rate: SampleRateOption): void {
  if (!VALID_SAMPLE_RATES.has(rate)) return;
  if (_state.sampleRate === rate) return;
  _state = { ..._state, sampleRate: rate };
  persist();
  notify();
}

/**
 * Hilfsfunktion für AudioEngine.init/reinit: liefert ein
 * `AudioContextOptions`-Objekt mit nur den gesetzten Feldern. `sampleRate`
 * wird weggelassen wenn 'auto' — sonst kann der Browser bei Mismatch
 * resampeln und unnötig CPU verbrauchen.
 */
export function buildAudioContextOptions(cfg: AudioEngineConfig = _state): AudioContextOptions {
  const opts: AudioContextOptions = { latencyHint: cfg.latencyHint };
  if (typeof cfg.sampleRate === "number") {
    opts.sampleRate = cfg.sampleRate;
  }
  return opts;
}

/** Test-Helper — Reset auf Default + localStorage clear. */
export function __resetAudioEngineConfigForTests(): void {
  _state = { ...DEFAULT_CONFIG };
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* swallow */
  }
  notify();
}

// ─── React-Hook ───────────────────────────────────────────────────────────────

export function useAudioEngineConfigStore(): AudioEngineConfig {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}
