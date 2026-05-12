/**
 * Synthstudio – NoteRepeatPanel
 *
 * UI für MPC-Style Note-Repeat:
 *  - Toggle (ON/OFF)
 *  - Rate-Auswahl (1/4, 1/8, 1/16, 1/32 + Triplets)
 *  - Optionale Live-Pad-Reihe für direktes Spielen
 *
 * Pad-Buttons reagieren auf Mouse/Touch-Down + Up. Während des Drucks
 * wird `onPadTrigger` im konfigurierten Rate retriggert (via useNoteRepeat).
 */
import { useCallback } from "react";
import { X } from "lucide-react";
import { useNoteRepeatStore } from "@/store/useNoteRepeatStore";
import { useNoteRepeat } from "@/hooks/useNoteRepeat";
import { NOTE_REPEAT_RATES, type NoteRepeatRate } from "@/utils/noteRepeat";

export interface NoteRepeatPad {
  id: string;
  name: string;
  /** Optional: Farbcode für visuelles Feedback (Hex / CSS-Color). */
  color?: string;
}

export interface NoteRepeatPanelProps {
  /** Drum-Pads die als Live-Buttons gerendert werden. Leer = keine Pad-Bar. */
  pads?: NoteRepeatPad[];
  /** BPM für Repeat-Intervall-Berechnung. */
  bpm: number;
  /** Wird bei jedem Trigger (manuell oder repeat) aufgerufen. */
  onPadTrigger?: (padId: string) => void;
  /** Optionaler Close-Handler (für Modal-Variante). */
  onClose?: () => void;
  /** Kompakter Modus ohne Live-Pads. */
  compact?: boolean;
}

export function NoteRepeatPanel({
  pads = [],
  bpm,
  onPadTrigger,
  onClose,
  compact = false,
}: NoteRepeatPanelProps) {
  const { enabled, rate, toggle, setRate } = useNoteRepeatStore();

  const triggerNoop = useCallback(
    (padId: string) => onPadTrigger?.(padId),
    [onPadTrigger]
  );
  const { padDown, padUp } = useNoteRepeat({ trigger: triggerNoop, bpm });

  return (
    <div
      className="flex flex-col gap-2 p-3 rounded border"
      style={{
        borderColor: enabled ? "var(--ss-accent-primary)" : "var(--ss-border)",
        background:  "var(--ss-bg-panel)",
      }}
    >
      {/* Header: Toggle + Close */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          className="px-2 py-1 text-xs font-bold rounded border transition-opacity hover:opacity-80"
          style={{
            borderColor: enabled ? "var(--ss-accent-primary)" : "var(--ss-border)",
            color:       enabled ? "var(--ss-accent-primary)" : "var(--ss-text-muted)",
            background:  enabled ? "rgba(255,255,255,0.04)" : "transparent",
          }}
          aria-pressed={enabled}
          aria-label="Note Repeat umschalten"
        >
          {enabled ? "🔁 ON" : "OFF"}
        </button>
        <span
          className="text-xs uppercase tracking-widest"
          style={{ color: "var(--ss-text-dim)" }}
        >
          Note Repeat
        </span>
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: "var(--ss-text-dim)" }}
          title={`Bei ${bpm} BPM`}
        >
          {bpm} BPM
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs rounded text-text-muted hover:text-text-primary hover:opacity-70 flex items-center justify-center"
            aria-label="Close"
            title="Schließen (ESC)"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Rate-Auswahl */}
      <div className="flex flex-wrap gap-1">
        {NOTE_REPEAT_RATES.map((r) => {
          const active = r.rate === rate;
          return (
            <button
              key={r.rate}
              onClick={() => setRate(r.rate as NoteRepeatRate)}
              className="px-2 py-1 text-xs font-mono rounded border transition-opacity hover:opacity-85"
              style={{
                borderColor: active ? "var(--ss-accent-primary)" : "var(--ss-border)",
                color:       active ? "var(--ss-accent-primary)" : "var(--ss-text-muted)",
                background:  active ? "rgba(255,255,255,0.04)" : "transparent",
                fontWeight:  active ? 600 : 400,
              }}
              aria-pressed={active}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {/* Live-Pads (optional) */}
      {!compact && pads.length > 0 && (
        <div className="grid grid-cols-4 gap-1 mt-1 sm:grid-cols-6 lg:grid-cols-9">
          {pads.map((pad) => (
            <button
              key={pad.id}
              onMouseDown={() => padDown(pad.id)}
              onMouseUp={() => padUp(pad.id)}
              onMouseLeave={() => padUp(pad.id)}
              onTouchStart={(e) => { e.preventDefault(); padDown(pad.id); }}
              onTouchEnd={(e) => { e.preventDefault(); padUp(pad.id); }}
              className="px-2 py-2 text-[10px] font-semibold rounded border transition-transform active:scale-95"
              style={{
                borderColor: pad.color ?? "var(--ss-border)",
                color:       "var(--ss-text-primary)",
                background:  pad.color ? `${pad.color}33` : "var(--ss-bg-elevated)",
                userSelect:  "none",
                touchAction: "manipulation",
              }}
              aria-label={`Live-Pad ${pad.name}`}
            >
              {pad.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default NoteRepeatPanel;
