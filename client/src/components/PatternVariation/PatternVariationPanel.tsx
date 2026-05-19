/**
 * Synthstudio – PatternVariationPanel (v3.105.0)
 *
 * UI für den Pattern-Variation-Generator. Wählt eine VariationKind +
 * Intensity (+ optional Seed) und erzeugt entweder ein einzelnes Pattern
 * oder einen Batch von 4 Variationen.
 *
 * Pure UI — die eigentliche Variation kommt aus utils/patternVariations.ts.
 * Pattern-Duplication wird per Callback an den Caller (DrumMachine)
 * delegiert.
 */
import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PatternData } from "@/audio/AudioEngine";
import {
  ALL_VARIATION_KINDS,
  VARIATION_KIND_LABELS,
  type VariationConfig,
  type VariationKind,
} from "@/utils/patternVariations";
import {
  usePatternVariationStore,
} from "@/store/usePatternVariationStore";

export interface PatternVariationPanelProps {
  /** Aktuell selected Pattern (Source für die Variation) */
  pattern: PatternData | null;
  /** Erzeugt ein neues Pattern aus dem source-Pattern + config. Liefert die neue ID zurück. */
  onApplyVariation: (source: PatternData, config: VariationConfig, suggestedName: string) => string;
  /** Optional: Switch zum neu erzeugten Pattern. */
  onSwitchToPattern?: (id: string) => void;
  onClose?: () => void;
}

export function PatternVariationPanel({
  pattern,
  onApplyVariation,
  onSwitchToPattern,
  onClose,
}: PatternVariationPanelProps) {
  const { lastUsedConfig, setLastUsedConfig, previewVariation } = usePatternVariationStore();

  const [kind, setKind] = useState<VariationKind>(lastUsedConfig.kind);
  const [intensity, setIntensity] = useState<number>(lastUsedConfig.intensity);
  const [seedInput, setSeedInput] = useState<string>(
    lastUsedConfig.seed !== undefined ? String(lastUsedConfig.seed) : "",
  );

  const seed = useMemo<number | undefined>(() => {
    if (seedInput.trim() === "") return undefined;
    const n = parseInt(seedInput, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [seedInput]);

  const config: VariationConfig = useMemo(
    () => ({ kind, intensity, seed }),
    [kind, intensity, seed],
  );

  // Preview: nur erste 8x4 Steps anzeigen (mini step view)
  const previewGrid = useMemo(() => {
    if (!pattern) return null;
    const grid = pattern.parts.slice(0, 4).map((p) => p.steps.slice(0, 8));
    return previewVariation(grid, config);
  }, [pattern, config, previewVariation]);

  const handleApply = useCallback(
    (count: number) => {
      if (!pattern) return;
      setLastUsedConfig(config);

      let lastNewId = "";
      for (let i = 0; i < count; i++) {
        const cfg: VariationConfig = count > 1
          ? { ...config, seed: seed !== undefined ? seed + i : undefined }
          : config;
        const name = count > 1
          ? `${pattern.name} (${kind} ${i + 1})`
          : `${pattern.name} (${kind})`;
        const id = onApplyVariation(pattern, cfg, name);
        if (id) lastNewId = id;
      }

      if (lastNewId && onSwitchToPattern) {
        onSwitchToPattern(lastNewId);
      }
    },
    [pattern, config, kind, seed, onApplyVariation, onSwitchToPattern, setLastUsedConfig],
  );

  const handleGenerateOne = useCallback(() => handleApply(1), [handleApply]);
  const handleGenerateBatch = useCallback(() => handleApply(4), [handleApply]);

  const handleRandomSeed = useCallback(() => {
    const r = Math.floor(Math.random() * 1_000_000);
    setSeedInput(String(r));
  }, []);

  const canApply = pattern !== null;

  return (
    <div
      className="flex flex-col gap-3 p-3 rounded border bg-bg-panel border-border-color"
      style={{ minWidth: 360 }}
      aria-label="Pattern Variation Generator Panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-accent-primary">
          Pattern Variation
        </span>
        <span className="ml-auto text-[10px] font-mono text-text-dim" aria-live="polite">
          {pattern ? pattern.name : "kein Pattern"}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="px-1.5 py-0.5 text-xs rounded text-text-muted hover:text-text-primary hover:opacity-70 flex items-center justify-center"
            aria-label="Close"
            title="Schließen (ESC)"
            data-testid="pattern-variation-close"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Kind-Picker */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider w-16 text-text-muted" htmlFor="pattern-var-kind">
          Kind
        </label>
        <select
          id="pattern-var-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as VariationKind)}
          className="flex-1 px-2 py-1 text-xs rounded border outline-none bg-bg-elevated text-text-primary border-border-color"
          aria-label="Variation-Kind"
          data-testid="pattern-variation-kind"
        >
          {ALL_VARIATION_KINDS.map((k) => (
            <option key={k} value={k}>{VARIATION_KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {/* Intensity */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-text-muted" htmlFor="pattern-var-intensity">
            Intensity
          </label>
          <span className="text-[10px] font-mono text-text-dim">{Math.round(intensity * 100)}%</span>
        </div>
        <input
          id="pattern-var-intensity"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={intensity}
          onChange={(e) => setIntensity(parseFloat(e.target.value))}
          className="w-full"
          style={{ accentColor: "var(--ss-accent-primary)" }}
          aria-label="Variation-Intensity"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={intensity}
          data-testid="pattern-variation-intensity"
        />
      </div>

      {/* Seed */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider w-16 text-text-muted" htmlFor="pattern-var-seed">
          Seed
        </label>
        <input
          id="pattern-var-seed"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9-]/g, ""))}
          placeholder="random"
          className="flex-1 px-2 py-1 text-xs rounded border outline-none bg-bg-elevated text-text-primary border-border-color"
          aria-label="Seed (leer für zufällig)"
          data-testid="pattern-variation-seed"
        />
        <button
          onClick={handleRandomSeed}
          className="px-2 py-1 text-[10px] rounded bg-bg-elevated text-text-muted hover:text-text-primary border border-border-color"
          title="Zufälligen Seed setzen"
          data-testid="pattern-variation-random-seed"
        >
          🎲
        </button>
      </div>

      {/* Preview */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Preview (4 parts × 8 steps)</span>
        <div
          className="grid gap-0.5 p-2 rounded bg-bg-base border border-border-subtle"
          style={{ gridTemplateColumns: "repeat(8, 1fr)" }}
          data-testid="pattern-variation-preview"
        >
          {previewGrid && previewGrid.length > 0 ? (
            previewGrid.flatMap((row, partIdx) =>
              row.map((step, stepIdx) => (
                <div
                  key={`${partIdx}-${stepIdx}`}
                  className={[
                    "h-3 rounded-sm transition-colors",
                    step.active ? "bg-accent-primary" : "bg-bg-elevated",
                  ].join(" ")}
                  style={{
                    opacity: step.active
                      ? Math.max(0.4, (step.velocity ?? 100) / 127)
                      : 0.3,
                  }}
                  title={step.active ? `vel ${step.velocity ?? 100}` : "—"}
                />
              )),
            )
          ) : (
            <span className="text-[10px] text-text-dim col-span-8">— Kein Pattern selected —</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleGenerateOne}
          disabled={!canApply}
          className={[
            "flex-1 px-3 py-1.5 text-xs font-bold rounded transition-colors",
            canApply
              ? "bg-accent-primary text-text-primary hover:opacity-80"
              : "bg-bg-elevated text-text-dim cursor-not-allowed",
          ].join(" ")}
          data-testid="pattern-variation-generate-one"
        >
          Generate 1
        </button>
        <button
          onClick={handleGenerateBatch}
          disabled={!canApply}
          className={[
            "flex-1 px-3 py-1.5 text-xs font-bold rounded transition-colors border",
            canApply
              ? "bg-bg-elevated text-accent-primary border-accent-primary hover:opacity-80"
              : "bg-bg-elevated text-text-dim border-border-color cursor-not-allowed",
          ].join(" ")}
          data-testid="pattern-variation-generate-batch"
        >
          Generate Batch (4)
        </button>
      </div>
    </div>
  );
}
