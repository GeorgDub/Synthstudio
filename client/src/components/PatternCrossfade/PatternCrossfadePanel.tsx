/**
 * Synthstudio – PatternCrossfadePanel (v3.123.0)
 * ============================================================
 * UI fuer Pattern-Crossfade-Konfig.
 *   - Master-Switch (enable/disable)
 *   - Length-Slider 0..16 steps
 *   - Curve-Selector (linear / equalPower / sine) mit Mini-Vis
 *   - Preview-Button → zeichnet die gewählte Kurve in einem Canvas
 *
 * Reine semantische --ss-* Tokens (kein hardcoded Tailwind-Color).
 * Isomorph: kein Electron-/Web-spezifischer Code.
 * ============================================================
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePatternCrossfadeStore,
  setEnabled,
  setLength,
  setCurve,
  resetCrossfade,
} from "@/store/usePatternCrossfadeStore";
import {
  crossfadeGain,
  type CrossfadeCurve,
} from "@/utils/patternCrossfade";

interface CurveOption {
  id: CrossfadeCurve;
  label: string;
  hint: string;
}

const CURVES: CurveOption[] = [
  { id: "linear",     label: "Linear",      hint: "Gleiche Geschwindigkeit, kein Sweet-Spot" },
  { id: "equalPower", label: "Equal-Power", hint: "Klassischer DJ-Crossfade, konstantes Volume" },
  { id: "sine",       label: "Sine",        hint: "Sanftes Easing, leichteres Mid-Dip" },
];

interface PatternCrossfadePanelProps {
  className?: string;
}

export function PatternCrossfadePanel({ className = "" }: PatternCrossfadePanelProps) {
  const cfg = usePatternCrossfadeStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [animTick, setAnimTick] = useState(0);
  const [animating, setAnimating] = useState(false);

  // ─── Canvas drawing (curve preview) ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Theme colors via CSS custom-property lookups (live token-aware).
    const styles = getComputedStyle(canvas);
    const bgColor = styles.getPropertyValue("--ss-bg-elevated").trim() || "#111";
    const gridColor = styles.getPropertyValue("--ss-border-subtle").trim() || "#333";
    const aColor = styles.getPropertyValue("--ss-accent-primary").trim() || "#8b5cf6";
    const bColor = styles.getPropertyValue("--ss-accent-secondary").trim() || "#f59e0b";
    const playColor = styles.getPropertyValue("--ss-accent-success").trim() || "#10b981";

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (i * h) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
      const x = (i * w) / 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // gainA + gainB curves
    const samples = 128;
    const drawCurve = (which: "A" | "B", color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const g = crossfadeGain(t, cfg.curve);
        const v = which === "A" ? g.gainA : g.gainB;
        const x = (i / samples) * w;
        const y = h - v * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawCurve("A", aColor);
    drawCurve("B", bColor);

    // Animated play-marker (vertical line)
    if (animating) {
      const t = (animTick % 100) / 100;
      const x = t * w;
      ctx.strokeStyle = playColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }, [cfg.curve, animTick, animating]);

  // ─── Preview animation loop ────────────────────────────────────────────────
  useEffect(() => {
    if (!animating) return;
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const progress = (elapsed / 2000) * 100; // 2s total
      setAnimTick(Math.floor(progress));
      if (elapsed < 2000) {
        raf = requestAnimationFrame(tick);
      } else {
        setAnimating(false);
        setAnimTick(0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [animating]);

  const fadeDescription = useMemo(() => {
    if (!cfg.enabled) return "Hard-Switch (kein Crossfade)";
    if (cfg.lengthSteps === 0) return "Hard-Switch (Länge=0)";
    return `${cfg.lengthSteps} step${cfg.lengthSteps === 1 ? "" : "s"} · ${cfg.curve}`;
  }, [cfg]);

  return (
    <div
      data-testid="pattern-crossfade-panel"
      className={`flex flex-col gap-4 rounded-lg border border-border-color bg-bg-panel p-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Pattern Crossfade</h3>
          <p className="text-xs text-text-muted">{fadeDescription}</p>
        </div>
        <button
          data-testid="pattern-crossfade-toggle"
          onClick={() => setEnabled(!cfg.enabled)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            cfg.enabled
              ? "bg-accent-success text-bg-base"
              : "bg-bg-elevated text-text-muted hover:text-text-primary"
          }`}
        >
          {cfg.enabled ? "Aktiv" : "Aus"}
        </button>
      </div>

      {/* Length */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <label htmlFor="crossfade-length-slider">Länge</label>
          <span data-testid="pattern-crossfade-length-value" className="font-mono text-text-primary">
            {cfg.lengthSteps} step{cfg.lengthSteps === 1 ? "" : "s"}
          </span>
        </div>
        <input
          data-testid="pattern-crossfade-length-slider"
          id="crossfade-length-slider"
          type="range"
          min={0}
          max={16}
          step={1}
          value={cfg.lengthSteps}
          onChange={(e) => setLength(Number(e.target.value))}
          disabled={!cfg.enabled}
          className="w-full"
        />
      </div>

      {/* Curve */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-text-muted">Kurve</span>
        <div className="grid grid-cols-3 gap-2">
          {CURVES.map((opt) => {
            const active = cfg.curve === opt.id;
            return (
              <button
                key={opt.id}
                data-testid={`pattern-crossfade-curve-${opt.id}`}
                onClick={() => setCurve(opt.id)}
                disabled={!cfg.enabled}
                title={opt.hint}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-accent-primary text-bg-base"
                    : "bg-bg-elevated text-text-muted hover:text-text-primary disabled:opacity-50"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview-Canvas */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Vorschau</span>
          <button
            data-testid="pattern-crossfade-preview-btn"
            onClick={() => setAnimating(true)}
            disabled={!cfg.enabled || animating}
            className="rounded-md bg-bg-elevated px-2 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            ▶ Preview
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={320}
          height={120}
          data-testid="pattern-crossfade-preview-canvas"
          className="w-full rounded border border-border-subtle"
        />
        <div className="flex items-center gap-3 text-[10px] text-text-dim">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-primary" />
            Pattern A
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-secondary" />
            Pattern B
          </span>
        </div>
      </div>

      {/* Reset */}
      <button
        data-testid="pattern-crossfade-reset-btn"
        onClick={resetCrossfade}
        className="self-start text-xs text-text-dim hover:text-accent-danger"
      >
        Zurücksetzen
      </button>
    </div>
  );
}

export default PatternCrossfadePanel;
