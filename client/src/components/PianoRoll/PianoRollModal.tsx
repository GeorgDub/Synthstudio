/**
 * Synthstudio – PianoRollModal.tsx
 *
 * Piano Roll / Melodic Step Sequencer (Phase 2, v1.9).
 * Grid: 16 Steps × 24 Noten (B4 oben → C3 unten = MIDI 71–48).
 * Features:
 *   - Click/Drag zum Zeichnen, Rechtsklick zum Löschen
 *   - Shift+Click öffnet Velocity-Popup
 *   - Piano-Tasten links mit Vorschau-Sound via WebAudio
 * Styling: Tailwind + CSS Custom Properties (--ss-*)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMelodicPartStore } from "../../store/useMelodicPartStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface PianoRollModalProps {
  partId: string;
  partName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface VelocityPopup {
  show: boolean;
  stepIdx: number;
  x: number;
  y: number;
}

interface DragState {
  active: boolean;
  mode: "draw" | "erase";
  lastNote: number;
  lastStep: number;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const MIDI_MIN = 48;  // C3
const MIDI_MAX = 71;  // B4
const STEP_COUNT = 16;
const ROW_HEIGHT = 22;   // px
const KEY_WIDTH  = 68;   // px
const CELL_MIN_W = 36;   // px

// Noten von oben (B4 = 71) nach unten (C3 = 48)
const NOTES: readonly number[] = Array.from(
  { length: MIDI_MAX - MIDI_MIN + 1 },
  (_, i) => MIDI_MAX - i,
);

function midiToLabel(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function isBlack(note: number): boolean {
  return [1, 3, 6, 8, 10].includes(note % 12);
}

// ─── Audio-Vorschau ───────────────────────────────────────────────────────────

let _previewCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (!_previewCtx || _previewCtx.state === "closed") {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      _previewCtx = new Ctor();
    }
    if (_previewCtx.state === "suspended") void _previewCtx.resume();
    return _previewCtx;
  } catch {
    return null;
  }
}

function playPreview(note: number): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.28);
  } catch {
    // AudioContext nicht verfügbar
  }
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function PianoRollModal({ partId, partName, isOpen, onClose }: PianoRollModalProps) {
  const { patterns, initPart, setNote, toggleStep, setVelocity, clearPart } =
    useMelodicPartStore();

  const [velocityPopup, setVelocityPopup] = useState<VelocityPopup>({
    show:    false,
    stepIdx: -1,
    x:       0,
    y:       0,
  });

  // Ref-basiertes Drag-Tracking (kein Re-Render während Drag)
  const drag = useRef<DragState>({
    active:   false,
    mode:     "draw",
    lastNote: -1,
    lastStep: -1,
  });

  // Part initialisieren (idempotent)
  useEffect(() => {
    if (isOpen) initPart(partId);
  }, [isOpen, partId, initPart]);

  // Drag-Ende auf Dokument-Ebene
  useEffect(() => {
    const up = () => { drag.current.active = false; };
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // Escape → schließen
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // ── Interaktions-Handler ──────────────────────────────────────────────────

  const handleCellMouseDown = useCallback(
    (note: number, stepIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const pattern = patterns[partId];
      if (!pattern) return;

      // Shift + Links → Velocity-Popup
      if (e.shiftKey && e.button === 0) {
        setVelocityPopup({ show: true, stepIdx, x: e.clientX, y: e.clientY });
        return;
      }

      // Rechtsklick → Step deaktivieren
      if (e.button === 2) {
        if (pattern.steps[stepIdx]?.active) toggleStep(partId, stepIdx);
        drag.current = { active: true, mode: "erase", lastNote: note, lastStep: stepIdx };
        return;
      }

      // Linksklick → Zeichnen oder Toggle
      const step = pattern.steps[stepIdx];
      if (step.active && step.note === note) {
        // Bereits diese Note → deaktivieren
        toggleStep(partId, stepIdx);
        drag.current = { active: true, mode: "erase", lastNote: note, lastStep: stepIdx };
      } else {
        setNote(partId, stepIdx, note);
        drag.current = { active: true, mode: "draw", lastNote: note, lastStep: stepIdx };
      }
    },
    [partId, patterns, setNote, toggleStep],
  );

  const handleCellMouseEnter = useCallback(
    (note: number, stepIdx: number) => {
      if (!drag.current.active) return;
      // Gleiche Zelle nicht doppelt verarbeiten
      if (drag.current.lastNote === note && drag.current.lastStep === stepIdx) return;
      drag.current.lastNote = note;
      drag.current.lastStep = stepIdx;

      if (drag.current.mode === "draw") {
        setNote(partId, stepIdx, note);
      } else {
        if (patterns[partId]?.steps[stepIdx]?.active) {
          toggleStep(partId, stepIdx);
        }
      }
    },
    [partId, patterns, setNote, toggleStep],
  );

  const handleVelocityChange = useCallback(
    (v: number) => {
      if (velocityPopup.stepIdx >= 0) {
        setVelocity(partId, velocityPopup.stepIdx, v);
      }
    },
    [partId, velocityPopup.stepIdx, setVelocity],
  );

  const closePopup = useCallback(() => {
    setVelocityPopup((p) => ({ ...p, show: false }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const pattern = patterns[partId];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-lg shadow-2xl border"
        style={{
          background:   "var(--ss-bg-panel)",
          borderColor:  "var(--ss-border)",
          width:        "min(96vw, 920px)",
          maxHeight:    "90vh",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b shrink-0"
          style={{ borderColor: "var(--ss-border)" }}
        >
          <div className="flex items-center gap-3">
            <span
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: "var(--ss-accent-primary)" }}
            >
              Piano Roll
            </span>
            <span
              className="text-sm font-medium"
              style={{ color: "var(--ss-text-primary)" }}
            >
              {partName}
            </span>
            <span
              className="text-xs"
              style={{ color: "var(--ss-text-dim)" }}
            >
              C3 – B4 · 16 Steps
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => clearPart(partId)}
              className="px-3 py-1 text-xs rounded border transition-opacity hover:opacity-75"
              style={{
                borderColor: "var(--ss-accent-danger)",
                color:        "var(--ss-accent-danger)",
                background:   "transparent",
              }}
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs rounded border transition-opacity hover:opacity-75"
              style={{
                borderColor: "var(--ss-border)",
                color:       "var(--ss-text-muted)",
                background:  "transparent",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Grid ── */}
        <div className="overflow-auto flex-1 p-3 select-none">
          {/* Schritt-Kopfzeile */}
          <div
            className="flex mb-1"
            style={{ marginLeft: KEY_WIDTH }}
          >
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <div
                key={i}
                className="flex-1 text-center text-xs"
                style={{
                  minWidth: CELL_MIN_W,
                  color:    (i % 4 === 0)
                    ? "var(--ss-text-muted)"
                    : "var(--ss-text-dim)",
                  fontWeight: (i % 4 === 0) ? 600 : 400,
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Noten-Zeilen */}
          {NOTES.map((note) => {
            const black  = isBlack(note);
            const isC    = note % 12 === 0;
            const label  = midiToLabel(note);

            return (
              <div
                key={note}
                className="flex items-stretch"
                style={{ height: ROW_HEIGHT }}
              >
                {/* Piano-Taste */}
                <div
                  className="flex items-center justify-end pr-2 shrink-0 cursor-pointer transition-opacity hover:opacity-70"
                  style={{
                    width:       KEY_WIDTH,
                    height:      ROW_HEIGHT,
                    background:  black ? "#18182a" : "#2a2a3e",
                    borderRight: "2px solid var(--ss-accent-primary)",
                    borderBottom: isC
                      ? "1px solid var(--ss-accent-secondary)"
                      : "1px solid rgba(255,255,255,0.06)",
                    color:      black ? "var(--ss-text-dim)" : "var(--ss-text-muted)",
                    fontSize:   10,
                    userSelect: "none",
                  }}
                  onMouseEnter={() => playPreview(note)}
                >
                  {label}
                </div>

                {/* Step-Zellen */}
                {Array.from({ length: STEP_COUNT }, (_, stepIdx) => {
                  const step     = pattern?.steps[stepIdx];
                  const isActive = step?.active === true && step?.note === note;

                  return (
                    <div
                      key={stepIdx}
                      className="flex-1 transition-opacity"
                      style={{
                        minWidth:    CELL_MIN_W,
                        height:      ROW_HEIGHT,
                        cursor:      "crosshair",
                        background:  isActive
                          ? "var(--ss-accent-primary)"
                          : black
                            ? "rgba(0,0,0,0.22)"
                            : "transparent",
                        borderBottom: isC
                          ? "1px solid var(--ss-accent-secondary)"
                          : "1px solid rgba(255,255,255,0.04)",
                        borderRight: (stepIdx + 1) % 4 === 0
                          ? "1px solid rgba(255,255,255,0.18)"
                          : "1px solid rgba(255,255,255,0.04)",
                        boxSizing:   "border-box",
                        opacity:     isActive ? 1 : undefined,
                      }}
                      onMouseDown={(e) => handleCellMouseDown(note, stepIdx, e)}
                      onMouseEnter={() => handleCellMouseEnter(note, stepIdx)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between px-4 py-2 border-t shrink-0"
          style={{
            borderColor: "var(--ss-border)",
            color:       "var(--ss-text-dim)",
            fontSize:    11,
          }}
        >
          <span>
            Klick: Note setzen · Rechtsklick: Löschen · Shift+Klick: Velocity · Drag: Zeichnen
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1 rounded text-xs font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "var(--ss-accent-primary)",
              color:      "#000",
            }}
          >
            Fertig
          </button>
        </div>
      </div>

      {/* ── Velocity-Popup ── */}
      {velocityPopup.show && (
        <>
          {/* Klick außerhalb schließt Popup */}
          <div
            className="fixed inset-0"
            style={{ zIndex: 59 }}
            onMouseDown={closePopup}
          />
          <div
            className="fixed flex flex-col gap-2 rounded border shadow-xl p-3"
            style={{
              zIndex:      60,
              left:        Math.min(velocityPopup.x, window.innerWidth - 180),
              top:         Math.max(2, velocityPopup.y - 90),
              background:  "var(--ss-bg-elevated)",
              borderColor: "var(--ss-border)",
              minWidth:    164,
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--ss-text-muted)" }}>
                Velocity – Step {velocityPopup.stepIdx + 1}
              </span>
              <button
                className="text-xs hover:opacity-70"
                style={{ color: "var(--ss-text-dim)" }}
                onClick={closePopup}
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={127}
                value={pattern?.steps[velocityPopup.stepIdx]?.velocity ?? 100}
                onChange={(e) => handleVelocityChange(Number(e.target.value))}
                className="flex-1"
                style={{ accentColor: "var(--ss-accent-primary)" }}
              />
              <span
                className="text-xs font-mono w-8 text-right"
                style={{ color: "var(--ss-text-primary)" }}
              >
                {pattern?.steps[velocityPopup.stepIdx]?.velocity ?? 100}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
