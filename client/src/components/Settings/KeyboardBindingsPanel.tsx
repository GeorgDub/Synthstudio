/**
 * Synthstudio – KeyboardBindingsPanel
 *
 * UI zum Anzeigen und Neuzuweisen aller konfigurierbaren Keyboard-Actions.
 * Klick auf eine Zeile → Recording-Mode (warten auf Tastendruck) → Speichern.
 */
import { useState, useEffect, useCallback } from "react";
import { ACTIONS, comboToLabel, eventToCombo, type ActionDef } from "@/hooks/keyboardActionDefs";
import { setBinding, clearBinding, useKeyboardBindingsStore } from "@/store/useKeyboardBindingsStore";
import { useScriptStore, type Script, type KeyCombo as ScriptKeyCombo } from "@/store/useScriptStore";

// Gruppiert die Actions nach Kategorie
const CATEGORIES = Array.from(new Set(ACTIONS.map(a => a.category)));

/**
 * Formatiert eine ScriptKeyCombo ({ key, ctrl, shift, alt, meta }) zu einem
 * lesbaren Label (z.B. "Ctrl+Shift+B"). Eigene Implementierung weil
 * comboToLabel aus keyboardActionDefs auf event.code basiert (anderes Format).
 */
function scriptComboToLabel(c: ScriptKeyCombo): string {
  const parts: string[] = [];
  if (c.ctrl)  parts.push("Ctrl");
  if (c.alt)   parts.push("Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta)  parts.push("Meta");
  parts.push(c.key.length === 1 ? c.key.toUpperCase() : c.key);
  return parts.join("+");
}

export function KeyboardBindingsPanel() {
  const { bindings } = useKeyboardBindingsStore();
  const { scripts } = useScriptStore();
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

      {/* ── Scripts-Bindings (Read-Only) ──────────────────────────────────── */}
      <ScriptBindingsSection scripts={scripts} />

      <div className="mt-2 pt-2 border-t border-border-color text-text-dim text-[10px]">
        Klicke auf eine Taste, dann drücke die neue Tastenkombination. ↺ stellt den Standard wieder her.
      </div>
    </div>
  );
}

/**
 * Read-Only-Sektion am Ende des Panels: zeigt alle Scripts mit gebundenem
 * keyBinding. Klick navigiert zum Tools-Tab und selektiert das Skript via
 * `ss:navigate`-CustomEvent (App.tsx muss diesen handhaben).
 */
function ScriptBindingsSection({ scripts }: { scripts: Script[] }) {
  const withBinding = scripts.filter((s) => s.keyBinding !== undefined);

  const handleEdit = useCallback((scriptId: string) => {
    window.dispatchEvent(
      new CustomEvent("ss:navigate", {
        detail: { tab: "tools", scriptId },
      }),
    );
  }, []);

  if (withBinding.length === 0) {
    return (
      <div className="mb-4">
        <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2 border-b border-border-color pb-1">
          Scripts
        </div>
        <div className="text-text-dim text-[11px] px-2 py-1">
          Keine Skripte mit Tastenkürzel vorhanden. Lege ein Tastenkürzel im Script Runner (Tab Tools) an.
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2 border-b border-border-color pb-1">
        Scripts
      </div>
      <div className="space-y-1">
        {withBinding.map((s) => {
          const combo = s.keyBinding!;
          const label = scriptComboToLabel(combo);
          const disabled = !s.enabled;
          return (
            <button
              key={s.id}
              onClick={() => handleEdit(s.id)}
              title="Im Script Runner bearbeiten"
              className="w-full flex items-center gap-3 px-2 py-1.5 rounded hover:bg-bg-elevated transition-colors text-left"
            >
              <span className={`flex-1 truncate ${disabled ? "text-text-dim italic" : "text-text-muted"}`}>
                {s.name}
                {disabled && <span className="ml-2 text-[9px]">(deaktiviert)</span>}
              </span>
              <span
                className={[
                  "min-w-[80px] px-2 py-0.5 rounded border font-mono text-[11px] text-center",
                  disabled
                    ? "border-border-color text-text-dim"
                    : "border-accent-secondary text-accent-secondary",
                ].join(" ")}
              >
                {label}
              </span>
              <span className="text-[10px] text-text-dim w-5 text-center" aria-hidden="true">
                →
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-text-dim px-2">
        Konflikt-Regel: Wenn ein Skript-Kürzel dieselbe Tastenkombination wie eine Aktion oben verwendet, gewinnt die Aktion.
      </div>
    </div>
  );
}
