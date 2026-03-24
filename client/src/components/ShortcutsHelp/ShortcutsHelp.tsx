/**
 * Synthstudio – ShortcutsHelp.tsx
 *
 * Übersicht aller Tastatur-Shortcuts als modaler Dialog.
 * Öffnen mit: ? (Shift+/)
 */

import React from "react";
import { SHORTCUT_GROUPS } from "@/hooks/useKeyboardShortcuts";

interface ShortcutsHelpProps {
  onClose: () => void;
}

function KeyBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 bg-gray-700 border border-gray-500 rounded text-xs font-mono text-gray-200 shadow-sm">
      {label}
    </kbd>
  );
}

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[85vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">⌨️</span>
            <h2 className="text-base font-semibold text-gray-100">Tastatur-Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Inhalt */}
        <div className="overflow-y-auto p-6 grid grid-cols-2 gap-6">
          {SHORTCUT_GROUPS.map(group => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-3">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400 flex-1">{shortcut.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {shortcut.keys.map((key, j) => (
                        <React.Fragment key={j}>
                          <KeyBadge label={key} />
                          {j < shortcut.keys.length - 1 && (
                            <span className="text-gray-600 text-xs">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-700 shrink-0">
          <div className="text-xs text-gray-500">
            Shortcuts funktionieren nicht in Eingabefeldern
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
