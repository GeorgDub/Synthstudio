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
import type { ImportResult } from "@/utils/imports/types";
import { EsxPatternPreviewEditor } from "./EsxPatternPreviewEditor";
import {
  type StepReductionStrategy,
  stepReductionLabel,
  STEP_REDUCTION_STRATEGIES,
} from "@/utils/patternStepReduce";

export interface EsxImportDialogProps {
  preview: EsxImportPreview;
  /**
   * v3.285: editierbares ImportResult (Steps). Wenn gesetzt, zeigt der Dialog
   * eine editierbare Pattern/Step-Vorschau statt der Read-Only-Liste.
   */
  editable?: ImportResult | null;
  selectedPatternIdx?: number;
  onSelectPattern?: (idx: number) => void;
  onToggleStep?: (patternIdx: number, partIdx: number, stepIdx: number) => void;
  onClearPart?: (patternIdx: number, partIdx: number) => void;
  /**
   * v3.286: Step-Cap für Anzeige + Laden (128 = volle Länge; 64/32/16 = auf die
   * ersten N Steps abschneiden).
   */
  stepCap?: 16 | 32 | 64 | 128;
  onSetStepCap?: (cap: 16 | 32 | 64 | 128) => void;
  /** v3.287: beim Laden auch die Bank-Samples den Parts zuweisen (hörbar). */
  loadSamples?: boolean;
  onSetLoadSamples?: (v: boolean) => void;
  /** Konvertiert die Bank zu E2S (mit der gewählten Reduktions-Strategie). */
  onConvert: (strategy: StepReductionStrategy) => void;
  /** Lädt Patterns + Samples in den Sequenzer. */
  onLoadToSequencer: (strategy: StepReductionStrategy) => void;
  /** Exportiert alle Bank-Samples als WAV-ZIP. */
  onExportSamples?: () => void;
  /** Öffnet den Bank/Sample-Editor (KorgBankModal) für diese Datei. */
  onOpenBankEditor?: () => void;
  /** Lädt einen ESX-Song (per Song-Index) als Song-Arrangement. */
  onLoadSong?: (songIndex: number) => void;
  onCancel: () => void;
  /** Läuft gerade eine Aktion? (deaktiviert die Buttons) */
  busy?: boolean;
}

export function EsxImportDialog({
  preview,
  editable,
  selectedPatternIdx = 0,
  onSelectPattern,
  onToggleStep,
  onClearPart,
  stepCap = 128,
  onSetStepCap,
  loadSamples = true,
  onSetLoadSamples,
  onConvert,
  onLoadToSequencer,
  onExportSamples,
  onOpenBankEditor,
  onLoadSong,
  onCancel,
  busy = false,
}: EsxImportDialogProps) {
  const [strategy, setStrategy] = useState<StepReductionStrategy>("decimate");
  const [editMode, setEditMode] = useState(true);
  const needsReduction = preview.patternsNeedingReduction > 0;
  const canEdit =
    !!editable &&
    !!onSelectPattern &&
    !!onToggleStep &&
    !!onClearPart &&
    editable.patterns.length > 0;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-bg-base/70"
      data-testid="esx-import-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[min(920px,94vw)] h-[min(640px,88vh)] flex flex-col rounded-lg border border-border-color bg-bg-panel shadow-xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-color flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-text-primary truncate">
              Korg-Import — {preview.source}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              {preview.patternCount} Pattern(s) · {preview.monoSamples} Mono- +{" "}
              {preview.stereoSamples} Stereo-Samples
            </div>
          </div>
          <div className="flex-1" />
          {canEdit && onSetStepCap && (
            <div
              className="flex items-center gap-1"
              data-testid="esx-step-cap"
              title="Wieviele Steps laden — 128 = alle (volle Länge), 64/32/16 = auf die ersten N kürzen"
            >
              <span className="text-[10px] text-text-dim">Steps laden:</span>
              {([16, 32, 64, 128] as const).map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSetStepCap(n)}
                  data-testid={`esx-step-cap-${n}`}
                  title={
                    n === 128
                      ? "Alle 128 Steps laden (volle Pattern-Länge)"
                      : `Auf die ersten ${n} Steps kürzen`
                  }
                  className={[
                    "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                    stepCap === n
                      ? "bg-accent-primary/25 text-accent-primary"
                      : "bg-bg-elevated text-text-dim hover:text-text-primary",
                  ].join(" ")}
                >
                  {n === 128 ? "128 · alle" : n}
                </button>
              ))}
            </div>
          )}
          {canEdit && (
            <div
              className="flex items-center gap-1"
              data-testid="esx-view-toggle"
            >
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className={[
                  "px-2 py-1 rounded text-[11px] transition-colors",
                  editMode
                    ? "bg-accent-primary/25 text-accent-primary"
                    : "bg-bg-elevated text-text-dim hover:text-text-primary",
                ].join(" ")}
                data-testid="esx-view-edit"
              >
                ✎ Bearbeiten
              </button>
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className={[
                  "px-2 py-1 rounded text-[11px] transition-colors",
                  !editMode
                    ? "bg-accent-primary/25 text-accent-primary"
                    : "bg-bg-elevated text-text-dim hover:text-text-primary",
                ].join(" ")}
                data-testid="esx-view-summary"
              >
                ☰ Übersicht
              </button>
            </div>
          )}
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

        {/* Editierbare Pattern/Step-Vorschau (v3.285) */}
        {canEdit && editMode && (
          <div className="flex-1 min-h-0 px-2 py-1">
            <div className="text-[10px] text-text-dim px-1 pb-1">
              Klick auf eine Zelle toggelt den Step · Klick auf den Part-Namen
              leert die Spur. Änderungen landen beim „In Sequenzer laden".
            </div>
            <div className="h-[calc(100%-1.25rem)]">
              {/* canEdit garantiert, dass editable + Callbacks gesetzt sind. */}
              <EsxPatternPreviewEditor
                result={editable!}
                selectedPatternIdx={selectedPatternIdx}
                stepCap={stepCap}
                onSelectPattern={onSelectPattern!}
                onToggleStep={onToggleStep!}
                onClearPart={onClearPart!}
              />
            </div>
          </div>
        )}

        {/* Pattern-Liste (Read-Only-Übersicht) */}
        <div
          className={[
            "flex-1 overflow-y-auto px-2 py-1",
            canEdit && editMode ? "hidden" : "",
          ].join(" ")}
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

        {/* Song-Liste (Arrangements) */}
        {onLoadSong && preview.songs.length > 0 && (
          <div
            className="border-t border-border-color px-2 py-1 max-h-[22vh] overflow-y-auto"
            data-testid="esx-import-song-list"
          >
            <div className="px-2 py-1 text-[11px] text-text-muted font-medium">
              Songs (Arrangements) — laden aktiviert den Song-Modus:
            </div>
            {preview.songs.map(s => (
              <div
                key={s.index}
                className="flex items-center gap-2 px-2 py-1 text-[11px] border-b border-border-subtle"
              >
                <span className="w-8 text-text-dim tabular-nums">
                  ♫{s.index}
                </span>
                <span className="flex-1 truncate text-text-primary">
                  {s.name || `SONG_${s.index}`}
                </span>
                <span className="text-text-muted tabular-nums">
                  {s.slotCount} Slots
                </span>
                <button
                  onClick={() => onLoadSong(s.index)}
                  disabled={busy}
                  className="px-2 py-0.5 rounded bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/40 hover:bg-accent-secondary/30 transition-colors disabled:opacity-40"
                  data-testid={`esx-import-song-${s.index}`}
                >
                  → Song laden
                </button>
              </div>
            ))}
          </div>
        )}

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
          {onOpenBankEditor && (
            <button
              onClick={onOpenBankEditor}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
              data-testid="esx-import-bank-editor"
              title="Bank/Sample-Editor öffnen (umbenennen, Tune/Level/Loop, Trim, Stereo→Mono, Merge)"
            >
              🎛 Bank &amp; Samples
            </button>
          )}
          <div className="flex-1" />
          {onSetLoadSamples && (
            <label
              className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none px-1"
              title="Beim Laden die zugehörigen Bank-Samples den Parts zuweisen (Pattern wird hörbar). Mute-Zustände werden ebenfalls übernommen."
              data-testid="esx-import-load-samples"
            >
              <input
                type="checkbox"
                checked={loadSamples}
                onChange={e => onSetLoadSamples(e.target.checked)}
                className="accent-accent-primary"
              />
              🔊 Samples mitladen
            </label>
          )}
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
