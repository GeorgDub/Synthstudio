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
  /** Auto-Stop nach N ms. Default 1500. Clamp 50..10000. */
  durationMs?: number;
  /** Linear-Gain 0..1 für leise Vorschau. Default 0.7. */
  gain?: number;
}

const DEFAULT_DURATION_MS = 1500;
const MIN_DURATION_MS = 50;
const MAX_DURATION_MS = 10_000;

function _clampDuration(ms: number | undefined): number {
  if (typeof ms !== "number" || !isFinite(ms)) return DEFAULT_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, ms));
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
  const durationMs = _clampDuration(opts.durationMs);
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
