/**
 * Synthstudio – SampleTransformDialog (v3.116.0)
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
 * Alle Klassen verwenden semantische Tailwind-Tokens (bg-bg-*, text-text-*,
 * border-border-color, accent-*). Keine hardcoded Slate/Cyan/etc.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import type { Sample } from "@/store/useProjectStore";
import {
  combinedTransform,
  STRETCH_MIN,
  STRETCH_MAX,
  PITCH_MIN,
  PITCH_MAX,
} from "@/utils/sampleTransform";
import { encodeWav } from "@/audio/wavEncoder";

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

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset State wenn Dialog neu geöffnet wird.
  useEffect(() => {
    if (sample !== null) {
      setStretchRatio(1.0);
      setPitchSemitones(0);
      setPreserveLength(false);
      setProgress(0);
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

  const runTransform = useCallback((): AudioBuffer | null => {
    if (!buffer) return null;
    setIsProcessing(true);
    setProgress(10);
    try {
      // Pseudo-Progress: timeStretchBuffer ist synchron — wir geben dem
      // User aber visuelles Feedback in 3 Schritten.
      setProgress(30);
      // Offscreen AudioContext bauen (BaseAudioContext-kompatibel).
      const offCtx = new (window.OfflineAudioContext ||
        // @ts-expect-error legacy webkit fallback
        window.webkitOfflineAudioContext)(
        buffer.numberOfChannels,
        // Länge ist egal, wir nutzen den ctx nur als createBuffer-Factory.
        Math.max(1, buffer.length),
        buffer.sampleRate,
      ) as BaseAudioContext;
      setProgress(50);
      const out = combinedTransform(offCtx, buffer, effectiveStretch, pitchSemitones);
      setProgress(90);
      return out;
    } finally {
      setProgress(100);
      setIsProcessing(false);
    }
  }, [buffer, effectiveStretch, pitchSemitones]);

  const handlePreview = useCallback(() => {
    if (!buffer) return;
    // Stop currently playing preview.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    const transformed = runTransform();
    if (!transformed) return;
    const url = bufferToBlobUrl(transformed);
    setPreviewUrl(url);
    setIsPreviewPlaying(true);
    // Audio-Element auf nächsten Tick spielen (nachdem src gesetzt wurde).
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(() => {
          setIsPreviewPlaying(false);
        });
      }
    }, 0);
  }, [buffer, runTransform, previewUrl]);

  const handleApply = useCallback(() => {
    if (!buffer) return;
    const transformed = runTransform();
    if (!transformed) return;
    const url = bufferToBlobUrl(transformed);
    onApply(transformed, url);
    onClose();
  }, [buffer, runTransform, onApply, onClose]);

  if (!isOpen) return null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-base/80 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="sample-transform-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-color bg-bg-panel shadow-2xl"
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

          <div className="px-4 py-4 space-y-4">
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

            {/* Progress-Bar */}
            {isProcessing && (
              <div>
                <div className="h-1.5 w-full bg-bg-elevated rounded overflow-hidden">
                  <div
                    className="h-full bg-accent-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[10px] text-text-dim mt-1">
                  Verarbeite… {progress}%
                </p>
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
