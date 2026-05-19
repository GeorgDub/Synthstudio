/**
 * Synthstudio – Sample-Pack-Audio-Preview (v3.107.0)
 *
 * Pure-ish helper für Hover-Preview im SamplePackBrowser:
 *  - decodeAudioData(arrayBuffer) → AudioBuffer
 *  - BufferSource → connect(destination) → start(now) + auto-stop
 *  - Returns stop-Handle für onMouseLeave / Abbruch beim nächsten Hover
 *
 * Test-Notiz: In jsdom existiert keine echte Web-Audio-API; Tests mocken
 * AudioContext + decodeAudioData. Die Logik des stop-Pfads (idempotent,
 * disconnect, set onended=null) wird via Mocks verifiziert.
 */

export interface PreviewHandle {
  /** Stoppt die laufende Wiedergabe (idempotent). */
  stop: () => void;
  /** True nach `stop()` oder nach onended-Fire. */
  isStopped: () => boolean;
}

export interface PreviewOptions {
  /**
   * Optionaler Override für die Auto-Stop-Dauer. Wenn nicht gesetzt, wird die
   * Dauer aus `AudioBuffer.duration` abgeleitet (siehe v3.108.0):
   *   effectiveMs = min(SAMPLE_LENGTH_CAP_MS, audioBuffer.duration * 1000)
   * Kurze One-Shots (Drum-Hits < 3s) spielen also vollständig durch, Loops
   * werden bei 3s gekappt. Clamp auf 50..10000 ms.
   */
  durationMs?: number;
  /** Linear-Gain 0..1 für leise Vorschau. Default 0.7. */
  gain?: number;
}

/**
 * v3.108.0: Default-Stop bei spät spielenden Samples / Loops. Vorher fixed
 * 1500 ms — was Drum-Hits abschnitt und Loops zu kurz preview-te. Jetzt:
 *   min(SAMPLE_LENGTH_CAP_MS, audioBuffer.duration * 1000).
 */
export const SAMPLE_LENGTH_CAP_MS = 3000;
const FALLBACK_DURATION_MS = 1500;
const MIN_DURATION_MS = 50;
const MAX_DURATION_MS = 10_000;

function _clampDuration(ms: number): number {
  if (typeof ms !== "number" || !isFinite(ms)) return FALLBACK_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, ms));
}

/**
 * v3.108.0: Berechnet die effektive Preview-Dauer in ms.
 *  - explizites override gewinnt immer (klemmt auf MIN..MAX).
 *  - sonst: min(SAMPLE_LENGTH_CAP_MS, durationSeconds*1000), aber niemals
 *    unter MIN_DURATION_MS.
 *  - bei ungültigem durationSeconds → FALLBACK_DURATION_MS (1500).
 */
export function resolvePreviewDurationMs(
  durationSeconds: number | null | undefined,
  override?: number,
): number {
  if (typeof override === "number" && isFinite(override)) {
    return _clampDuration(override);
  }
  if (
    typeof durationSeconds !== "number" ||
    !isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return FALLBACK_DURATION_MS;
  }
  const ms = durationSeconds * 1000;
  // min(cap, sample-länge) — aber nicht unter MIN_DURATION_MS.
  const effective = Math.min(SAMPLE_LENGTH_CAP_MS, ms);
  return Math.max(MIN_DURATION_MS, effective);
}

/**
 * Spielt einen ArrayBuffer als kurze Hover-Vorschau ab.
 *
 * Verträge:
 *  - Niemals throws — bei Fehlern wird `stop()` direkt als No-Op returned.
 *  - Mehrfacher stop()-Call ist idempotent.
 *  - Nach durationMs oder onended-Fire wird der Source auto-disconnected.
 */
export async function previewSample(
  data: ArrayBuffer,
  audioCtx: AudioContext,
  opts: PreviewOptions = {},
): Promise<PreviewHandle> {
  const gainValue = typeof opts.gain === "number" && isFinite(opts.gain)
    ? Math.max(0, Math.min(1, opts.gain))
    : 0.7;

  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let source: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (source) {
      try { source.stop(); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* ignore */ }
      source.onended = null;
      source = null;
    }
    if (gainNode) {
      try { gainNode.disconnect(); } catch { /* ignore */ }
      gainNode = null;
    }
  };

  try {
    // Cloning the ArrayBuffer is critical: decodeAudioData detaches it.
    // We want the caller to be able to re-trigger preview without re-reading.
    const buf = data.slice(0);
    const audioBuffer = await audioCtx.decodeAudioData(buf);
    if (stopped) {
      // stop() called between decode-await and now → bail out.
      return { stop: cleanup, isStopped: () => true };
    }
    // v3.108.0: Sample-length-aware Preview. Auto-Stop bei min(3s, sample-länge).
    const durationSec = typeof audioBuffer.duration === "number" ? audioBuffer.duration : null;
    const durationMs = resolvePreviewDurationMs(durationSec, opts.durationMs);

    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    gainNode = audioCtx.createGain();
    gainNode.gain.value = gainValue;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.onended = () => { cleanup(); };
    source.start();
    timeoutId = setTimeout(() => { cleanup(); }, durationMs);
  } catch {
    // Decode-Fehler / Context-Down → silent stop. UI fallback: kein Sound.
    cleanup();
  }

  return {
    stop: cleanup,
    isStopped: () => stopped,
  };
}

/**
 * Best-effort Lookup-Helper für eine "shared" AudioContext-Instanz.
 * Reused über Hover-Events damit wir nicht pro Hover einen neuen Context
 * erzeugen (Browser begrenzt aktive Contexts auf ~6).
 */
let _sharedCtx: AudioContext | null = null;
export function getSharedPreviewContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const WindowAudioContext =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!WindowAudioContext) return null;
  if (_sharedCtx) return _sharedCtx;
  try {
    _sharedCtx = new WindowAudioContext();
    return _sharedCtx;
  } catch {
    return null;
  }
}

/** Test-Reset. Erlaubt Tests, die Singleton-Context zu verwerfen. */
export function __resetSharedPreviewContextForTests(): void {
  if (_sharedCtx) {
    try { _sharedCtx.close(); } catch { /* ignore */ }
  }
  _sharedCtx = null;
}
