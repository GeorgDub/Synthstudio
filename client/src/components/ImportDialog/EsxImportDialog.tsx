/**
 * EsxImportDialog.tsx — Unified-Import-Dialog für Korg-ESX-1-Bänke.
 *
 * Präsentational: bekommt die fertige Vorschau (`EsxImportPreview`) + Callbacks
 * und zeigt dem User VOR der Entscheidung, was in der Datei steckt (Patterns,
 * BPM, Step-Länge, Samples). Dann die Wahl:
 *   - „Konvertieren zu E2S" (.e2sallpat/.all) — für den Transfer aufs Gerät.
 *   - „In Sequenzer laden" — Patterns + Sampler direkt in Synthstudio.
 *
 * Bei Patterns mit > 64 Steps (ESX Length_5..8) blendet der Dialog die
 * Reduktions-Strategie ein (E2S fasst nur 64/4 Bänke): Halbieren (jeder 2.) oder
 * Erste 64. Manuelles Editieren pro Pattern folgt in einer späteren Scheibe.
 *
 * Styling: ausschließlich semantische --ss-*-Tokens (keine hardcodierten Farben).
 */
import { useState } from "react";
import type { EsxImportPreview } from "@/utils/imports/esxImportPreview";
import {
  type StepReductionStrategy,
  stepReductionLabel,
  STEP_REDUCTION_STRATEGIES,
} from "@/utils/patternStepReduce";

export interface EsxImportDialogProps {
  preview: EsxImportPreview;
  /** Konvertiert die Bank zu E2S (mit der gewählten Reduktions-Strategie). */
  onConvert: (strategy: StepReductionStrategy) => void;
  /** Lädt Patterns + Samples in den Sequenzer. */
  onLoadToSequencer: (strategy: StepReductionStrategy) => void;
  /** Exportiert alle Bank-Samples als WAV-ZIP. */
  onExportSamples?: () => void;
  onCancel: () => void;
  /** Läuft gerade eine Aktion? (deaktiviert die Buttons) */
  busy?: boolean;
}

export function EsxImportDialog({
  preview,
  onConvert,
  onLoadToSequencer,
  onExportSamples,
  onCancel,
  busy = false,
}: EsxImportDialogProps) {
  const [strategy, setStrategy] = useState<StepReductionStrategy>("decimate");
  const needsReduction = preview.patternsNeedingReduction > 0;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-bg-base/70"
      data-testid="esx-import-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[min(680px,92vw)] max-h-[88vh] flex flex-col rounded-lg border border-border-color bg-bg-panel shadow-xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-color">
          <div className="text-sm font-bold text-text-primary">
            ESX-Import — {preview.source}
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            {preview.patternCount} Pattern(s) · {preview.monoSamples} Mono- +{" "}
            {preview.stereoSamples} Stereo-Samples
          </div>
        </div>

        {/* Reduktions-Hinweis + Strategie */}
        {needsReduction && (
          <div
            className="px-4 py-2 border-b border-border-color bg-bg-elevated"
            data-testid="esx-import-reduction"
          >
            <div className="text-[11px] text-accent-secondary font-medium">
              {preview.patternsNeedingReduction} Pattern(s) haben mehr als 64
              Steps — die E2S fasst nur 64 (4 Bänke). Reduktion:
            </div>
            <div className="flex gap-2 mt-1.5">
              {STEP_REDUCTION_STRATEGIES.map(s => (
                <label
                  key={s}
                  className={[
                    "flex items-center gap-1 text-[11px] px-2 py-1 rounded cursor-pointer border transition-colors",
                    strategy === s
                      ? "border-accent-primary bg-accent-primary/20 text-text-primary"
                      : "border-border-color text-text-muted hover:text-text-primary",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="esx-reduction-strategy"
                    className="sr-only"
                    checked={strategy === s}
                    onChange={() => setStrategy(s)}
                    data-testid={`esx-import-strategy-${s}`}
                  />
                  {stepReductionLabel(s)}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Pattern-Liste */}
        <div
          className="flex-1 overflow-y-auto px-2 py-1"
          data-testid="esx-import-pattern-list"
        >
          {preview.patterns.length === 0 ? (
            <div className="text-[11px] text-text-dim italic text-center py-8">
              Keine belegten Patterns in dieser Bank.
            </div>
          ) : (
            preview.patterns.map(p => (
              <div
                key={p.index}
                className="flex items-center gap-2 px-2 py-1 text-[11px] border-b border-border-subtle"
              >
                <span className="w-8 text-text-dim tabular-nums">
                  #{p.index}
                </span>
                <span className="flex-1 truncate text-text-primary">
                  {p.name || `PATTERN_${p.index}`}
                </span>
                <span className="text-text-muted tabular-nums">
                  {Math.round(p.bpm)} BPM
                </span>
                <span className="w-16 text-right text-text-muted tabular-nums">
                  {p.effectiveSteps} St.
                </span>
                {p.hasMelody && (
                  <span
                    className="text-accent-primary"
                    title="Enthält Melodie (Keyboard-Part)"
                  >
                    ♪
                  </span>
                )}
                {p.needsReduction && (
                  <span
                    className="text-accent-secondary"
                    title="Wird auf 64 Steps reduziert"
                    data-testid={`esx-import-reduce-badge-${p.index}`}
                  >
                    ↓64
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Aktionen */}
        <div className="px-4 py-3 border-t border-border-color flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            data-testid="esx-import-cancel"
          >
            Abbrechen
          </button>
          {onExportSamples && (
            <button
              onClick={onExportSamples}
              disabled={
                busy || preview.monoSamples + preview.stereoSamples === 0
              }
              className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
              data-testid="esx-import-export-samples"
              title="Alle Bank-Samples als WAV-ZIP exportieren"
            >
              🎵 Samples als WAV
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => onConvert(strategy)}
            disabled={busy || preview.patternCount === 0}
            className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-primary hover:brightness-125 transition-colors disabled:opacity-40"
            data-testid="esx-import-convert"
          >
            📤 Konvertieren zu E2S
          </button>
          <button
            onClick={() => onLoadToSequencer(strategy)}
            disabled={busy || preview.patternCount === 0}
            className="px-3 py-1.5 text-xs rounded bg-accent-primary/25 text-accent-primary border border-accent-primary/50 hover:bg-accent-primary/40 transition-colors disabled:opacity-40 font-medium"
            data-testid="esx-import-load"
          >
            🎚 In Sequenzer laden
          </button>
        </div>
      </div>
    </div>
  );
}
