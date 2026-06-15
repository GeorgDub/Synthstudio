// ─── Waveform-Panel ───────────────────────────────────────────────────────────
// v3.281 (TASK-269): aus SampleBrowser.tsx extrahiert (verbatim Move,
// verhaltensneutral). Props-only, kein interner State/Hook/Effect, keine
// Rück-Kante zum Parent. WaveformPanel-exklusive Helfer (getWaveformColor,
// CATEGORY_WAVEFORM_COLORS, formatDuration) ziehen mit hierher. formatBytes
// wird im Parent weiterhin genutzt (Sample-Liste) — daher liegt hier eine
// private, identische Kopie (kein Zirkel-Import, kein shared-util-Scope-Creep).

import type { Sample } from "../../store/useProjectStore";
import { WaveformDisplay } from "../WaveformDisplay";

const CATEGORY_WAVEFORM_COLORS: Record<string, string> = {
  kicks:      "#ef4444",
  snares:     "#f97316",
  hihats:     "#eab308",
  claps:      "#22c55e",
  toms:       "#14b8a6",
  percussion: "#06b6d4",
  fx:         "#3b82f6",
  loops:      "#6366f1",
  vocals:     "#a855f7",
  other:      "#64748b",
  imported:   "#22d3ee",
};

function getWaveformColor(categoryId: string): string {
  return CATEGORY_WAVEFORM_COLORS[categoryId] ?? "#22d3ee";
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface WaveformPanelProps {
  sample: Sample;
  isPlaying: boolean;
  playbackPosition: number;
  onSeek: (position: number) => void;
  onPlayToggle: () => void;
  onAssignToChannel?: () => void;
  activeChannelName?: string;
  analysisResult: { peaks: number[]; duration: number; sampleRate?: number; channels?: number; estimatedBpm?: number } | null;
  isAnalyzing: boolean;
  /** v3.116.0: Time-Stretch + Pitch-Shift Dialog öffnen. */
  onTransform?: () => void;
}

export function WaveformPanel({
  sample,
  isPlaying,
  playbackPosition,
  onSeek,
  onPlayToggle,
  onAssignToChannel,
  activeChannelName,
  analysisResult,
  isAnalyzing,
  onTransform,
}: WaveformPanelProps) {
  const waveformColor = getWaveformColor(sample.category);

  return (
    <div className="border-t border-border-color bg-bg-base flex flex-col">
      {/* Sample-Name + Zuweisung */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-color/50">
        <span className="text-xs text-accent-primary font-medium truncate flex-1" title={sample.name}>
          {sample.name}
        </span>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {onAssignToChannel && (
            <button
              onClick={onAssignToChannel}
              title={activeChannelName ? `Auf Kanal "${activeChannelName}" legen` : "Auf aktiven Kanal legen (Doppelklick)"}
              className="px-2 py-0.5 rounded text-[10px] bg-accent-primary/70 text-bg-base hover:bg-accent-primary transition-colors font-medium"
            >
              → {activeChannelName ? activeChannelName.slice(0, 8) : "Kanal"}
            </button>
          )}
          <button
            onClick={onPlayToggle}
            className={[
              "w-7 h-7 rounded flex items-center justify-center text-xs transition-all duration-100 flex-shrink-0",
              isPlaying
                ? "bg-accent-secondary text-bg-base"
                : "bg-bg-elevated text-text-primary hover:brightness-125 ",
            ].join(" ")}
            title={isPlaying ? "Preview stoppen (Leertaste)" : "Preview abspielen (Leertaste)"}
          >
            {isPlaying ? "■" : "▶"}
          </button>
          {onTransform && (
            <button
              onClick={onTransform}
              data-testid="sample-transform-open"
              className="w-7 h-7 rounded flex items-center justify-center text-[11px] bg-bg-elevated text-text-primary hover:bg-accent-primary/30 hover:text-accent-primary transition-colors flex-shrink-0"
              title="Time-Stretch + Pitch-Shift (Transformieren)"
            >
              ⤬
            </button>
          )}
        </div>
      </div>

      {/* Waveform */}
      <div className="px-2 py-1.5">
        <WaveformDisplay
          peaks={analysisResult?.peaks ?? []}
          duration={analysisResult?.duration ?? 0}
          playbackPosition={playbackPosition}
          isPlaying={isPlaying}
          onSeek={onSeek}
          color={waveformColor}
          height={72}
          isLoading={isAnalyzing}
          zoomEnabled={true}
          className="rounded overflow-hidden"
        />
      </div>

      {/* Sample-Details */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 text-[10px] text-text-dim">
        {analysisResult?.duration != null && (
          <span title="Dauer">⏱ {formatDuration(analysisResult.duration)}</span>
        )}
        {analysisResult?.sampleRate != null && (
          <span title="Samplerate">{(analysisResult.sampleRate / 1000).toFixed(1)} kHz</span>
        )}
        {analysisResult?.channels != null && (
          <span title="Kanäle">{analysisResult.channels === 1 ? "Mono" : "Stereo"}</span>
        )}
        {analysisResult?.estimatedBpm != null && (
          <span title="Geschätztes BPM" className="text-accent-primary">
            ♩ {analysisResult.estimatedBpm} BPM
          </span>
        )}
        {sample.size != null && (
          <span title="Dateigröße">{formatBytes(sample.size)}</span>
        )}
        {isAnalyzing && (
          <span className="text-accent-primary animate-pulse">Analysiere…</span>
        )}
      </div>
    </div>
  );
}
