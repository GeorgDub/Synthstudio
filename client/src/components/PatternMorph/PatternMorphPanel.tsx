/**
 * Synthstudio – PatternMorphPanel
 *
 * UI für Pattern-Morphing zwischen zwei Patterns.
 *
 * Funktionen:
 *  - Pattern-A und Pattern-B aus Liste wählen
 *  - Slider für `amount` (0..1) interpoliert zwischen beiden
 *  - Live-Preview (zeigt Step-Count und Dominanz)
 *  - "Apply Morph" erzeugt neues Pattern aus dem Morph-Resultat
 *  - "Reset Morph" stellt den Default-Zustand wieder her
 *
 * Die Auto-Morph-Animation (Pattern wandert automatisch über N Bars von A→B)
 * ist im Store vorbereitet, aber im UI noch nicht angeschaltet — kann als
 * Folgeschritt mit einer Position-Callback an die AudioEngine eingehängt werden.
 */
import { useCallback, useMemo } from "react";
import type { PatternData } from "@/audio/AudioEngine";
import { useMorphStore } from "@/store/useMorphStore";
import { morphPatterns } from "@/utils/patternMorph";

export interface PatternMorphPanelProps {
  patterns: PatternData[];
  /** Wird beim Klick auf "Apply" mit dem neu erzeugten Pattern aufgerufen. */
  onApplyMorph: (morphed: PatternData) => void;
  onClose?: () => void;
}

export function PatternMorphPanel({ patterns, onApplyMorph, onClose }: PatternMorphPanelProps) {
  const {
    amount,
    patternAId,
    patternBId,
    isActive,
    setAmount,
    setPatternA,
    setPatternB,
    setActive,
    resetMorph,
  } = useMorphStore();

  const patternA = useMemo(
    () => patterns.find((p) => p.id === patternAId) ?? null,
    [patterns, patternAId]
  );
  const patternB = useMemo(
    () => patterns.find((p) => p.id === patternBId) ?? null,
    [patterns, patternBId]
  );

  const canMorph = patternA !== null && patternB !== null;
  const dominantLabel = amount < 0.5 ? "A" : "B";
  const dominantName = amount < 0.5 ? patternA?.name : patternB?.name;

  const handleApply = useCallback(() => {
    if (!patternA || !patternB) return;
    const morphed = morphPatterns(patternA, patternB, amount);
    onApplyMorph(morphed);
  }, [patternA, patternB, amount, onApplyMorph]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setAmount(parseFloat(e.target.value));
      if (!isActive) setActive(true);
    },
    [setAmount, isActive, setActive]
  );

  const handlePatternASelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setPatternA(e.target.value || null);
    },
    [setPatternA]
  );

  const handlePatternBSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setPatternB(e.target.value || null);
    },
    [setPatternB]
  );

  return (
    <div
      className="flex flex-col gap-3 p-3 rounded border"
      style={{
        borderColor: isActive ? "var(--ss-accent-primary)" : "var(--ss-border)",
        background:  "var(--ss-bg-panel)",
        minWidth:    320,
      }}
      aria-label="Pattern Morph Panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: "var(--ss-accent-primary)" }}
        >
          Pattern Morph
        </span>
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: "var(--ss-text-dim)" }}
          aria-live="polite"
        >
          {Math.round(amount * 100)}% → {dominantLabel}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="px-1.5 py-0.5 text-xs rounded hover:opacity-70"
            style={{ color: "var(--ss-text-muted)" }}
            aria-label="Schließen"
          >
            ✕
          </button>
        )}
      </div>

      {/* Pattern A */}
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] uppercase tracking-wider w-6"
          style={{ color: amount < 0.5 ? "var(--ss-accent-primary)" : "var(--ss-text-dim)" }}
        >
          A
        </span>
        <select
          value={patternAId ?? ""}
          onChange={handlePatternASelect}
          className="flex-1 px-2 py-1 text-xs rounded border outline-none"
          style={{
            borderColor: "var(--ss-border)",
            color:       "var(--ss-text-primary)",
            background:  "var(--ss-bg-elevated)",
          }}
          aria-label="Pattern A auswählen"
        >
          <option value="">— Pattern A wählen —</option>
          {patterns.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Morph-Slider */}
      <div className="flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={amount}
          onChange={handleSliderChange}
          disabled={!canMorph}
          className="w-full"
          style={{
            accentColor: "var(--ss-accent-primary)",
            opacity: canMorph ? 1 : 0.5,
          }}
          aria-label="Morph-Menge"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={amount}
        />
        <div className="flex justify-between text-[9px]" style={{ color: "var(--ss-text-dim)" }}>
          <span>{patternA?.name ?? "—"}</span>
          <span style={{ color: "var(--ss-text-muted)" }}>↔</span>
          <span>{patternB?.name ?? "—"}</span>
        </div>
      </div>

      {/* Pattern B */}
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] uppercase tracking-wider w-6"
          style={{ color: amount >= 0.5 ? "var(--ss-accent-primary)" : "var(--ss-text-dim)" }}
        >
          B
        </span>
        <select
          value={patternBId ?? ""}
          onChange={handlePatternBSelect}
          className="flex-1 px-2 py-1 text-xs rounded border outline-none"
          style={{
            borderColor: "var(--ss-border)",
            color:       "var(--ss-text-primary)",
            background:  "var(--ss-bg-elevated)",
          }}
          aria-label="Pattern B auswählen"
        >
          <option value="">— Pattern B wählen —</option>
          {patterns.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Preview-Info */}
      {canMorph && (
        <div
          className="text-[10px] px-2 py-1.5 rounded border"
          style={{
            borderColor: "var(--ss-border)",
            color:       "var(--ss-text-muted)",
            background:  "rgba(255,255,255,0.02)",
          }}
        >
          Dominant: <strong style={{ color: "var(--ss-accent-primary)" }}>{dominantName}</strong>
          {" · "}Parts: {Math.max(patternA.parts.length, patternB.parts.length)}
        </div>
      )}

      {/* Quick Amounts */}
      <div className="flex gap-1">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <button
            key={v}
            onClick={() => { setAmount(v); if (!isActive) setActive(true); }}
            disabled={!canMorph}
            className="flex-1 px-1 py-1 text-[10px] rounded border transition-opacity hover:opacity-80"
            style={{
              borderColor: Math.abs(amount - v) < 0.001 ? "var(--ss-accent-primary)" : "var(--ss-border)",
              color: Math.abs(amount - v) < 0.001 ? "var(--ss-accent-primary)" : "var(--ss-text-muted)",
              background:  "transparent",
              opacity: canMorph ? 1 : 0.4,
            }}
            aria-label={`Morph auf ${Math.round(v * 100)}%`}
          >
            {Math.round(v * 100)}%
          </button>
        ))}
      </div>

      {/* Aktionen */}
      <div className="flex gap-2">
        <button
          onClick={handleApply}
          disabled={!canMorph}
          className="flex-1 px-3 py-1.5 text-xs font-semibold rounded transition-opacity hover:opacity-90"
          style={{
            background: canMorph ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
            color: canMorph ? "#000" : "var(--ss-text-dim)",
            cursor: canMorph ? "pointer" : "not-allowed",
            opacity: canMorph ? 1 : 0.5,
          }}
        >
          Apply Morph → neues Pattern
        </button>
        <button
          onClick={() => { resetMorph(); }}
          className="px-3 py-1.5 text-xs rounded border transition-opacity hover:opacity-75"
          style={{
            borderColor: "var(--ss-accent-danger)",
            color:       "var(--ss-accent-danger)",
            background:  "transparent",
          }}
          aria-label="Morph zurücksetzen"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export default PatternMorphPanel;
