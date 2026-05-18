/**
 * Synthstudio – LooperPanel (TASK-235 / v2.87)
 *
 * UI für den Live-Looper: 4 Pads horizontal. Jeder Pad zeigt:
 *  - Loop-Name (editable via Doppelklick — follow-up)
 *  - Status-Color via semantischen Tokens (bg-accent-danger / -success / etc.)
 *  - Progress-Ring (Conic-Gradient via SVG, current playhead)
 *
 * Interaktion:
 *  - Click             → triggerLoop (State-Machine-Step)
 *  - Long-Press > 500ms → eraseLoop
 *
 * Color-Code (siehe LOOP_STATE_TOKEN):
 *  empty       → bg-bg-elevated / text-text-dim
 *  arming      → bg-accent-secondary / Blink-Animation
 *  recording   → bg-accent-danger (rot)
 *  playing     → bg-accent-success (grün)
 *  overdubbing → bg-accent-secondary (orange/secondary)
 *  stopped     → bg-bg-panel
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useLooperStore } from "@/store/useLooperStore";
import { useLiveInputStore } from "@/store/useLiveInputStore";
import { AudioEngine } from "@/audio/AudioEngine";
import {
  LOOP_ERASE_LONG_PRESS_MS,
  MAX_LOOPS,
  type LoopState,
} from "@/audio/looperUtils";
// TASK-232-FOLLOWUP / v2.98: Live-Looping ist ein Pro-Feature.
import { requireProFeature, PRO_FEATURE_LIVE_LOOPING } from "@/utils/proFeatures";
import { ProLockBadge } from "@/components/License/ProLockBadge";

/** Spezielle Source-Channel-Konstante: Master-Bus. */
const SOURCE_MASTER = "master";

export interface LooperPanelProps {
  /** Optionaler Close-Handler. */
  onClose?: () => void;
}

/**
 * Mapping LoopState → CSS-Klasse + Hint-Text. Wir nutzen ausschließlich
 * semantische Token-Klassen (keine hardcoded Tailwind-Farben), damit Themes
 * korrekt durchschlagen.
 */
const LOOP_STATE_INFO: Record<LoopState, { bg: string; label: string; pulse: boolean }> = {
  empty:       { bg: "bg-bg-elevated",      label: "—",     pulse: false },
  arming:      { bg: "bg-accent-secondary", label: "ARM",   pulse: true  },
  recording:   { bg: "bg-accent-danger",    label: "REC",   pulse: true  },
  playing:     { bg: "bg-accent-success",   label: "PLAY",  pulse: false },
  overdubbing: { bg: "bg-accent-secondary", label: "DUB",   pulse: true  },
  stopped:     { bg: "bg-bg-panel",         label: "STOP",  pulse: false },
};

export function LooperPanel({ onClose }: LooperPanelProps) {
  const looper = useLooperStore();
  const liveInputs = useLiveInputStore();

  // Source-Channel-Optionen für die Picker (Master + alle Live-Inputs).
  const sources: Array<{ id: string; label: string }> = [
    { id: SOURCE_MASTER, label: "Master" },
    ...liveInputs.channels.map((c) => ({ id: c.id, label: c.name })),
  ];

  // Progress-Ring-Polling. AudioEngine.getLoopProgress liefert 0..1 lokal,
  // re-rendert je 100ms während ein Loop spielt — günstig.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const anyPlaying = looper.slots.some(
      (s) => s.state === "playing" || s.state === "overdubbing" || s.state === "recording" || s.state === "arming",
    );
    if (!anyPlaying) return;
    const id = window.setInterval(() => forceTick((t) => (t + 1) % 1000), 100);
    return () => window.clearInterval(id);
  }, [looper.slots]);

  return (
    <div
      className="flex flex-col gap-2 p-3 rounded border"
      style={{
        borderColor: "var(--ss-border)",
        background: "var(--ss-bg-panel)",
      }}
      data-testid="looper-panel"
    >
      <div className="flex items-center gap-2">
        <span
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "var(--ss-text-primary)" }}
        >
          Live-Looper
        </span>
        <ProLockBadge feature={PRO_FEATURE_LIVE_LOOPING} />
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--ss-text-dim)" }}
        >
          {looper.activeCount}/{MAX_LOOPS} aktiv
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto px-2 py-0.5 text-xs rounded text-text-muted hover:text-text-primary hover:opacity-70 flex items-center justify-center"
            aria-label="Close"
            title="Schließen (ESC)"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {looper.slots.map((slot, idx) => (
          <div key={slot.id} className="flex flex-col gap-1">
            <LooperPad
              index={idx}
              name={slot.name}
              state={slot.state}
              sourceChannelId={slot.sourceChannelId || SOURCE_MASTER}
            />
            <LoopChannelPicker
              index={idx}
              value={slot.sourceChannelId || SOURCE_MASTER}
              sources={sources}
              onChange={(channelId) =>
                looper.setSourceChannel(idx, channelId === SOURCE_MASTER ? "" : channelId)
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LoopChannelPicker ────────────────────────────────────────────────────────

interface LoopChannelPickerProps {
  index: number;
  value: string;
  sources: ReadonlyArray<{ id: string; label: string }>;
  onChange: (channelId: string) => void;
}

/**
 * Kleines Dropdown unter jedem Loop-Pad. Wählt den Source-Channel
 * ("Master" oder ein Live-Input-Channel). Persistenz erfolgt über
 * useLooperStore.setSourceChannel.
 */
function LoopChannelPicker({ index, value, sources, onChange }: LoopChannelPickerProps) {
  return (
    <select
      data-testid={`looper-channel-picker-${index}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[10px] rounded px-1 py-0.5 border bg-bg-elevated text-text-primary focus:outline-none focus:ring-1"
      style={{
        borderColor: "var(--ss-border)",
      }}
      title="Source-Channel für diesen Loop"
      aria-label={`Loop ${index + 1} Source-Channel`}
    >
      {sources.map((s) => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  );
}

// ─── LooperPad ────────────────────────────────────────────────────────────────

interface LooperPadProps {
  index: number;
  name: string;
  state: LoopState;
  sourceChannelId: string;
}

function LooperPad({ index, name, state, sourceChannelId }: LooperPadProps) {
  const info = LOOP_STATE_INFO[state];
  const longPressRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const handlePointerDown = useCallback(() => {
    longPressFiredRef.current = false;
    longPressRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      // v2.98 Pro-Gate: locked → silent no-op (Toast erscheint beim handlePointerUp-Pfad).
      if (!requireProFeature(PRO_FEATURE_LIVE_LOOPING)) return;
      AudioEngine.eraseLoop(index);
    }, LOOP_ERASE_LONG_PRESS_MS);
  }, [index]);

  const handlePointerUp = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    if (!longPressFiredRef.current) {
      // v2.98 Pro-Gate: ohne Pro / Trial Toast statt triggerLoop.
      if (!requireProFeature(PRO_FEATURE_LIVE_LOOPING)) return;
      AudioEngine.triggerLoop(index, sourceChannelId);
    }
  }, [index, sourceChannelId]);

  const handlePointerLeave = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  // Progress 0..1 (Polled — nur dann interessant wenn playing/overdubbing).
  const progress = state === "playing" || state === "overdubbing"
    ? AudioEngine.getLoopProgress(index)
    : 0;

  return (
    <button
      data-testid={`looper-pad-${index}`}
      data-loop-state={state}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      className={`relative aspect-square rounded-md border-2 px-2 py-1 text-xs font-semibold transition-transform active:scale-95 ${info.bg} ${info.pulse ? "animate-pulse" : ""}`}
      style={{
        borderColor: "var(--ss-border)",
        color: "var(--ss-text-primary)",
        userSelect: "none",
        touchAction: "manipulation",
      }}
      aria-label={`${name} — Status ${info.label}`}
      title={`${name} (Klick: Trigger, Long-Press: Erase)`}
    >
      <span className="block text-[10px] uppercase tracking-wider opacity-80">
        {info.label}
      </span>
      <span className="block truncate">{name}</span>

      {/* Progress-Ring: bei playing/overdubbing als horizontaler Balken am Boden */}
      {progress > 0 && (
        <span
          className="absolute left-0 bottom-0 h-0.5 bg-accent-primary"
          style={{ width: `${(progress * 100).toFixed(1)}%` }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

export default LooperPanel;
