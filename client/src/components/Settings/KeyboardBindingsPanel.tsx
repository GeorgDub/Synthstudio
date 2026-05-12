/**
 * Synthstudio – KeyboardBindingsPanel
 *
 * UI zum Anzeigen und Neuzuweisen aller konfigurierbaren Keyboard-Actions.
 * Klick auf eine Zeile → Recording-Mode (warten auf Tastendruck) → Speichern.
 */
import { useState, useEffect, useCallback } from "react";
import { ACTIONS, comboToLabel, eventToCombo, type ActionDef } from "@/hooks/keyboardActionDefs";
import { setBinding, clearBinding, useKeyboardBindingsStore } from "@/store/useKeyboardBindingsStore";

// Gruppiert die Actions nach Kategorie
const CATEGORIES = Array.from(new Set(ACTIONS.map(a => a.category)));

export function KeyboardBindingsPanel() {
  const { bindings } = useKeyboardBindingsStore();
  const [recording, setRecording] = useState<string | null>(null); // actionId

  const startRecording = useCallback((actionId: string) => {
    setRecording(actionId);
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(null);
  }, []);

  useEffect(() => {
    if (!recording) return;

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape = Abbrechen
      if (e.code === "Escape") { stopRecording(); return; }
      // Modifier-only keys werden ignoriert
      if (["Control","Shift","Alt","Meta"].includes(e.key)) return;

      const combo = eventToCombo(e);
      setBinding(recording, combo);
      stopRecording();
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [recording, stopRecording]);

  const getLabel = (action: ActionDef) => {
    const override = bindings[action.id];
    return override ? comboToLabel(override) : action.defaultKey;
  };

  const hasOverride = (action: ActionDef) => !!bindings[action.id];

  return (
    <div className="text-xs">
      {recording && (
        <div className="mb-4 px-3 py-2 rounded border border-accent-primary bg-accent-primary/10 text-accent-primary text-center">
          Taste drücken für <strong>{ACTIONS.find(a => a.id === recording)?.label}</strong> — Esc zum Abbrechen
        </div>
      )}

      {CATEGORIES.map(category => (
        <div key={category} className="mb-4">
          <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2 border-b border-border-color pb-1">
            {category}
          </div>
          <div className="space-y-1">
            {ACTIONS.filter(a => a.category === category).map(action => {
              const isRecording = recording === action.id;
              const isOverridden = hasOverride(action);

              return (
                <div
                  key={action.id}
                  className={`flex items-center gap-3 px-2 py-1.5 rounded transition-colors ${isRecording ? "bg-accent-primary/20 ring-1 ring-accent-primary" : "hover:bg-bg-elevated"}`}
                >
                  {/* Label */}
                  <span className="flex-1 text-text-muted">{action.label}</span>

                  {/* Taste */}
                  <button
                    onClick={() => isRecording ? stopRecording() : startRecording(action.id)}
                    title={isRecording ? "Abbrechen (Esc)" : "Klicken, dann Taste drücken"}
                    className={[
                      "min-w-[80px] px-2 py-0.5 rounded border font-mono text-[11px] text-center transition-colors",
                      isRecording
                        ? "border-accent-primary text-accent-primary animate-pulse"
                        : isOverridden
                          ? "border-accent-secondary text-accent-secondary hover:border-accent-primary"
                          : "border-border-color text-text-muted hover:border-accent-primary hover:text-text-primary",
                    ].join(" ")}
                  >
                    {isRecording ? "…" : getLabel(action)}
                  </button>

                  {/* Reset-Button (nur wenn Override gesetzt) */}
                  <button
                    onClick={() => clearBinding(action.id)}
                    disabled={!isOverridden}
                    title={isOverridden ? "Standard wiederherstellen" : "Standard"}
                    className="w-5 h-5 rounded text-[10px] text-text-dim hover:text-accent-danger disabled:opacity-20 transition-colors"
                  >
                    ↺
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-2 pt-2 border-t border-border-color text-text-dim text-[10px]">
        Klicke auf eine Taste, dann drücke die neue Tastenkombination. ↺ stellt den Standard wieder her.
      </div>
    </div>
  );
}
