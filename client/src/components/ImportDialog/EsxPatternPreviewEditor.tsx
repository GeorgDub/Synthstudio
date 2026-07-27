/**
 * EsxPatternPreviewEditor.tsx — editierbare Pattern/Step-Vorschau im
 * Korg-Import-Dialog (v3.285).
 *
 * Zeigt für die geparste Bank eine Pattern-Auswahl (links) und ein editierbares
 * Step-Grid (rechts): Parts × Steps, Klick auf eine Zelle toggelt den Trigger.
 * Der User kann so VOR dem Laden in den Sequenzer korrigieren, was aus der .esx
 * dekodiert wurde. Rein präsentational — alle Edits laufen über Callbacks, der
 * State (ein `ImportResult`) lebt im Controller.
 *
 * Styling: ausschließlich semantische --ss-*-Tokens (keine hardcodierten Farben).
 */
import type { ImportResult } from "@/utils/imports/types";
import { countActiveSteps } from "@/utils/imports/editImportedPattern";

export interface EsxPatternPreviewEditorProps {
  result: ImportResult;
  selectedPatternIdx: number;
  /** v3.286: nur die ersten `stepCap` Steps anzeigen (128 = alle). */
  stepCap?: number;
  onSelectPattern: (idx: number) => void;
  onToggleStep: (patternIdx: number, partIdx: number, stepIdx: number) => void;
  onClearPart: (patternIdx: number, partIdx: number) => void;
}

export function EsxPatternPreviewEditor({
  result,
  selectedPatternIdx,
  stepCap = 128,
  onSelectPattern,
  onToggleStep,
  onClearPart,
}: EsxPatternPreviewEditorProps) {
  const pattern = result.patterns[selectedPatternIdx];

  return (
    <div className="flex gap-2 h-full min-h-0" data-testid="esx-preview-editor">
      {/* Pattern-Auswahl */}
      <div className="w-40 flex-shrink-0 overflow-y-auto border-r border-border-color pr-1">
        {result.patterns.map((p, idx) => {
          const active = countActiveSteps(result, idx);
          const isSel = idx === selectedPatternIdx;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectPattern(idx)}
              data-testid={`esx-preview-pattern-${idx}`}
              className={[
                "w-full flex items-center gap-1 px-2 py-1 rounded text-[11px] text-left transition-colors",
                isSel
                  ? "bg-accent-primary/25 text-accent-primary"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-elevated",
              ].join(" ")}
            >
              <span className="w-6 tabular-nums text-text-dim">#{idx}</span>
              <span className="flex-1 truncate">
                {p.name || `PATTERN_${idx}`}
              </span>
              <span className="tabular-nums text-text-dim">{active}</span>
            </button>
          );
        })}
      </div>

      {/* Step-Grid des gewählten Patterns */}
      <div className="flex-1 min-w-0 overflow-auto">
        {!pattern ? (
          <div className="text-[11px] text-text-dim italic py-8 text-center">
            Kein Pattern gewählt.
          </div>
        ) : (
          <div className="min-w-max">
            {pattern.parts.map((part, partIdx) => {
              const isSynth = part.steps.some(
                s => s.active && typeof s.pitch === "number" && s.pitch !== 0
              );
              const shown = part.steps.slice(0, stepCap);
              return (
                <div
                  key={partIdx}
                  className="flex items-center gap-1 py-0.5"
                  data-testid={`esx-preview-part-${partIdx}`}
                >
                  <button
                    type="button"
                    onClick={() => onClearPart(selectedPatternIdx, partIdx)}
                    title="Diesen Part leeren"
                    className="w-28 flex-shrink-0 truncate text-left text-[10px] text-text-muted hover:text-accent-danger transition-colors"
                  >
                    {isSynth ? "♪ " : ""}
                    {part.name}
                  </button>
                  <div className="flex gap-[2px]">
                    {shown.map((step, stepIdx) => {
                      const isBeat = stepIdx % 4 === 0;
                      return (
                        <button
                          key={stepIdx}
                          type="button"
                          onClick={() =>
                            onToggleStep(selectedPatternIdx, partIdx, stepIdx)
                          }
                          data-testid={`esx-preview-step-${partIdx}-${stepIdx}`}
                          title={`Part „${part.name}" · Step ${stepIdx + 1}${
                            step.active &&
                            typeof step.pitch === "number" &&
                            step.pitch !== 0
                              ? ` · Note ${step.pitch > 0 ? "+" : ""}${step.pitch}`
                              : ""
                          }`}
                          className={[
                            "w-3 h-4 rounded-sm transition-colors",
                            step.active
                              ? isSynth
                                ? "bg-accent-secondary"
                                : "bg-accent-primary"
                              : isBeat
                                ? "bg-bg-base hover:bg-bg-elevated"
                                : "bg-bg-elevated hover:bg-border-color",
                          ].join(" ")}
                          style={
                            isBeat && !step.active
                              ? { outline: "1px solid var(--ss-border)" }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
