/**
 * ModMatrix.tsx – Modulationsmatrix Grid-Komponente
 * Phase 6: Modulationsmatrix
 */
import React from "react";
import { X } from "lucide-react";
import type { ModMatrixEntry, ModSource, ModTarget } from "@/audio/AudioEngine";

interface ModMatrixProps {
  entries: ModMatrixEntry[];
  partIds: string[];
  onAddEntry: (entry: Omit<ModMatrixEntry, "id">) => void;
  onRemoveEntry: (id: string) => void;
  onUpdateEntry: (id: string, update: Partial<ModMatrixEntry>) => void;
  onClose?: () => void;
}

function sourceLabel(source: ModSource): string {
  if (source.type === "lfo") return `LFO (${source.partId.slice(-4)})`;
  if (source.type === "random") return "Random";
  if (source.type === "midiCC") return `CC${source.ccNumber}`;
  if (source.type === "envelope") return `Env (${source.partId.slice(-4)})`;
  if (source.type === "stepSeq") return `Seq[${source.stepIndex}]`;
  return "?";
}

function targetLabel(target: ModTarget): string {
  if (target.type === "channelFx") return `FX.${target.param} (${target.partId.slice(-4)})`;
  if (target.type === "pitch") return `Pitch (${target.partId.slice(-4)})`;
  if (target.type === "volume") return `Vol (${target.partId.slice(-4)})`;
  if (target.type === "pan") return `Pan (${target.partId.slice(-4)})`;
  return "?";
}

export function ModMatrix({ entries, partIds, onAddEntry, onRemoveEntry, onUpdateEntry, onClose }: ModMatrixProps) {
  const handleAdd = () => {
    if (partIds.length === 0) return;
    onAddEntry({
      source: { type: "random" },
      target: { type: "volume", partId: partIds[0] },
      amount: 0.5,
      enabled: true,
    });
  };

  return (
    <div className="bg-bg-panel border border-border-color rounded-lg p-3 text-text-primary min-w-[320px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-accent-secondary uppercase tracking-wider">Mod Matrix</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleAdd}
            className="text-xs bg-bg-elevated hover:text-text-primary px-2 py-0.5 rounded"
          >
            + Route
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary p-1 rounded flex items-center justify-center transition-colors"
              aria-label="Close"
              title="Schließen"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 && (
        <div className="text-text-dim text-xs py-3 text-center">
          Keine Routen. „+ Route" um eine hinzuzufügen.
        </div>
      )}

      <div className="space-y-1">
        {entries.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 bg-bg-elevated rounded px-2 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={entry.enabled}
              onChange={e => onUpdateEntry(entry.id, { enabled: e.target.checked })}
              className="accent-accent-primary"
            />
            <span className="text-text-primary w-28 truncate" title={sourceLabel(entry.source)}>
              {sourceLabel(entry.source)}
            </span>
            <span className="text-text-dim">→</span>
            <span className="text-text-primary flex-1 truncate" title={targetLabel(entry.target)}>
              {targetLabel(entry.target)}
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={entry.amount}
              onChange={e => onUpdateEntry(entry.id, { amount: Number(e.target.value) })}
              className="w-20 accent-accent-primary"
            />
            <span className="font-mono text-accent-secondary w-10 text-right">
              {(entry.amount >= 0 ? "+" : "") + entry.amount.toFixed(2)}
            </span>
            <button
              onClick={() => onRemoveEntry(entry.id)}
              className="text-text-dim hover:text-accent-danger text-base leading-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
