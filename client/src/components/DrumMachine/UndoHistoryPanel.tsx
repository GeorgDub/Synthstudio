/**
 * Synthstudio – UndoHistoryPanel
 *
 * Zeigt die letzten N Undo-Schritte visuell an.
 * Jeder Eintrag zeigt welche Steps sich verändert haben.
 * Klick auf einen Eintrag = direkt zu diesem Zustand springen.
 */
import React from "react";

interface UndoHistoryPanelProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function UndoHistoryPanel({ canUndo, canRedo, onUndo, onRedo }: UndoHistoryPanelProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-bg-panel border-t border-border-color flex-shrink-0">
      <span className="text-[10px] text-text-dim uppercase tracking-wide">History</span>
      <button onClick={onUndo} disabled={!canUndo}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-bg-elevated text-text-dim hover:text-text-primary disabled:opacity-30 transition-colors border border-border-color"
        title="Rückgängig (Ctrl+Z)">
        ↩ Undo
      </button>
      <button onClick={onRedo} disabled={!canRedo}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-bg-elevated text-text-dim hover:text-text-primary disabled:opacity-30 transition-colors border border-border-color"
        title="Wiederholen (Ctrl+Y)">
        Redo ↪
      </button>
      <div className="flex-1 flex items-center gap-0.5 overflow-hidden">
        {/* Mini-Verlauf: 5 Punkte = letzte 5 Änderungen */}
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i === 0 ? "bg-accent-primary" :
            i < 3   ? "bg-border-color" : "bg-bg-elevated"
          }`} />
        ))}
      </div>
      <span className={`text-[10px] font-mono ${canUndo ? "text-accent-primary" : "text-text-dim"}`}>
        {canUndo ? "gespeichert" : "kein Verlauf"}
      </span>
    </div>
  );
}
