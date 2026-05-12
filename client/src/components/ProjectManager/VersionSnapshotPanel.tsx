/**
 * Synthstudio – VersionSnapshotPanel
 *
 * Zeigt alle gespeicherten Version-Snapshots und ermöglicht
 * das Wiederherstellen oder Löschen einzelner Checkpoints.
 */
import React, { useCallback } from "react";
import { useVersionSnapshotStore, deleteSnapshot, type VersionSnapshot } from "@/store/useVersionSnapshotStore";

interface VersionSnapshotPanelProps {
  onRestore: (patternsJson: string) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function SnapshotRow({ snap, onRestore, onDelete }: {
  snap: VersionSnapshot;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded border border-border-color bg-bg-elevated hover:border-accent-secondary/40 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-text-primary truncate">{snap.label}</div>
        <div className="text-[10px] text-text-dim">{snap.projectName} · {formatDate(snap.timestamp)}</div>
      </div>
      <button
        onClick={onRestore}
        className="px-2 py-0.5 text-[10px] rounded bg-accent-secondary/20 text-accent-secondary hover:bg-accent-secondary/30 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
        title="Wiederherstellen"
      >
        ↩ Laden
      </button>
      <button
        onClick={onDelete}
        className="text-text-dim hover:text-accent-danger text-sm leading-none opacity-0 group-hover:opacity-100 transition-colors flex-shrink-0"
        title="Löschen"
      >
        ✕
      </button>
    </div>
  );
}

export function VersionSnapshotPanel({ onRestore }: VersionSnapshotPanelProps) {
  const { snapshots } = useVersionSnapshotStore();

  const handleRestore = useCallback((snap: VersionSnapshot) => {
    if (!confirm(`"${snap.label}" (${formatDate(snap.timestamp)}) wiederherstellen?\nAktueller Zustand geht verloren.`)) return;
    onRestore(snap.patternsJson);
  }, [onRestore]);

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Version-Snapshots</span>
        <span className="text-[10px] text-text-dim">{snapshots.length}/{10}</span>
      </div>

      {snapshots.length === 0 ? (
        <div className="text-xs text-text-dim text-center py-4 border border-dashed border-border-color rounded-lg">
          Keine Snapshots. Auto-Save legt automatisch alle 5 Minuten einen Checkpoint an.
        </div>
      ) : (
        <div className="space-y-1">
          {snapshots.map(snap => (
            <SnapshotRow
              key={snap.id}
              snap={snap}
              onRestore={() => handleRestore(snap)}
              onDelete={() => deleteSnapshot(snap.id)}
            />
          ))}
        </div>
      )}

      <p className="text-[10px] text-text-dim mt-1">
        Hover über einen Snapshot um Optionen anzuzeigen. Max. 10 Checkpoints.
      </p>
    </div>
  );
}
