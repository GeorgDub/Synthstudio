/**
 * PerformancePadGrid — 4×4 Pad-Grid für OmniTribe Performance-Modul (ID 10).
 *
 * Pad-Interaktionen:
 *   - Click           → Pad-Press     → sendPerformancePadPress(padId)
 *   - Long-Press      → Loop-Isolate  → sendPerformanceLoopIsolate(padId)
 *   - Right-Click     → Loop-Isolate  → sendPerformanceLoopIsolate(padId)
 *   - Mute-Button pro Pad → toggle    → sendPerformanceJamMute(partId=padId, on)
 *
 * Color-Coding: Pads sind durchnummeriert; jedes Pad bekommt eine Hue aus
 * dem HSL-Spektrum (16 Steps) als visuelle Differenzierung.
 *
 * Active-Highlight: zuletzt gedrucktes Pad bekommt Ring (200ms decay).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  sendPerformancePadPress,
  sendPerformanceLoopIsolate,
  sendPerformanceJamMute,
  OMNITRIBE_PERFORMANCE,
} from "../../utils/omniTribeWiring";

const LONG_PRESS_MS = 500;
const ACTIVE_HIGHLIGHT_MS = 200;
const GRID_COLS = 4;
const GRID_ROWS = 4;

export interface PerformancePadGridProps {
  /** Optional: false zeigt Disconnected-State (Pads disabled). */
  connected?: boolean;
}

interface PadState {
  /** Mute-Status pro Pad (visuell + outbound). */
  muted: boolean;
  /** Active-Highlight (clear timer). */
  highlightUntil: number;
}

const DEFAULT_PAD_STATE: PadState = { muted: false, highlightUntil: 0 };

export function PerformancePadGrid({
  connected = true,
}: PerformancePadGridProps): ReactElement {
  const [pads, setPads] = useState<PadState[]>(
    () => Array.from({ length: OMNITRIBE_PERFORMANCE.PAD_COUNT }, () => ({ ...DEFAULT_PAD_STATE })),
  );

  /** Long-Press-Detection. */
  const pressTimerRef = useRef<Map<number, number>>(new Map());
  const longPressFiredRef = useRef<Set<number>>(new Set());

  // ── Action: Pad-Press ──────────────────────────────────────────────────
  const handlePadPress = useCallback((padId: number) => {
    sendPerformancePadPress(padId);
    setPads((prev) => prev.map((p, i) =>
      i === padId
        ? { ...p, highlightUntil: Date.now() + ACTIVE_HIGHLIGHT_MS }
        : p,
    ));
  }, []);

  // ── Action: Loop-Isolate ───────────────────────────────────────────────
  const handleLoopIsolate = useCallback((padId: number) => {
    sendPerformanceLoopIsolate(padId);
    setPads((prev) => prev.map((p, i) =>
      i === padId
        ? { ...p, highlightUntil: Date.now() + ACTIVE_HIGHLIGHT_MS * 2 }
        : p,
    ));
  }, []);

  // ── Action: Jam-Mute Toggle ────────────────────────────────────────────
  const handleMuteToggle = useCallback((padId: number) => {
    setPads((prev) => {
      const next = prev.slice();
      const cur = next[padId] ?? DEFAULT_PAD_STATE;
      const newMuted = !cur.muted;
      next[padId] = { ...cur, muted: newMuted };
      sendPerformanceJamMute(padId, newMuted);
      return next;
    });
  }, []);

  // ── PointerDown: Start Long-Press-Timer ────────────────────────────────
  // v3.19: PointerEvents statt MouseEvents — funktioniert auf Touch+Stift+Maus.
  // pointerType 'mouse' → button===0 prüfen, 'touch'/'pen' → button ist 0 oder -1.
  const handlePointerDown = useCallback((padId: number, e: React.PointerEvent) => {
    // Touch + Pen melden button=0; Mouse muss main-button sein.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longPressFiredRef.current.delete(padId);
    const timer = window.setTimeout(() => {
      longPressFiredRef.current.add(padId);
      handleLoopIsolate(padId);
    }, LONG_PRESS_MS);
    pressTimerRef.current.set(padId, timer);
  }, [handleLoopIsolate]);

  // ── PointerUp: Cancel Long-Press oder triggere Press ───────────────────
  const handlePointerUp = useCallback((padId: number, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const timer = pressTimerRef.current.get(padId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      pressTimerRef.current.delete(padId);
    }
    if (!longPressFiredRef.current.has(padId)) {
      handlePadPress(padId);
    }
    longPressFiredRef.current.delete(padId);
  }, [handlePadPress]);

  // ── PointerLeave/Cancel: Cancel pending long-press ────────────────────
  // PointerCancel feuert bei Touch-Scroll-Hijack — Long-Press abbrechen.
  const handlePointerCancel = useCallback((padId: number) => {
    const timer = pressTimerRef.current.get(padId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      pressTimerRef.current.delete(padId);
    }
    longPressFiredRef.current.delete(padId);
  }, []);

  // ── Right-Click → Loop-Isolate ────────────────────────────────────────
  const handleContextMenu = useCallback((padId: number, e: React.MouseEvent) => {
    e.preventDefault();
    handleLoopIsolate(padId);
  }, [handleLoopIsolate]);

  // ── Cleanup pending Long-Press-Timers on unmount ──────────────────────
  useEffect(() => {
    const timers = pressTimerRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

  // ── Tick: Active-Highlight-Decay (RAF-loop limited to active highlights)
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const anyActive = pads.some((p) => p.highlightUntil > Date.now());
    if (!anyActive) return;
    const id = window.setInterval(() => setNowTick((t) => t + 1), 50);
    return () => window.clearInterval(id);
  }, [pads]);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4"
      data-testid="performance-pad-grid"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">
          Performance Pads
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-text-dim">
          Click · Long-Press = Loop-Isolate · Right-Click = Loop-Isolate
          {!connected && " · Disconnected"}
        </span>
      </div>

      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
        }}
        role="grid"
        aria-rowcount={GRID_ROWS}
        aria-colcount={GRID_COLS}
      >
        {pads.map((pad, padId) => {
          const isActive = pad.highlightUntil > Date.now();
          const hue = Math.round((padId / OMNITRIBE_PERFORMANCE.PAD_COUNT) * 360);
          const row = Math.floor(padId / GRID_COLS) + 1;
          const col = (padId % GRID_COLS) + 1;
          return (
            <div
              key={padId}
              role="gridcell"
              aria-rowindex={row}
              aria-colindex={col}
              className="relative"
            >
              <button
                type="button"
                data-testid={`performance-pad-${padId}`}
                aria-label={`Performance pad ${padId + 1}${pad.muted ? " (muted)" : ""}`}
                onPointerDown={(e) => handlePointerDown(padId, e)}
                onPointerUp={(e) => handlePointerUp(padId, e)}
                onPointerLeave={() => handlePointerCancel(padId)}
                onPointerCancel={() => handlePointerCancel(padId)}
                onContextMenu={(e) => handleContextMenu(padId, e)}
                style={{
                  backgroundColor: `hsl(${hue}, 50%, 22%)`,
                  // touch-action:none verhindert dass der Browser zwischen Scroll
                  // und Long-Press disambiguiert (sonst feuert PointerCancel zu früh).
                  touchAction: "none",
                }}
                className={[
                  "w-full aspect-square rounded-lg border-2 font-bold text-sm transition-all duration-100",
                  "text-text-primary",
                  isActive
                    ? "border-accent-primary ring-2 ring-accent-primary/50 scale-95"
                    : "border-border-color hover:border-accent-primary/60",
                  pad.muted ? "opacity-30" : "opacity-100",
                ].join(" ")}
              >
                {padId + 1}
              </button>
              <button
                type="button"
                data-testid={`performance-pad-mute-${padId}`}
                onClick={(e) => { e.stopPropagation(); handleMuteToggle(padId); }}
                aria-label={`Toggle mute on part ${padId + 1}`}
                aria-pressed={pad.muted}
                title="Jam-Mute (Part toggle)"
                className={[
                  "absolute top-1 right-1 w-5 h-5 rounded text-[9px] font-bold border",
                  pad.muted
                    ? "bg-accent-danger/30 border-accent-danger text-accent-danger"
                    : "bg-bg-elevated/80 border-border-color text-text-dim hover:text-text-muted",
                ].join(" ")}
              >
                M
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PerformancePadGrid;
