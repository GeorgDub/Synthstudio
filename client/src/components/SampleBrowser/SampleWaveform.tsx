/**
 * Synthstudio – SampleWaveform
 *
 * Mini-Canvas-Waveform für den SampleBrowser.
 * Dekodiert das Audio und zeichnet die Wellenform.
 * Wird beim Hover/Selektion eines Samples angezeigt.
 */
import React, { useEffect, useRef, useState } from "react";

interface SampleWaveformProps {
  url: string;
  width?: number;
  height?: number;
  color?: string;
}

export function SampleWaveform({ url, width = 200, height = 40, color }: SampleWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return;

    let cancelled = false;
    setLoading(true);
    setError(false);

    (async () => {
      try {
        const ctx = new AudioContext();
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const ab   = await resp.arrayBuffer();
        const buf  = await ctx.decodeAudioData(ab);
        if (cancelled) return;

        const data   = buf.getChannelData(0);
        const step   = Math.ceil(data.length / (width * 2));
        const dpr    = window.devicePixelRatio;
        canvas.width  = width  * dpr;
        canvas.height = height * dpr;

        const ctx2d = canvas.getContext("2d")!;
        const rawAccent = getComputedStyle(document.documentElement).getPropertyValue("--ss-accent-primary").trim();
        const accentColor = color ?? (rawAccent || "#f59e0b");
        const rawBg = getComputedStyle(document.documentElement).getPropertyValue("--ss-bg-base").trim();
        const bgColor = rawBg || "#0a0a0a";

        ctx2d.fillStyle = bgColor;
        ctx2d.fillRect(0, 0, canvas.width, canvas.height);

        ctx2d.strokeStyle = accentColor;
        ctx2d.lineWidth = dpr;
        ctx2d.globalAlpha = 0.85;
        ctx2d.beginPath();

        const mid = (canvas.height / 2);
        for (let x = 0; x < width * 2; x++) {
          let min = 1, max = -1;
          for (let s = x * step; s < Math.min((x + 1) * step, data.length); s++) {
            if (data[s] < min) min = data[s];
            if (data[s] > max) max = data[s];
          }
          const y1 = mid + max * mid * 0.9;
          const y2 = mid + min * mid * 0.9;
          if (x === 0) ctx2d.moveTo(x / 2 * dpr, y1);
          ctx2d.lineTo(x / 2 * dpr, y1);
          ctx2d.lineTo(x / 2 * dpr, y2);
        }
        ctx2d.stroke();
        setLoading(false);
      } catch {
        if (!cancelled) { setLoading(false); setError(true); }
      }
    })();

    return () => { cancelled = true; };
  }, [url, width, height, color]);

  return (
    <div className="relative rounded overflow-hidden" style={{ width, height }}>
      {loading && <div className="absolute inset-0 flex items-center justify-center text-[9px] text-text-dim">…</div>}
      {error   && <div className="absolute inset-0 flex items-center justify-center text-[9px] text-text-dim">?</div>}
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: loading || error ? "none" : "block" }} />
    </div>
  );
}
