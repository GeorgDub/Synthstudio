/**
 * Synthstudio – WaveformMini  (v3.130.0)
 *
 * Pure presentational component: ein winziges Bar-Chart-SVG, das ein
 * gegebenes Envelope-Array (number[] 0..1) als vertikale Bars rendert.
 *
 * Verwendet in DrumMachine/ChannelStrip step-cells.
 *
 * Props:
 *  - waveform: number[]        — Envelope-Werte (0..1 erwartet, wird geclampt)
 *  - color?: string            — Bar-Color (Channel-Color). Default: var(--ss-accent-primary)
 *  - isActive?: boolean        — Step aktiv? steuert Opacity (active=full, inactive=dim)
 *  - sampleId?: string         — für data-testid (Test-Hook)
 *
 * Render:
 *  - SVG viewBox 0 0 W H (W=waveform.length, H=16)
 *  - Pro Bar: width=1, x=index, y=center-height/2, height=value*H
 *  - aria-hidden=true (rein dekorativ)
 *  - preserveAspectRatio="none" — füllt die Step-Cell perfekt
 */
import React from "react";

export interface WaveformMiniProps {
  waveform: number[];
  color?: string;
  isActive?: boolean;
  /** Optional sampleId für data-testid. */
  sampleId?: string;
  /** Höhe in viewBox-Units. Default: 16. */
  viewHeight?: number;
}

const DEFAULT_VIEW_HEIGHT = 16;

/**
 * Pure render. Memo'd damit nicht jeder Re-Render der ChannelStrip
 * (currentStep-Tick) jede Step-Cell neu rendert — der Bar-Chart ist
 * pro Step statisch bis sich Sample oder Active-State ändert.
 */
export const WaveformMini = React.memo(function WaveformMini({
  waveform,
  color,
  isActive = true,
  sampleId,
  viewHeight = DEFAULT_VIEW_HEIGHT,
}: WaveformMiniProps) {
  if (!waveform || waveform.length === 0) return null;

  const w = waveform.length;
  const h = Math.max(2, Math.floor(viewHeight));
  const centerY = h / 2;
  const fill = color ?? "var(--ss-accent-primary)";
  const opacity = isActive ? 0.95 : 0.45;

  // Test-ID nur setzen, wenn sampleId vorhanden — vermeidet
  // doppelte testIds (DrumKit mit leeren Channels).
  const testId = sampleId ? `waveform-mini-${sampleId}` : undefined;

  return (
    <svg
      data-testid={testId}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ opacity }}
    >
      {waveform.map((v, i) => {
        // Defensive clamp — wir trauen dem Producer nicht blind.
        const peak = !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
        // Mindesthöhe 0.5 damit auch sehr leise Bars sichtbar bleiben (subtle hint).
        const barH = Math.max(peak * h, peak > 0 ? 0.5 : 0);
        const y = centerY - barH / 2;
        return (
          <rect
            key={i}
            x={i}
            y={y}
            width={1}
            height={barH}
            fill={fill}
          />
        );
      })}
    </svg>
  );
});
