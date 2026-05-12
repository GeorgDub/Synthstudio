/**
 * Synthstudio – ShortcutsHelp.tsx
 *
 * Zwei Tabs:
 *  1. Shortcuts-Übersicht (read-only, alle Standardbelegungen)
 *  2. Tastenbelegung (konfigurierbar, alle Actions neu zuweisbar)
 */

import React, { useState } from "react";
import { X } from "lucide-react";
import { SHORTCUT_GROUPS } from "@/hooks/useKeyboardShortcuts";
import { KeyboardBindingsPanel } from "@/components/Settings/KeyboardBindingsPanel";

interface ShortcutsHelpProps {
  onClose: () => void;
}

function KeyBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 bg-bg-elevated border border-border-color rounded text-xs font-mono text-text-primary shadow-sm">
      {label}
    </kbd>
  );
}

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  const [tab, setTab] = useState<"overview" | "bindings">("overview");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[85vh] bg-bg-panel border border-border-color rounded-xl shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-color shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg">⌨️</span>
            <h2 className="text-base font-semibold text-text-primary">Tastatur</h2>
            {/* Tabs */}
            <div className="flex gap-1 ml-2">
              {(["overview", "bindings"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    tab === t
                      ? "bg-accent-primary/20 text-accent-primary border border-accent-primary/40"
                      : "text-text-dim hover:text-text-primary"
                  }`}
                >
                  {t === "overview" ? "Übersicht" : "Belegung anpassen"}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary leading-none p-1 rounded flex items-center justify-center transition-colors"
            aria-label="Close"
            title="Schließen"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Inhalt */}
        <div className="overflow-y-auto flex-1 p-5">
          {tab === "overview" ? (
            <div className="grid grid-cols-2 gap-6">
              {SHORTCUT_GROUPS.map(group => (
                <div key={group.title}>
                  <h3 className="text-xs font-semibold text-accent-secondary uppercase tracking-wider mb-3">
                    {group.title}
                  </h3>
                  <div className="space-y-2">
                    {group.shortcuts.map((shortcut, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-text-muted flex-1">{shortcut.description}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {shortcut.keys.map((key, j) => (
                            <React.Fragment key={j}>
                              <KeyBadge label={key} />
                              {j < shortcut.keys.length - 1 && (
                                <span className="text-text-dim text-xs">+</span>
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
          ) : (
            <KeyboardBindingsPanel />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border-color shrink-0">
          <span className="text-xs text-text-dim">
            {tab === "overview"
              ? "Shortcuts funktionieren nicht in Eingabefeldern"
              : "Eigene Belegungen überschreiben die Standardtasten"}
          </span>
          <button onClick={onClose} className="px-4 py-1.5 bg-bg-elevated hover:bg-bg-elevated text-text-primary text-sm rounded">
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
