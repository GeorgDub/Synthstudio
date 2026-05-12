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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useMidiStepInput } from "../../hooks/useMidiStepInput";
import { useMelodicPartStore } from "../../store/useMelodicPartStore";
import {
  SCALES,
  NOTE_NAMES,
  scalePitchClasses,
  pitchClass,
  type ScaleId,
} from "../../utils/scales";
import { TransposeControl } from "./TransposeControl";

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
  const {
    patterns,
    initPart,
    setNote,
    toggleStep,
    setVelocity,
    clearPart,
    setScale,
    setScaleLock,
  } = useMelodicPartStore();

  const [velocityPopup, setVelocityPopup] = useState<VelocityPopup>({
    show:    false,
    stepIdx: -1,
    x:       0,
    y:       0,
  });
  const [stepInputEnabled, setStepInputEnabled] = useState(false);
  const { cursor: stepInputCursor, resetCursor: resetStepCursor, moveCursor } = useMidiStepInput({
    partId: stepInputEnabled ? partId : null,
    stepCount: STEP_COUNT,
    enabled: stepInputEnabled,
  });

  // MIDI Step Input: eingehende Noten in Piano Roll setzen
  useEffect(() => {
    if (!stepInputEnabled) return;
    const handler = (e: Event) => {
      const { partId: ePId, stepIndex, note, velocity } = (e as CustomEvent).detail;
      if (ePId !== partId) return;
      setNote(partId, stepIndex, note); // velocity über setVelocity separat setzen
      setVelocity(partId, stepIndex, velocity);
    };
    window.addEventListener("stepinput:note", handler);
    return () => window.removeEventListener("stepinput:note", handler);
  }, [stepInputEnabled, partId, setNote]);

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

  // ── Scale-State (aus Pattern abgeleitet) ──────────────────────────────────
  const pattern = patterns[partId];
  const scaleRoot = pattern?.scaleRoot ?? 0;
  const scaleId: ScaleId = pattern?.scaleId ?? "chromatic";
  const scaleLockEnabled = pattern?.scaleLockEnabled ?? false;

  const scalePcs = useMemo(
    () => new Set(scalePitchClasses(scaleRoot, scaleId)),
    [scaleRoot, scaleId],
  );

  const handleToggleScaleLock = useCallback(() => {
    setScaleLock(partId, !scaleLockEnabled);
  }, [partId, scaleLockEnabled, setScaleLock]);

  /** Quantisiert alle aktiven Noten zur aktiven Tonleiter. */
  const handleQuantizeToScale = useCallback(() => {
    if (scaleId === "chromatic" || !scaleLockEnabled) return;
    const pat = patterns[partId];
    if (!pat) return;
    const pcs = [...scalePcs].sort((a, b) => a - b);
    pat.steps.forEach((step, idx) => {
      if (!step.active) return;
      const pitchClass = step.note % 12;
      const octave = Math.floor(step.note / 12);
      // Nächsten Skalengrad finden
      let nearest = pcs[0];
      let minDist = 12;
      for (const pc of pcs) {
        const d = Math.min(Math.abs(pc - pitchClass), 12 - Math.abs(pc - pitchClass));
        if (d < minDist) { minDist = d; nearest = pc; }
      }
      const quantized = octave * 12 + nearest;
      if (quantized !== step.note) setNote(partId, idx, quantized);
    });
  }, [partId, patterns, scalePcs, scaleId, scaleLockEnabled, setNote]);

  const handleScaleRootChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setScale(partId, Number(e.target.value), scaleId);
    },
    [partId, scaleId, setScale],
  );

  const handleScaleIdChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setScale(partId, scaleRoot, e.target.value as ScaleId);
    },
    [partId, scaleRoot, setScale],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isOpen) return null;

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
            {/* Scale Quantize */}
            {scaleLockEnabled && scaleId !== "chromatic" && (
              <button
                onClick={handleQuantizeToScale}
                title="Alle Noten zur aktiven Tonleiter quantisieren"
                className="px-2 py-1 text-xs rounded border transition-colors"
                style={{ borderColor: "var(--ss-accent-success)", color: "var(--ss-accent-success)" }}
              >
                ⚡ Quantize
              </button>
            )}

            {/* MIDI Step Input */}
            <button
              onClick={() => { setStepInputEnabled(p => !p); resetStepCursor(); }}
              title="MIDI Step Input: Noten per MIDI-Keyboard step-weise eingeben"
              className="px-2 py-1 text-xs rounded border transition-colors"
              style={{
                borderColor: stepInputEnabled ? "var(--ss-accent-secondary)" : "var(--ss-border)",
                color: stepInputEnabled ? "var(--ss-accent-secondary)" : "var(--ss-text-dim)",
                background: stepInputEnabled ? "var(--ss-accent-secondary)10" : "transparent",
              }}
            >
              {stepInputEnabled ? `⌨ Step ${stepInputCursor + 1}` : "⌨ Step Input"}
            </button>

            {/* Global Transpose */}
            <TransposeControl />

            {/* Scale-Lock Toolbar */}
            <button
              onClick={handleToggleScaleLock}
              title={scaleLockEnabled ? "Scale Lock deaktivieren" : "Scale Lock aktivieren"}
              className="px-2 py-1 text-xs rounded border transition-opacity hover:opacity-80"
              style={{
                borderColor: scaleLockEnabled
                  ? "var(--ss-accent-primary)"
                  : "var(--ss-border)",
                color: scaleLockEnabled
                  ? "var(--ss-accent-primary)"
                  : "var(--ss-text-muted)",
                background: scaleLockEnabled
                  ? "rgba(255,255,255,0.04)"
                  : "transparent",
                fontWeight: scaleLockEnabled ? 600 : 400,
              }}
            >
              {scaleLockEnabled ? "🔒 Scale" : "Scale"}
            </button>
            <select
              aria-label="Scale Root"
              value={scaleRoot}
              onChange={handleScaleRootChange}
              className="px-1 py-1 text-xs rounded border outline-none"
              style={{
                borderColor: "var(--ss-border)",
                color:       "var(--ss-text-primary)",
                background:  "var(--ss-bg-elevated)",
              }}
            >
              {NOTE_NAMES.map((name, idx) => (
                <option key={idx} value={idx}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Scale Type"
              value={scaleId}
              onChange={handleScaleIdChange}
              className="px-1 py-1 text-xs rounded border outline-none"
              style={{
                borderColor: "var(--ss-border)",
                color:       "var(--ss-text-primary)",
                background:  "var(--ss-bg-elevated)",
              }}
            >
              {SCALES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
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
              className="px-2 py-1 text-xs rounded border transition-opacity hover:opacity-75 flex items-center justify-center"
              style={{
                borderColor: "var(--ss-border)",
                color:       "var(--ss-text-muted)",
                background:  "transparent",
              }}
              aria-label="Close"
              title="Schließen (ESC)"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
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
            const inScale = scalePcs.has(pitchClass(note));
            // Bei aktivem Scale-Lock werden Out-of-Scale-Zeilen sichtbar abgedunkelt
            const dim = scaleLockEnabled && !inScale;
            // Bei deaktiviertem Lock wird die Skala dezent als Hintergrund angedeutet
            const subtleHighlight = !scaleLockEnabled && inScale;
            const isRoot = pitchClass(note) === pitchClass(scaleRoot);

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
                    borderRight: isRoot
                      ? "3px solid var(--ss-accent-primary)"
                      : "2px solid var(--ss-accent-primary)",
                    borderBottom: isC
                      ? "1px solid var(--ss-accent-secondary)"
                      : "1px solid rgba(255,255,255,0.06)",
                    color:      black ? "var(--ss-text-dim)" : "var(--ss-text-muted)",
                    fontSize:   10,
                    userSelect: "none",
                    opacity:    dim ? 0.45 : 1,
                  }}
                  onMouseEnter={() => playPreview(note)}
                >
                  {label}
                </div>

                {/* Step-Zellen */}
                {Array.from({ length: STEP_COUNT }, (_, stepIdx) => {
                  const step     = pattern?.steps[stepIdx];
                  const isActive = step?.active === true && step?.note === note;

                  let cellBg: string;
                  if (isActive) {
                    cellBg = "var(--ss-accent-primary)";
                  } else if (dim) {
                    cellBg = "rgba(0,0,0,0.4)";
                  } else if (subtleHighlight) {
                    cellBg = isRoot
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(255,255,255,0.02)";
                  } else if (black) {
                    cellBg = "rgba(0,0,0,0.22)";
                  } else {
                    cellBg = "transparent";
                  }

                  return (
                    <div
                      key={stepIdx}
                      className="flex-1 transition-opacity"
                      style={{
                        minWidth:    CELL_MIN_W,
                        height:      ROW_HEIGHT,
                        cursor:      "crosshair",
                        background:  cellBg,
                        borderBottom: isC
                          ? "1px solid var(--ss-accent-secondary)"
                          : "1px solid rgba(255,255,255,0.04)",
                        borderRight: (stepIdx + 1) % 4 === 0
                          ? "1px solid rgba(255,255,255,0.18)"
                          : "1px solid rgba(255,255,255,0.04)",
                        boxSizing:   "border-box",
                        opacity:     isActive ? 1 : dim ? 0.55 : undefined,
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
            {scaleLockEnabled && " · 🔒 Scale-Lock aktiv (Snap auf Skala)"}
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
                className="text-xs hover:opacity-70 p-0.5 rounded flex items-center justify-center"
                style={{ color: "var(--ss-text-muted)" }}
                onClick={closePopup}
                aria-label="Close"
                title="Schließen"
              >
                <X className="w-3 h-3" aria-hidden="true" />
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
