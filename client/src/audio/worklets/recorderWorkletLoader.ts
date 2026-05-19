/**
 * Synthstudio – recorderWorkletLoader.ts (v3.114.0)
 *
 * Async-Init-Helper für recorder-processor AudioWorklet. Idempotent per
 * AudioContext — addModule() darf nur einmal pro Context aufgerufen werden.
 *
 * Feature-Detection für graceful Fallback: ohne AudioWorklet (sehr alte
 * Browsers / Tests ohne AudioWorklet-Mock) wird der ScriptProcessor-Pfad
 * verwendet.
 *
 * Side-effect-frei beim Import — nur init() ruft addModule().
 */

/** Public URL des Worklet-Scripts (kopiert via vite publicDir). */
export const RECORDER_WORKLET_URL = "./worklets/recorder-worklet.js";

/** Maximaler Capture-Frames pro Track (~10 min @ 48k). Wird per port.cmd 'setMaxFrames' an den Processor durchgereicht. */
export const RECORDER_DEFAULT_MAX_FRAMES = 600 * 48000;

/** WeakMap statt globaler Set — vermeidet Memory-Leak wenn Contexts disposed werden. */
const _initialized: WeakMap<BaseAudioContext, boolean> = new WeakMap();
const _inflight: WeakMap<BaseAudioContext, Promise<void>> = new WeakMap();

/**
 * Returns true wenn AudioWorklet im aktuellen Context verfügbar ist.
 * Fallback-Detection: einige Test-Stubs liefern `ctx.audioWorklet === undefined`.
 */
export function isAudioWorkletAvailable(ctx: BaseAudioContext | null | undefined): boolean {
  if (!ctx) return false;
  const w = (ctx as { audioWorklet?: { addModule?: (url: string) => Promise<void> } }).audioWorklet;
  return !!w && typeof w.addModule === "function";
}

/**
 * Lädt das recorder-processor-Module im AudioContext. Idempotent — zweiter
 * Aufruf returnt sofort.
 *
 * Wirft Error wenn AudioWorklet nicht verfügbar — Caller MUSS vorher
 * `isAudioWorkletAvailable(ctx)` prüfen oder den Throw als Fallback-Signal
 * behandeln.
 */
export async function loadRecorderWorklet(ctx: BaseAudioContext, urlOverride?: string): Promise<void> {
  if (!isAudioWorkletAvailable(ctx)) {
    throw new Error("AudioWorklet not available in this AudioContext");
  }
  if (_initialized.get(ctx)) return;
  const existing = _inflight.get(ctx);
  if (existing) return existing;

  const url = urlOverride || RECORDER_WORKLET_URL;
  const w = (ctx as { audioWorklet: { addModule: (url: string) => Promise<void> } }).audioWorklet;
  const p = w.addModule(url).then(
    () => {
      _initialized.set(ctx, true);
      _inflight.delete(ctx);
    },
    (err: unknown) => {
      _inflight.delete(ctx);
      throw err;
    }
  );
  _inflight.set(ctx, p);
  return p;
}

/** Test-Helper — reset Idempotenz für isolierte Tests. */
export function __resetRecorderWorkletForTests(ctx: BaseAudioContext): void {
  _initialized.delete(ctx);
  _inflight.delete(ctx);
}
