/**
 * client/src/components/PatternCompare/PatternCompareModal.tsx (v3.91.0)
 *
 * Side-by-Side Pattern-Diff. Zwei Pattern-Dropdowns (A vs B), darunter pro
 * Part ein Step-Grid mit Color-Coding:
 *   - Grün  (accent-success) → Step nur in A aktiv (verloren bei B)
 *   - Rot   (accent-danger)  → Step nur in B aktiv (neu bei B)
 *   - Gelb  (accent-warning) → in beiden aktiv, aber Velocity unterscheidet sich
 *   - Neutral                → unverändert
 *
 * Verwendet ausschließlich semantische Tailwind-Tokens — keine hardcoded
 * Farben. ESC schließt das Modal. Click auf Backdrop ebenfalls.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { PatternData } from "@/audio/AudioEngine";
import {
  diffPatterns,
  summarizeDiff,
  classifyPartSteps,
  type PartDiff,
  type StepDiffKind,
} from "@/utils/patternDiff";

interface Props {
  isOpen: boolean;
  /** Alle Patterns aus dem DrumStore — werden in beide Dropdowns gespiegelt. */
  patterns: ReadonlyArray<PatternData>;
  /** Pattern-ID für Slot A beim Öffnen. Wenn null wird Slot A undefiniert
   *  bis der User wählt — UI rendert dann Hinweis. */
  initialAId: string | null;
  /** Optional: Pattern-ID für Slot B. Wenn null wird das zweite Pattern (oder
   *  None wenn nur 1 existiert) vorgewählt. */
  initialBId?: string | null;
  onClose: () => void;
}

function pickDefaultB(patterns: ReadonlyArray<PatternData>, aId: string | null): string | null {
  if (patterns.length === 0) return null;
  if (patterns.length === 1) return patterns[0].id;
  const idx = patterns.findIndex(p => p.id === aId);
  // Nimm den nächsten Eintrag, wrap-around.
  if (idx < 0) return patterns[0].id !== aId ? patterns[0].id : patterns[1].id;
  return patterns[(idx + 1) % patterns.length].id;
}

function bgClassFor(kind: StepDiffKind | undefined, active: boolean): string {
  if (kind === "added")           return "bg-accent-danger";     // nur in B (rot)
  if (kind === "removed")         return "bg-accent-success";    // nur in A (grün)
  if (kind === "changedVelocity") return "bg-accent-warning";    // Vel-Change (gelb)
  return active ? "bg-bg-elevated" : "bg-bg-base";
}

function tooltipFor(
  kind: StepDiffKind | undefined,
  stepIndex: number,
  activeA: boolean,
  activeB: boolean,
): string {
  if (kind === "added")           return `Step ${stepIndex + 1}: nur in B aktiv (added)`;
  if (kind === "removed")         return `Step ${stepIndex + 1}: nur in A aktiv (removed)`;
  if (kind === "changedVelocity") return `Step ${stepIndex + 1}: Velocity geändert`;
  if (activeA && activeB)         return `Step ${stepIndex + 1}: unverändert`;
  return `Step ${stepIndex + 1}: leer`;
}

export function PatternCompareModal({
  isOpen,
  patterns,
  initialAId,
  initialBId = null,
  onClose,
}: Props) {
  const [aId, setAId] = useState<string | null>(initialAId);
  const [bId, setBId] = useState<string | null>(
    initialBId ?? pickDefaultB(patterns, initialAId),
  );

  // Wenn die Modal-Props sich beim Re-Open ändern, refreshe die Picker.
  useEffect(() => {
    if (!isOpen) return;
    setAId(initialAId);
    setBId(initialBId ?? pickDefaultB(patterns, initialAId));
  }, [isOpen, initialAId, initialBId, patterns]);

  // ESC schließt das Modal.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const patternA = useMemo(
    () => patterns.find(p => p.id === aId) ?? null,
    [patterns, aId],
  );
  const patternB = useMemo(
    () => patterns.find(p => p.id === bId) ?? null,
    [patterns, bId],
  );

  const diff = useMemo(() => {
    if (!patternA || !patternB) return null;
    return diffPatterns(patternA, patternB);
  }, [patternA, patternB]);

  if (!isOpen) return null;

  const summary = diff ? summarizeDiff(diff) : null;
  const bpmDeltaStr =
    diff && diff.bpmDelta !== null
      ? (diff.bpmDelta > 0 ? `+${diff.bpmDelta}` : String(diff.bpmDelta))
      : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      data-testid="pattern-compare-overlay"
      role="dialog"
      aria-label="Pattern Compare"
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-border-color flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm font-bold text-text-primary mb-2">
              Pattern Compare
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Picker A */}
              <label className="flex items-center gap-2 text-xs">
                <span className="text-text-muted w-4 font-mono">A</span>
                <select
                  value={aId ?? ""}
                  onChange={(e) => setAId(e.target.value || null)}
                  className="flex-1 bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-primary"
                  data-testid="pattern-compare-select-a"
                >
                  <option value="">— wählen —</option>
                  {patterns.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              {/* Picker B */}
              <label className="flex items-center gap-2 text-xs">
                <span className="text-text-muted w-4 font-mono">B</span>
                <select
                  value={bId ?? ""}
                  onChange={(e) => setBId(e.target.value || null)}
                  className="flex-1 bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-primary"
                  data-testid="pattern-compare-select-b"
                >
                  <option value="">— wählen —</option>
                  {patterns.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Header-Summary */}
            {diff && summary && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted font-mono">
                <span>
                  BPM A: <span className="text-text-primary">{diff.bpmA ?? "—"}</span>
                  {" → "}
                  B: <span className="text-text-primary">{diff.bpmB ?? "—"}</span>
                  {" "}
                  <span className={
                    diff.bpmDelta !== null && diff.bpmDelta !== 0
                      ? "text-accent-warning"
                      : "text-text-dim"
                  }>({bpmDeltaStr})</span>
                </span>
                <span>
                  Steps: <span className="text-text-primary">{diff.stepCountA}</span>
                  {" → "}
                  <span className="text-text-primary">{diff.stepCountB}</span>
                  {diff.stepCountDelta !== 0 && (
                    <span className="text-accent-warning">
                      {" "}({diff.stepCountDelta > 0 ? "+" : ""}{diff.stepCountDelta})
                    </span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-accent-success" />
                  <span>removed: {summary.removed}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-accent-danger" />
                  <span>added: {summary.added}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-accent-warning" />
                  <span>vel-change: {summary.changedVelocity}</span>
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary text-lg leading-none px-2"
            title="Schließen (ESC)"
            aria-label="Modal schließen"
            data-testid="pattern-compare-close"
          >
            ×
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4">
          {!patternA || !patternB ? (
            <div className="text-center text-text-muted text-xs py-12">
              Bitte zwei Patterns für den Vergleich auswählen.
            </div>
          ) : aId === bId ? (
            <div className="text-center text-text-muted text-xs py-12">
              A und B sind dasselbe Pattern — bitte unterschiedliche wählen.
            </div>
          ) : diff ? (
            <ComparisonGrid
              patternA={patternA}
              patternB={patternB}
              partDiffs={diff.partDiffs}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Grid-Rendering ─────────────────────────────────────────────────────────

interface GridProps {
  patternA: PatternData;
  patternB: PatternData;
  partDiffs: ReadonlyArray<PartDiff>;
}

function ComparisonGrid({ patternA, patternB, partDiffs }: GridProps) {
  // Anzeige-StepCount = Maximum beider Patterns. Steps die in einem Pattern
  // gar nicht existieren werden als leer dargestellt.
  const stepCount = Math.max(patternA.stepCount, patternB.stepCount);
  const aPartById = useMemo(() => {
    const m = new Map(patternA.parts.map(p => [p.id, p]));
    return m;
  }, [patternA]);
  const bPartById = useMemo(() => {
    const m = new Map(patternB.parts.map(p => [p.id, p]));
    return m;
  }, [patternB]);

  return (
    <div className="space-y-2">
      {/* Step-Number-Header */}
      <div className="grid items-center gap-px ml-32" style={{ gridTemplateColumns: `repeat(${stepCount}, minmax(0,1fr))` }}>
        {Array.from({ length: stepCount }, (_, i) => (
          <div
            key={i}
            className={`text-[9px] text-center text-text-dim font-mono ${i % 4 === 0 ? "text-text-muted" : ""}`}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {partDiffs.map((pd) => {
        const aPart = aPartById.get(pd.partId);
        const bPart = bPartById.get(pd.partId);
        const kinds = classifyPartSteps(pd, stepCount);

        return (
          <div key={pd.partId} className="flex items-center gap-2">
            <div className="w-32 text-xs text-text-primary truncate flex items-center gap-1.5"
                 title={`${pd.partName}${pd.presence ? ` (${pd.presence})` : ""}`}>
              {pd.presence === "removed" && (
                <span className="text-[9px] text-accent-success" title="Part nur in A">A</span>
              )}
              {pd.presence === "added" && (
                <span className="text-[9px] text-accent-danger" title="Part nur in B">B</span>
              )}
              <span className="truncate">{pd.partName}</span>
            </div>
            <div
              className="flex-1 grid gap-px"
              style={{ gridTemplateColumns: `repeat(${stepCount}, minmax(0,1fr))` }}
              data-testid={`pattern-compare-part-${pd.partId}`}
            >
              {Array.from({ length: stepCount }, (_, i) => {
                const sa = aPart?.steps[i];
                const sb = bPart?.steps[i];
                const aOn = !!sa?.active;
                const bOn = !!sb?.active;
                const kind = kinds[i];
                const bg = bgClassFor(kind, aOn || bOn);
                const borderHl = i % 4 === 0 ? "border-l border-border-color" : "";
                return (
                  <div
                    key={i}
                    className={`h-5 ${bg} ${borderHl} rounded-[2px]`}
                    title={tooltipFor(kind, i, aOn, bOn)}
                    data-testid={`pattern-compare-step-${pd.partId}-${i}`}
                    data-kind={kind ?? "unchanged"}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {partDiffs.length === 0 && (
        <div className="text-center text-text-muted text-xs py-8">
          Keine Parts in den verglichenen Patterns.
        </div>
      )}
    </div>
  );
}
