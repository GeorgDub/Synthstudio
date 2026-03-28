/**
 * ModMatrix.tsx – Modulationsmatrix Grid-Komponente
 * Phase 6: Modulationsmatrix
 */
import React from "react";
import type { ModMatrixEntry, ModSource, ModTarget } from "@/audio/AudioEngine";

interface ModMatrixProps {
  entries: ModMatrixEntry[];
  partIds: string[];
  onAddEntry: (entry: Omit<ModMatrixEntry, "id">) => void;
  onRemoveEntry: (id: string) => void;
  onUpdateEntry: (id: string, update: Partial<ModMatrixEntry>) => void;
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

export function ModMatrix({ entries, partIds, onAddEntry, onRemoveEntry, onUpdateEntry }: ModMatrixProps) {
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
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white min-w-[320px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Mod Matrix</span>
        <button
          onClick={handleAdd}
          className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded"
        >
          + Route
        </button>
      </div>

      {entries.length === 0 && (
        <div className="text-slate-600 text-xs py-3 text-center">
          Keine Routen. „+ Route" um eine hinzuzufügen.
        </div>
      )}

      <div className="space-y-1">
        {entries.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 bg-slate-800 rounded px-2 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={entry.enabled}
              onChange={e => onUpdateEntry(entry.id, { enabled: e.target.checked })}
              className="accent-cyan-500"
            />
            <span className="text-slate-300 w-28 truncate" title={sourceLabel(entry.source)}>
              {sourceLabel(entry.source)}
            </span>
            <span className="text-slate-500">→</span>
            <span className="text-slate-300 flex-1 truncate" title={targetLabel(entry.target)}>
              {targetLabel(entry.target)}
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={entry.amount}
              onChange={e => onUpdateEntry(entry.id, { amount: Number(e.target.value) })}
              className="w-20 accent-cyan-500"
            />
            <span className="font-mono text-cyan-400 w-10 text-right">
              {(entry.amount >= 0 ? "+" : "") + entry.amount.toFixed(2)}
            </span>
            <button
              onClick={() => onRemoveEntry(entry.id)}
              className="text-slate-600 hover:text-red-400 text-base leading-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
