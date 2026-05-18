/**
 * OmniTribeSpectrumAnalyzer — 64-Bin-FFT-Visualizer für OmniTribe-Stream.
 *
 * Render-Strategie:
 *   - Canvas 2D (kein React-DOM-Refresh-Storm).
 *   - RAF-Loop liest direkt aus dem Store via getOmniTribeSpectrumBinsRef()
 *     und überträgt auf das Canvas. Re-render der Komponente nur bei
 *     Size-Changes oder connected-Toggle.
 *   - Color-Gradient: blau → cyan → grün via --ss-accent-* Tokens
 *     (getComputedStyle → wir verwenden den theme-Variablen-Wert).
 *
 * Disconnect: RAF läuft weiter, aber Werte sind alle 0 → Canvas bleibt leer.
 */

import { useEffect, useRef, type ReactElement } from "react";
import {
  getOmniTribeSpectrumBinsRef,
  OMNITRIBE_SPECTRUM_BINS,
} from "../../store/useOmniTribeMetersStore";

export interface OmniTribeSpectrumAnalyzerProps {
  /** Canvas-Höhe in Pixel. Default 120. */
  heightPx?: number;
  /** isConnected-Flag — Label zeigt Status. */
  connected?: boolean;
}

/** Liest eine CSS-Variable von :root, fallback auf Default-Hex. */
function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || !window.document) return fallback;
  try {
    const value = getComputedStyle(window.document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

export function OmniTribeSpectrumAnalyzer({
  heightPx = 120,
  connected = true,
}: OmniTribeSpectrumAnalyzerProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Theme-Farben (einmalig pro Mount lesen + bei Theme-Switch käme
    // ein Remount via Page-Reload sowieso — Theme-Live-Switch ist hier
    // visuelle Sekundär-Anforderung).
    const colPrimary   = readCssVar("--ss-accent-primary",   "#3b82f6"); // blue-500
    const colSecondary = readCssVar("--ss-accent-secondary", "#22d3ee"); // cyan-400
    const colSuccess   = readCssVar("--ss-accent-success",   "#22c55e"); // green-500
    const colBg        = readCssVar("--ss-bg-elevated",      "#1f2937"); // gray-800

    function draw(): void {
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;

      // Background
      ctx.fillStyle = colBg;
      ctx.fillRect(0, 0, w, h);

      const bins = getOmniTribeSpectrumBinsRef();
      const binWidth = w / OMNITRIBE_SPECTRUM_BINS;
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0,    colPrimary);
      gradient.addColorStop(0.5,  colSecondary);
      gradient.addColorStop(1,    colSuccess);

      ctx.fillStyle = gradient;
      for (let i = 0; i < OMNITRIBE_SPECTRUM_BINS; i++) {
        const v = (bins[i] ?? 0) / 127;
        const barH = v * h;
        const x = i * binWidth;
        ctx.fillRect(x + 0.5, h - barH, Math.max(1, binWidth - 1), barH);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // High-DPI: zeichne in physikalischer Größe.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // Setze interne Pixel-Auflösung passend zur CSS-Größe.
    canvas.width  = Math.floor((canvas.clientWidth  || 640) * dpr);
    canvas.height = Math.floor((canvas.clientHeight || heightPx) * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, [heightPx]);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-3"
      data-testid="omnitribe-spectrum-analyzer"
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold">
          Spectrum
        </h4>
        <span
          className={[
            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
            connected
              ? "bg-accent-success/15 text-accent-success"
              : "bg-bg-elevated text-text-dim",
          ].join(" ")}
        >
          {connected ? "64 Bins" : "Disconnected"}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: `${heightPx}px`, display: "block" }}
        aria-label="OmniTribe Spectrum Analyzer (64 frequency bins)"
      />
    </div>
  );
}

export default OmniTribeSpectrumAnalyzer;
