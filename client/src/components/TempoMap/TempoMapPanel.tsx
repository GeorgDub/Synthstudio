/**
 * Synthstudio – TempoMapPanel (v3.95.0)
 *
 * Timeline-View fuer Tempo-Map / BPM-Automation.
 *
 * Funktionen:
 *  - X-Achse: Bar-Index (0..maxBar)
 *  - Y-Achse: BPM (MIN_BPM..MAX_BPM)
 *  - Click in leeren Bereich → addEvent
 *  - Drag an einem Event → atBar / bpm aendern (visuell, store-side via setEventBpm)
 *  - Double-click auf Event → ramp-Flag togglen
 *  - Right-click auf Event → removeEvent
 *  - Liste aller Events darunter mit Inline-Editing + Loeschen
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X, Activity } from "lucide-react";
import {
  useTempoMapStore,
  MAX_TEMPO_EVENTS,
  MIN_BPM,
  MAX_BPM,
  type TempoEvent,
} from "@/store/useTempoMapStore";

export interface TempoMapPanelProps {
  /** Aktuelle Position in Bars (vom Sequencer) zum Anzeigen des Playheads. */
  currentBar?: number;
  /** Max anzuzeigende Bar-Spanne; defaultet auf max(events.atBar) + 16. */
  maxBar?: number;
  /**
   * v3.104.0: Steps pro Bar des aktuellen Patterns (default 16).
   * Wird benoetigt fuer korrekte X-Achsen-Beschriftung bei 32-step
   * (8th-note doubled) oder 12-step (triplet) Patterns.
   */
  stepsPerBar?: number;
  onClose?: () => void;
}

const PANEL_HEIGHT = 220;
const PANEL_PADDING_X = 32;
const PANEL_PADDING_Y = 16;

export function TempoMapPanel({ currentBar = 0, maxBar, stepsPerBar = 16, onClose }: TempoMapPanelProps) {
  const { events, addEvent, removeEvent, setEventBpm, setEventRamp, clear } = useTempoMapStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const effectiveStepsPerBar = stepsPerBar > 0 ? stepsPerBar : 16;

  // Default-Span: 64 Bars oder etwas mehr als der letzte Event
  const effectiveMaxBar = useMemo(() => {
    if (typeof maxBar === "number") return Math.max(maxBar, 16);
    const lastEvent = events.length > 0 ? events[events.length - 1].atBar : 0;
    return Math.max(64, Math.ceil(lastEvent / 16) * 16 + 16);
  }, [events, maxBar]);

  const barToX = useCallback(
    (bar: number, width: number) => {
      const usable = width - PANEL_PADDING_X * 2;
      return PANEL_PADDING_X + (bar / effectiveMaxBar) * usable;
    },
    [effectiveMaxBar]
  );

  const bpmToY = useCallback((bpm: number) => {
    const usable = PANEL_HEIGHT - PANEL_PADDING_Y * 2;
    const norm = (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM);
    return PANEL_HEIGHT - PANEL_PADDING_Y - norm * usable;
  }, []);

  const xToBar = useCallback(
    (x: number, width: number) => {
      const usable = width - PANEL_PADDING_X * 2;
      const norm = (x - PANEL_PADDING_X) / usable;
      return Math.round(Math.max(0, Math.min(1, norm)) * effectiveMaxBar);
    },
    [effectiveMaxBar]
  );

  const yToBpm = useCallback((y: number) => {
    const usable = PANEL_HEIGHT - PANEL_PADDING_Y * 2;
    const norm = (PANEL_HEIGHT - PANEL_PADDING_Y - y) / usable;
    return Math.round(MIN_BPM + Math.max(0, Math.min(1, norm)) * (MAX_BPM - MIN_BPM));
  }, []);

  const [dragId, setDragId] = useState<number | null>(null);

  const handleSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      if (events.length >= MAX_TEMPO_EVENTS) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const bar = xToBar(x, rect.width);
      const bpm = yToBpm(y);
      // Vermeide doppeltes Adden direkt auf existierendes Event
      if (events.some((ev) => ev.atBar === bar)) return;
      addEvent(bar, bpm, false);
    },
    [addEvent, events, xToBar, yToBpm]
  );

  const handleEventMouseDown = useCallback(
    (e: React.MouseEvent, atBar: number) => {
      e.stopPropagation();
      setDragId(atBar);
    },
    []
  );

  const handleSurfaceMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragId === null) return;
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const bpm = yToBpm(y);
      setEventBpm(dragId, bpm);
    },
    [dragId, setEventBpm, yToBpm]
  );

  const handleSurfaceMouseUp = useCallback(() => {
    setDragId(null);
  }, []);

  const handleEventDoubleClick = useCallback(
    (e: React.MouseEvent, ev: TempoEvent) => {
      e.stopPropagation();
      setEventRamp(ev.atBar, !ev.ramp);
    },
    [setEventRamp]
  );

  const handleEventContextMenu = useCallback(
    (e: React.MouseEvent, atBar: number) => {
      e.preventDefault();
      e.stopPropagation();
      removeEvent(atBar);
    },
    [removeEvent]
  );

  // Width fuer SVG: nutzen wir 800px wenn kein Container-Ref
  const width = containerRef.current?.clientWidth ?? 800;

  // Vorbereitete Polyline: Punkte zwischen events (mit ramp / hold)
  const polyPoints = useMemo(() => {
    if (events.length === 0) return "";
    const pts: string[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const x = barToX(e.atBar, width);
      const y = bpmToY(e.bpm);
      const next = events[i + 1];
      if (i === 0) pts.push(`${x},${y}`);
      else pts.push(`${x},${y}`);
      if (next) {
        if (next.ramp) {
          // ramp → diagonal direkt zu next (next-Point wird im naechsten Iteration angefuegt)
          continue;
        } else {
          // hold-then-step: horizontal bis next.atBar, dann vertikal zur next.bpm
          const xNext = barToX(next.atBar, width);
          pts.push(`${xNext},${y}`);
        }
      }
    }
    return pts.join(" ");
  }, [events, barToX, bpmToY, width]);

  const playheadX = barToX(currentBar, width);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded-lg p-4 shadow-lg"
      data-testid="tempo-map-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Activity size={14} className="text-accent-primary" />
          Tempo-Map (BPM-Automation)
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => clear()}
            className="text-xs px-2 py-1 rounded bg-bg-elevated hover:bg-accent-danger/20 text-text-muted hover:text-accent-danger transition-colors flex items-center gap-1"
            title="Alle Tempo-Events loeschen"
          >
            <Trash2 size={12} /> Clear
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-text-primary"
              aria-label="Schliessen"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-text-dim mb-2">
        Klick = Event hinzufuegen, Drag = BPM aendern, Doppelklick = Ramp togglen,
        Rechtsklick = Entfernen. Max {MAX_TEMPO_EVENTS} Events ({events.length} aktiv).
        {effectiveStepsPerBar !== 16 && (
          <> · <span className="text-text-muted">Pattern: {effectiveStepsPerBar} steps/bar</span></>
        )}
      </div>

      <div
        ref={containerRef}
        onClick={handleSurfaceClick}
        onMouseMove={handleSurfaceMouseMove}
        onMouseUp={handleSurfaceMouseUp}
        onMouseLeave={handleSurfaceMouseUp}
        className="relative bg-bg-base rounded border border-border-subtle cursor-crosshair select-none"
        style={{ height: PANEL_HEIGHT }}
        data-testid="tempo-map-surface"
      >
        <svg
          width="100%"
          height={PANEL_HEIGHT}
          className="absolute inset-0 pointer-events-none"
        >
          {/* Y-Axis Gridlines (100, 120, 140, 160, 180 BPM) */}
          {[60, 100, 120, 140, 160, 200, 240].map((bpm) => (
            <g key={`grid-${bpm}`}>
              <line
                x1={PANEL_PADDING_X}
                x2={width - PANEL_PADDING_X}
                y1={bpmToY(bpm)}
                y2={bpmToY(bpm)}
                stroke="var(--ss-border-subtle)"
                strokeDasharray="2 2"
              />
              <text
                x={4}
                y={bpmToY(bpm) + 3}
                fontSize={9}
                fill="var(--ss-text-dim)"
              >
                {bpm}
              </text>
            </g>
          ))}

          {/* X-Axis Bar markers (every 8 bars) */}
          {Array.from({ length: Math.floor(effectiveMaxBar / 8) + 1 }, (_, i) => i * 8).map(
            (bar) => (
              <g key={`bar-${bar}`}>
                <line
                  x1={barToX(bar, width)}
                  x2={barToX(bar, width)}
                  y1={PANEL_PADDING_Y}
                  y2={PANEL_HEIGHT - PANEL_PADDING_Y}
                  stroke="var(--ss-border-subtle)"
                  strokeDasharray="1 3"
                />
                <text
                  x={barToX(bar, width)}
                  y={PANEL_HEIGHT - 2}
                  fontSize={9}
                  fill="var(--ss-text-dim)"
                  textAnchor="middle"
                >
                  {bar}
                </text>
              </g>
            )
          )}

          {/* Tempo-Linie */}
          {polyPoints && (
            <polyline
              points={polyPoints}
              fill="none"
              stroke="var(--ss-accent-primary)"
              strokeWidth={2}
            />
          )}

          {/* Playhead */}
          {currentBar > 0 && (
            <line
              x1={playheadX}
              x2={playheadX}
              y1={PANEL_PADDING_Y}
              y2={PANEL_HEIGHT - PANEL_PADDING_Y}
              stroke="var(--ss-accent-success)"
              strokeWidth={1.5}
              opacity={0.7}
            />
          )}
        </svg>

        {/* Event-Handles */}
        {events.map((ev) => {
          const cx = barToX(ev.atBar, width);
          const cy = bpmToY(ev.bpm);
          return (
            <div
              key={`ev-${ev.atBar}`}
              onMouseDown={(e) => handleEventMouseDown(e, ev.atBar)}
              onDoubleClick={(e) => handleEventDoubleClick(e, ev)}
              onContextMenu={(e) => handleEventContextMenu(e, ev.atBar)}
              className="absolute rounded-full border-2 cursor-move"
              style={{
                left: cx - 7,
                top: cy - 7,
                width: 14,
                height: 14,
                background: ev.ramp ? "var(--ss-accent-secondary)" : "var(--ss-accent-primary)",
                borderColor: "var(--ss-bg-base)",
              }}
              title={`Bar ${ev.atBar}: ${ev.bpm} BPM${ev.ramp ? " (ramp)" : ""}`}
              data-testid={`tempo-event-${ev.atBar}`}
            />
          );
        })}

        {events.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-dim text-xs pointer-events-none">
            Klick irgendwo, um den ersten Tempo-Event zu setzen
          </div>
        )}
      </div>

      {/* Event-Liste */}
      {events.length > 0 && (
        <div className="mt-3 max-h-32 overflow-y-auto text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-text-dim text-left">
                <th className="py-1 pr-2 font-normal">Bar</th>
                <th className="py-1 pr-2 font-normal">BPM</th>
                <th className="py-1 pr-2 font-normal">Ramp</th>
                <th className="py-1 font-normal w-8" />
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={`row-${ev.atBar}`} className="border-t border-border-subtle">
                  <td className="py-1 pr-2 text-text-primary font-mono">{ev.atBar}</td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={MIN_BPM}
                      max={MAX_BPM}
                      value={ev.bpm}
                      onChange={(e) => setEventBpm(ev.atBar, Number(e.target.value))}
                      className="w-16 bg-bg-base border border-border-subtle rounded px-1 py-0.5 text-text-primary"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <button
                      onClick={() => setEventRamp(ev.atBar, !ev.ramp)}
                      className={`px-2 py-0.5 rounded text-xs ${
                        ev.ramp
                          ? "bg-accent-secondary text-bg-base"
                          : "bg-bg-elevated text-text-muted"
                      }`}
                    >
                      {ev.ramp ? "ramp" : "hard"}
                    </button>
                  </td>
                  <td className="py-1">
                    <button
                      onClick={() => removeEvent(ev.atBar)}
                      className="p-1 rounded hover:bg-accent-danger/20 text-text-muted hover:text-accent-danger"
                      aria-label="Event loeschen"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {events.length < MAX_TEMPO_EVENTS && (
        <button
          onClick={() => {
            // Append: an die naechste freie Bar (letzte+16 oder 0)
            const lastBar = events.length > 0 ? events[events.length - 1].atBar : -16;
            addEvent(lastBar + 16, events.length > 0 ? events[events.length - 1].bpm : 120, false);
          }}
          className="mt-2 text-xs px-2 py-1 rounded bg-bg-elevated hover:bg-accent-primary/20 text-text-muted hover:text-accent-primary flex items-center gap-1"
        >
          <Plus size={12} /> Event anfuegen
        </button>
      )}
    </div>
  );
}

export default TempoMapPanel;
