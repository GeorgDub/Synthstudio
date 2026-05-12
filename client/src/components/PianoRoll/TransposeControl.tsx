/**
 * Synthstudio – TransposeControl
 *
 * Kompakte Toolbar für den globalen Transpose-Wert (±24 Halbtöne).
 * Wird im PianoRollModal-Header platziert und beeinflusst alle melodischen
 * Triggers via AudioEngine.setGlobalTranspose().
 */
import { useCallback } from "react";
import { useTransposeStore } from "../../store/useTransposeStore";
import { semitoneLabel } from "../../utils/transpose";

export function TransposeControl() {
  const { semitones, incSemitones, reset } = useTransposeStore();

  const handleDec12 = useCallback(() => incSemitones(-12), [incSemitones]);
  const handleDec1  = useCallback(() => incSemitones(-1),  [incSemitones]);
  const handleInc1  = useCallback(() => incSemitones(1),   [incSemitones]);
  const handleInc12 = useCallback(() => incSemitones(12),  [incSemitones]);

  const isActive = semitones !== 0;

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 rounded border"
      style={{
        borderColor: isActive ? "var(--ss-accent-primary)" : "var(--ss-border)",
        background:  isActive ? "rgba(255,255,255,0.04)" : "transparent",
      }}
      title="Globaler Transpose – verschiebt alle melodischen Trigger um Halbtöne"
    >
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--ss-text-dim)" }}
      >
        Transpose
      </span>
      <button
        onClick={handleDec12}
        title="−1 Oktave"
        className="px-1.5 py-0.5 text-xs rounded hover:opacity-75 transition-opacity"
        style={{ color: "var(--ss-text-muted)", background: "rgba(255,255,255,0.05)" }}
      >
        −12
      </button>
      <button
        onClick={handleDec1}
        title="−1 Halbton"
        className="px-1.5 py-0.5 text-xs rounded hover:opacity-75 transition-opacity"
        style={{ color: "var(--ss-text-muted)", background: "rgba(255,255,255,0.05)" }}
      >
        −1
      </button>
      <span
        className="px-1.5 py-0.5 text-xs font-mono min-w-[3.5rem] text-center"
        style={{
          color: isActive ? "var(--ss-accent-primary)" : "var(--ss-text-primary)",
          fontWeight: isActive ? 600 : 400,
        }}
        aria-live="polite"
        aria-label={`Transpose ${semitones} Halbtöne`}
      >
        {semitoneLabel(semitones)}
      </span>
      <button
        onClick={handleInc1}
        title="+1 Halbton"
        className="px-1.5 py-0.5 text-xs rounded hover:opacity-75 transition-opacity"
        style={{ color: "var(--ss-text-muted)", background: "rgba(255,255,255,0.05)" }}
      >
        +1
      </button>
      <button
        onClick={handleInc12}
        title="+1 Oktave"
        className="px-1.5 py-0.5 text-xs rounded hover:opacity-75 transition-opacity"
        style={{ color: "var(--ss-text-muted)", background: "rgba(255,255,255,0.05)" }}
      >
        +12
      </button>
      <button
        onClick={reset}
        title="Reset auf 0"
        disabled={!isActive}
        className="px-1.5 py-0.5 text-xs rounded transition-opacity"
        style={{
          color: isActive ? "var(--ss-accent-danger)" : "var(--ss-text-dim)",
          background: "transparent",
          opacity: isActive ? 1 : 0.4,
          cursor: isActive ? "pointer" : "not-allowed",
        }}
      >
        ⟲
      </button>
    </div>
  );
}

export default TransposeControl;
