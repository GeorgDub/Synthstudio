/**
 * Synthstudio – SampleTransformDialog (v3.136.0)
 *
 * DAW-übliches Transform-Dialog für ein Sample im Sample-Manager.
 * Bietet Time-Stretch + Pitch-Shift mit Preview + Apply-Workflow.
 *
 * Architektur:
 * - Radix-Dialog für A11y + Modal-Verhalten
 * - Pure-fn Logik liegt in `utils/sampleTransform.ts`
 * - Preview erzeugt Blob-URL aus transformed AudioBuffer (Web Audio →
 *   wavEncoder.encodeWav → Blob → URL) und spielt sie via <audio>
 * - Apply ruft `onApply(buffer, ratio, semitones, newUrl)` zurück — der
 *   Sample-Browser kümmert sich um Project-Store-Update + Engine-Cache
 *
 * v3.136: zusätzliche Transformationen via applyTransformPipeline (Pure-Helper
 * in utils/sampleTransformPipeline.ts):
 *  - Trim-Silence + Threshold-Slider
 *  - Reverse-Sample
 *  - Fade-In + Fade-Out + Curve (linear/exp/equal-power)
 *  - Auto-Normalize + Target-dBTP
 *  - Auto-Slice-Detection (Preview-only, kein Apply in v3.136 — Caveat für v3.137)
 *
 * Pipeline-Reihenfolge (deterministisch):
 *   combinedTransformAsync (Stretch + Pitch) → applyTransformPipeline
 *   (trim → reverse → fadeIn → fadeOut → normalize)
 *
 * Alle Klassen verwenden semantische Tailwind-Tokens (bg-bg-*, text-text-*,
 * border-border-color, accent-*). Keine hardcoded Slate/Cyan/etc.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import type { Sample } from "@/store/useProjectStore";
import {
  combinedTransformAsync,
  STRETCH_MIN,
  STRETCH_MAX,
  PITCH_MIN,
  PITCH_MAX,
} from "@/utils/sampleTransform";
import { encodeWav } from "@/audio/wavEncoder";
import {
  applyTransformPipeline,
  type TransformPipelineOptions,
} from "@/utils/sampleTransformPipeline";
import type { FadeCurve } from "@/utils/sampleFadeReverse";
import { detectSlicePoints } from "@/utils/sliceAutoDetector";
import type { AudioBufferLike } from "@/utils/sampleEmbedding";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SampleTransformDialogProps {
  /** Wenn null → Dialog geschlossen. */
  sample: Sample | null;
  /** Original AudioBuffer (vom Aufrufer geladen via AudioEngine.loadSample). */
  buffer: AudioBuffer | null;
  /** Schließt den Dialog ohne zu speichern. */
  onClose: () => void;
  /**
   * Wird gerufen wenn der User "Anwenden" klickt. Aufrufer ersetzt das
   * Sample (path → neue Blob-URL, buffer → newBuffer im Engine-Cache,
   * Projekt-dirty markieren).
   */
  onApply: (newBuffer: AudioBuffer, newBlobUrl: string) => void;
}

// ─── Utility: AudioBufferLike → AudioBuffer (für Pipeline-Output) ───────────

/**
 * Konvertiert ein pure-AudioBufferLike (z.B. Output von applyTransformPipeline)
 * zurück in einen echten Web-Audio-AudioBuffer.  Verwendet copyToChannel auf
 * einem frisch via ctx.createBuffer erzeugten Buffer.
 */
function audioBufferLikeToAudioBuffer(
  ctx: BaseAudioContext,
  like: AudioBufferLike,
): AudioBuffer {
  const buf = ctx.createBuffer(
    Math.max(1, like.numberOfChannels),
    Math.max(1, like.length),
    like.sampleRate,
  );
  for (let c = 0; c < like.numberOfChannels; c++) {
    const src = like.getChannelData(c);
    // copyToChannel erwartet Float32Array<ArrayBuffer>; getChannelData liefert
    // strukturell Float32Array<ArrayBufferLike>.  Kopie in frisches ArrayBuffer
    // (vermeidet TS-Strict-Mismatch + entkoppelt vom Pipeline-Buffer).
    const copy = new Float32Array(src.length);
    copy.set(src);
    buf.copyToChannel(copy, c, 0);
  }
  return buf;
}

// ─── Utility: AudioBuffer → Blob-URL ────────────────────────────────────────

function bufferToBlobUrl(buffer: AudioBuffer): string {
  // wavEncoder unterstützt nur Mono/Stereo. Falls >2 Kanäle → auf Stereo
  // herunter mixen (sollte praktisch nie vorkommen für Samples).
  const channels = Math.min(2, buffer.numberOfChannels) as 1 | 2;
  const wav = encodeWav(
    Array.from({ length: channels }, (_, c) => buffer.getChannelData(c)),
    { sampleRate: buffer.sampleRate, channels, bitDepth: 16 },
  );
  const blob = new Blob([wav], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

// ─── Dialog ──────────────────────────────────────────────────────────────────

export function SampleTransformDialog({
  sample,
  buffer,
  onClose,
  onApply,
}: SampleTransformDialogProps) {
  const [stretchRatio, setStretchRatio] = useState(1.0);
  const [pitchSemitones, setPitchSemitones] = useState(0);
  const [preserveLength, setPreserveLength] = useState(false);

  // Bei Pitch-Shift mit "preserveLength" wird der Stretch-Slider auf 1.0
  // gezwungen (effektiv reiner Pitch-Shift).
  // Wenn der User aktiv den Stretch-Slider bewegt UND preserveLength an ist,
  // wird preserveLength automatisch deaktiviert (User hat Vorrang).

  // v3.136: Pipeline-Options-State (Trim, Reverse, Fade, Normalize, Slice).
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimThresholdDb, setTrimThresholdDb] = useState(-60);
  const [reverseEnabled, setReverseEnabled] = useState(false);
  const [fadeInMs, setFadeInMs] = useState(0);
  const [fadeOutMs, setFadeOutMs] = useState(0);
  const [fadeCurve, setFadeCurve] = useState<FadeCurve>("linear");
  const [normalizeEnabled, setNormalizeEnabled] = useState(false);
  const [normalizeTargetDbTp, setNormalizeTargetDbTp] = useState(-1);
  const [sliceSensitivity, setSliceSensitivity] = useState(0.5);
  const [sliceMinMs, setSliceMinMs] = useState(50);
  const [detectedSliceCount, setDetectedSliceCount] = useState<number | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // v3.120: AbortController für Worker-Cancel
  const abortRef = useRef<AbortController | null>(null);

  // Reset State wenn Dialog neu geöffnet wird.
  useEffect(() => {
    if (sample !== null) {
      setStretchRatio(1.0);
      setPitchSemitones(0);
      setPreserveLength(false);
      setProgress(0);
      // v3.136: reset Pipeline-Options
      setTrimEnabled(false);
      setTrimThresholdDb(-60);
      setReverseEnabled(false);
      setFadeInMs(0);
      setFadeOutMs(0);
      setFadeCurve("linear");
      setNormalizeEnabled(false);
      setNormalizeTargetDbTp(-1);
      setSliceSensitivity(0.5);
      setSliceMinMs(50);
      setDetectedSliceCount(null);
    }
    // Cleanup Preview-URL beim Schließen.
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample]);

  // Cleanup Preview-URL beim Wechsel.
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const isOpen = sample !== null && buffer !== null;

  // Effective stretch ratio: wenn preserveLength + pitch≠0, bleibt stretch=1.
  const effectiveStretch = preserveLength && Math.abs(pitchSemitones) > 0.01
    ? 1.0
    : stretchRatio;

  const handleStretchChange = useCallback((v: number) => {
    setStretchRatio(v);
    if (Math.abs(v - 1.0) > 0.01) {
      setPreserveLength(false);
    }
  }, []);

  // v3.120: Async-Variante mit Worker — Live-Progress aus dem Worker, Cancel
  // via AbortController. Bei !useWorker oder Worker-Spawn-Fail fällt
  // combinedTransformAsync silent auf den Sync-Pfad zurück.
  const runTransformAsync = useCallback(async (): Promise<AudioBuffer | null> => {
    if (!buffer) return null;
    // Vorherigen Run cancelen (falls noch ein Preview-Worker lebt)
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsProcessing(true);
    setProgress(0);
    try {
      const offCtx = new (window.OfflineAudioContext ||
        // @ts-expect-error legacy webkit fallback
        window.webkitOfflineAudioContext)(
        buffer.numberOfChannels,
        Math.max(1, buffer.length),
        buffer.sampleRate,
      ) as BaseAudioContext;
      const out = await combinedTransformAsync(
        offCtx,
        buffer,
        effectiveStretch,
        pitchSemitones,
        {
          signal: controller.signal,
          onProgress: (p) => setProgress(p),
        },
      );

      // v3.136: applyTransformPipeline nach Stretch+Pitch.  Reihenfolge:
      //   trim → reverse → fadeIn → fadeOut → normalize.
      // AudioBuffer satisfies AudioBufferLike structurally (same fields/method).
      const anyActive =
        trimEnabled ||
        reverseEnabled ||
        fadeInMs > 0 ||
        fadeOutMs > 0 ||
        normalizeEnabled;
      if (!anyActive) {
        return out;
      }

      const pipelineOpts: TransformPipelineOptions = {
        trimSilence: trimEnabled,
        // dB → linear amplitude threshold: 10^(dB/20)
        trimThreshold: Math.pow(10, trimThresholdDb / 20),
        reverse: reverseEnabled,
        fadeInMs,
        fadeOutMs,
        fadeCurve,
        normalize: normalizeEnabled,
        normalizeTargetDbTp,
      };
      const piped = applyTransformPipeline(out as AudioBufferLike, pipelineOpts);

      // Wenn der Pipeline-Output exakt die gleiche Shape hat UND keine
      // Length-Änderung passierte UND der Original-Buffer als out=anyActive
      // verändert wurde → konvertiere zurück zu echtem AudioBuffer.  trim
      // kann die Länge verringern, daher new OfflineAudioContext für correct
      // length.  Falls trim einen 0-length Buffer liefert (pure silence),
      // garantiert audioBufferLikeToAudioBuffer mindestens length=1.
      const convCtx = new (window.OfflineAudioContext ||
        // @ts-expect-error legacy webkit fallback
        window.webkitOfflineAudioContext)(
        Math.max(1, piped.buffer.numberOfChannels),
        Math.max(1, piped.buffer.length),
        piped.buffer.sampleRate,
      ) as BaseAudioContext;
      const finalBuf = audioBufferLikeToAudioBuffer(convCtx, piped.buffer);
      return finalBuf;
    } catch (err) {
      // AbortError → stiller Cancel (nicht log-spam)
      const isAbort =
        (err instanceof Error && err.name === "AbortError") ||
        (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError");
      if (!isAbort) {
        // eslint-disable-next-line no-console
        console.warn("SampleTransform failed:", err);
      }
      return null;
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsProcessing(false);
    }
  }, [
    buffer,
    effectiveStretch,
    pitchSemitones,
    trimEnabled,
    trimThresholdDb,
    reverseEnabled,
    fadeInMs,
    fadeOutMs,
    fadeCurve,
    normalizeEnabled,
    normalizeTargetDbTp,
  ]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsProcessing(false);
    setProgress(0);
  }, []);

  // v3.136: Auto-Slice-Detection (Preview-only — kein Apply).
  // v3.137-Caveat: onAutoSlice-Callback im SampleBrowser noch nicht verkabelt.
  const handleDetectSlices = useCallback(() => {
    if (!buffer) {
      setDetectedSliceCount(null);
      return;
    }
    const points = detectSlicePoints(buffer as AudioBufferLike, {
      sensitivity: sliceSensitivity,
      minSliceMs: sliceMinMs,
    });
    setDetectedSliceCount(points.length);
  }, [buffer, sliceSensitivity, sliceMinMs]);

  const handlePreview = useCallback(async () => {
    if (!buffer) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    const transformed = await runTransformAsync();
    if (!transformed) return;
    const url = bufferToBlobUrl(transformed);
    setPreviewUrl(url);
    setIsPreviewPlaying(true);
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(() => {
          setIsPreviewPlaying(false);
        });
      }
    }, 0);
  }, [buffer, runTransformAsync, previewUrl]);

  const handleApply = useCallback(async () => {
    if (!buffer) return;
    const transformed = await runTransformAsync();
    if (!transformed) return;
    const url = bufferToBlobUrl(transformed);
    onApply(transformed, url);
    onClose();
  }, [buffer, runTransformAsync, onApply, onClose]);

  // Cleanup running worker beim Unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  if (!isOpen) return null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-base/80 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="sample-transform-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[94vw] max-h-[92vh] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-color bg-bg-panel shadow-2xl flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-color">
            <Dialog.Title className="text-sm font-semibold text-accent-primary tracking-wide">
              Sample transformieren
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="w-7 h-7 rounded text-text-muted hover:text-accent-danger hover:bg-bg-elevated transition-colors"
                title="Schließen"
              >
                ×
              </button>
            </Dialog.Close>
          </div>

          <div className="px-4 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
            <div className="text-xs text-text-dim truncate" title={sample?.name}>
              <span className="text-text-muted">Sample:</span>{" "}
              <span className="text-text-primary">{sample?.name}</span>
            </div>

            {/* Stretch-Slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="sample-transform-stretch"
                  className="text-xs text-text-muted"
                >
                  Time-Stretch
                </label>
                <span className="text-xs font-mono text-accent-secondary">
                  {effectiveStretch.toFixed(2)}×
                  {preserveLength && Math.abs(pitchSemitones) > 0.01 && (
                    <span className="ml-1 text-text-dim">(locked)</span>
                  )}
                </span>
              </div>
              <input
                id="sample-transform-stretch"
                type="range"
                min={STRETCH_MIN}
                max={STRETCH_MAX}
                step={0.05}
                value={stretchRatio}
                onChange={(e) => handleStretchChange(parseFloat(e.target.value))}
                disabled={preserveLength && Math.abs(pitchSemitones) > 0.01}
                className="w-full accent-accent-primary"
                data-testid="sample-transform-stretch"
              />
              <div className="flex justify-between text-[9px] text-text-dim mt-0.5">
                <span>{STRETCH_MIN}×</span>
                <span>1×</span>
                <span>{STRETCH_MAX}×</span>
              </div>
            </div>

            {/* Pitch-Slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="sample-transform-pitch"
                  className="text-xs text-text-muted"
                >
                  Pitch
                </label>
                <span className="text-xs font-mono text-accent-secondary">
                  {pitchSemitones > 0 ? "+" : ""}{pitchSemitones} st
                </span>
              </div>
              <input
                id="sample-transform-pitch"
                type="range"
                min={PITCH_MIN}
                max={PITCH_MAX}
                step={1}
                value={pitchSemitones}
                onChange={(e) => setPitchSemitones(parseInt(e.target.value, 10))}
                className="w-full accent-accent-primary"
                data-testid="sample-transform-pitch"
              />
              <div className="flex justify-between text-[9px] text-text-dim mt-0.5">
                <span>{PITCH_MIN}</span>
                <span>0</span>
                <span>+{PITCH_MAX}</span>
              </div>
            </div>

            {/* Preserve-Length-Toggle */}
            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={preserveLength}
                onChange={(e) => setPreserveLength(e.target.checked)}
                className="accent-accent-primary"
                data-testid="sample-transform-preserve-length"
              />
              <span>
                Länge beibehalten bei Pitch-Shift (sperrt Stretch auf 1×)
              </span>
            </label>

            {/* v3.136: Erweiterte Transformationen (collapsable). */}
            <details className="rounded border border-border-color bg-bg-elevated/40">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-accent-secondary hover:text-accent-primary transition-colors">
                Erweiterte Transformationen
              </summary>
              <div className="px-3 py-3 space-y-3 border-t border-border-color">
                {/* Trim-Silence */}
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={trimEnabled}
                      onChange={(e) => setTrimEnabled(e.target.checked)}
                      className="accent-accent-primary"
                      data-testid="sample-transform-trim"
                    />
                    <span>Trim Silence (Anfang + Ende)</span>
                  </label>
                  <div className="pl-6">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-text-dim">Threshold</span>
                      <span className="text-[10px] font-mono text-accent-secondary">
                        {trimThresholdDb} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-90}
                      max={-20}
                      step={1}
                      value={trimThresholdDb}
                      onChange={(e) => setTrimThresholdDb(parseInt(e.target.value, 10))}
                      disabled={!trimEnabled}
                      className="w-full accent-accent-primary"
                      data-testid="sample-transform-trim-threshold"
                    />
                  </div>
                </div>

                {/* Reverse */}
                <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reverseEnabled}
                    onChange={(e) => setReverseEnabled(e.target.checked)}
                    className="accent-accent-primary"
                    data-testid="sample-transform-reverse"
                  />
                  <span>Reverse Sample</span>
                </label>

                {/* Fade-In / Fade-Out */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <label
                        htmlFor="sample-transform-fadein"
                        className="text-[10px] text-text-muted"
                      >
                        Fade-In
                      </label>
                      <span className="text-[10px] font-mono text-accent-secondary">
                        {fadeInMs} ms
                      </span>
                    </div>
                    <input
                      id="sample-transform-fadein"
                      type="range"
                      min={0}
                      max={500}
                      step={5}
                      value={fadeInMs}
                      onChange={(e) => setFadeInMs(parseInt(e.target.value, 10))}
                      className="w-full accent-accent-primary"
                      data-testid="sample-transform-fadein"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <label
                        htmlFor="sample-transform-fadeout"
                        className="text-[10px] text-text-muted"
                      >
                        Fade-Out
                      </label>
                      <span className="text-[10px] font-mono text-accent-secondary">
                        {fadeOutMs} ms
                      </span>
                    </div>
                    <input
                      id="sample-transform-fadeout"
                      type="range"
                      min={0}
                      max={500}
                      step={5}
                      value={fadeOutMs}
                      onChange={(e) => setFadeOutMs(parseInt(e.target.value, 10))}
                      className="w-full accent-accent-primary"
                      data-testid="sample-transform-fadeout"
                    />
                  </div>
                </div>

                {/* Fade-Curve */}
                <div className="flex items-center gap-2 text-xs">
                  <label htmlFor="sample-transform-fadecurve" className="text-text-muted">
                    Curve:
                  </label>
                  <select
                    id="sample-transform-fadecurve"
                    value={fadeCurve}
                    onChange={(e) => setFadeCurve(e.target.value as FadeCurve)}
                    disabled={fadeInMs === 0 && fadeOutMs === 0}
                    className="bg-bg-panel border border-border-color rounded px-2 py-0.5 text-xs text-text-primary disabled:opacity-50"
                    data-testid="sample-transform-fadecurve"
                  >
                    <option value="linear">linear</option>
                    <option value="exp">exp</option>
                    <option value="equal-power">equal-power</option>
                  </select>
                </div>

                {/* Auto-Normalize */}
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={normalizeEnabled}
                      onChange={(e) => setNormalizeEnabled(e.target.checked)}
                      className="accent-accent-primary"
                      data-testid="sample-transform-normalize"
                    />
                    <span>Auto-Normalize (True-Peak)</span>
                  </label>
                  <div className="pl-6">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-text-dim">Target</span>
                      <span className="text-[10px] font-mono text-accent-secondary">
                        {normalizeTargetDbTp} dBTP
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-6}
                      max={0}
                      step={0.1}
                      value={normalizeTargetDbTp}
                      onChange={(e) => setNormalizeTargetDbTp(parseFloat(e.target.value))}
                      disabled={!normalizeEnabled}
                      className="w-full accent-accent-primary"
                      data-testid="sample-transform-normtarget"
                    />
                  </div>
                </div>

                {/* Auto-Slice (Preview-only in v3.136) */}
                <div className="space-y-1 pt-2 border-t border-border-color">
                  <div className="text-[10px] text-text-dim mb-1">
                    Auto-Slice (Preview — Apply folgt in v3.137)
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-text-muted">Sensitivity</span>
                        <span className="text-[10px] font-mono text-accent-secondary">
                          {sliceSensitivity.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={sliceSensitivity}
                        onChange={(e) => setSliceSensitivity(parseFloat(e.target.value))}
                        className="w-full accent-accent-primary"
                        data-testid="sample-transform-slice-sens"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-text-muted">Min</span>
                        <span className="text-[10px] font-mono text-accent-secondary">
                          {sliceMinMs} ms
                        </span>
                      </div>
                      <input
                        type="range"
                        min={20}
                        max={500}
                        step={5}
                        value={sliceMinMs}
                        onChange={(e) => setSliceMinMs(parseInt(e.target.value, 10))}
                        className="w-full accent-accent-primary"
                        data-testid="sample-transform-slice-min"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={handleDetectSlices}
                      data-testid="sample-transform-slice-detect-btn"
                      className="px-2 py-1 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors"
                      title="Slice-Points im Original-Sample analysieren"
                    >
                      Slice Points zählen
                    </button>
                    <span
                      data-testid="sample-transform-slice-count"
                      className="text-[10px] text-text-muted"
                    >
                      {detectedSliceCount === null
                        ? "Noch nicht analysiert"
                        : `Gefunden: ${detectedSliceCount} Slice-Punkte`}
                    </span>
                  </div>
                </div>
              </div>
            </details>

            {/* Progress-Bar (v3.120: live aus Worker + Cancel-Button) */}
            {isProcessing && (
              <div data-testid="sample-transform-progress">
                <div className="h-1.5 w-full bg-bg-elevated rounded overflow-hidden">
                  <div
                    className="h-full bg-accent-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[10px] text-text-dim">
                    Verarbeite… {progress}%
                  </p>
                  <button
                    type="button"
                    onClick={handleCancel}
                    data-testid="sample-transform-cancel"
                    className="text-[10px] text-accent-danger hover:underline"
                    title="Verarbeitung abbrechen"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            {/* Preview-Audio (versteckt, wird vom Preview-Button gestartet) */}
            {previewUrl && (
              <audio
                ref={audioRef}
                src={previewUrl}
                onEnded={() => setIsPreviewPlaying(false)}
                onPause={() => setIsPreviewPlaying(false)}
                onPlay={() => setIsPreviewPlaying(true)}
                className="hidden"
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-color bg-bg-base/40">
            <button
              type="button"
              onClick={handlePreview}
              disabled={isProcessing}
              data-testid="sample-transform-preview"
              className="px-3 py-1.5 rounded text-xs border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Transformierte Version anhören (kein Commit)"
            >
              {isPreviewPlaying ? "■ Stop" : "▶ Vorhören"}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs border border-border-color text-text-muted hover:text-text-primary transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={isProcessing}
                data-testid="sample-transform-apply"
                className="px-3 py-1.5 rounded text-xs bg-accent-primary text-bg-base font-semibold hover:bg-accent-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Sample dauerhaft ersetzen"
              >
                Anwenden
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
