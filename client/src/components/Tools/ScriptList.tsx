/**
 * Synthstudio – ScriptList (sub-component of ScriptRunner)
 *
 * Linke Sidebar mit:
 *   - Scriptliste (Name + Indikatoren für KeyBinding/Macro/Disabled)
 *   - Beispiele-Dropdown ("aus Vorlage anlegen")
 */
import { useState } from "react";
import { Trash2, KeyRound } from "lucide-react";
import type { Script } from "@/store/useScriptStore";
import { SCRIPT_EXAMPLES } from "./ScriptEditor";

interface ScriptListProps {
  scripts: Script[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAddFromExample: (example: { name: string; code: string }) => void;
}

export function ScriptList({
  scripts,
  selectedId,
  onSelect,
  onDelete,
  onAddFromExample,
}: ScriptListProps) {
  const [exampleOpen, setExampleOpen] = useState(false);

  return (
    <aside
      className="w-56 flex-shrink-0 flex flex-col bg-bg-base border-r border-border-color overflow-hidden"
      data-testid="script-list"
    >
      <div className="px-3 py-2 border-b border-border-color">
        <span className="text-[10px] text-text-dim uppercase tracking-widest">
          Scripts ({scripts.length})
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scripts.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-text-dim leading-relaxed">
            Noch keine Skripte. Klicke auf
            <span className="text-accent-primary"> + Neu</span> oder lade ein
            Beispiel.
          </div>
        ) : (
          <ul className="py-1">
            {scripts.map((s) => {
              const isSel = s.id === selectedId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    data-testid={`script-list-item-${s.id}`}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors ${
                      isSel
                        ? "bg-bg-elevated text-text-primary border-l-2 border-accent-primary"
                        : "hover:bg-bg-elevated/70 text-text-muted border-l-2 border-transparent"
                    }`}
                  >
                    <span
                      className={`flex-1 truncate ${
                        !s.enabled ? "opacity-50 line-through" : ""
                      }`}
                      title={s.name}
                    >
                      {s.name}
                    </span>
                    {s.keyBinding && (
                      <span
                        className="text-accent-secondary"
                        title="Hat KeyBinding"
                        aria-label="KeyBinding"
                      >
                        <KeyRound className="w-3 h-3" />
                      </span>
                    )}
                    {typeof s.macroButtonIndex === "number" && (
                      <span
                        className="text-[10px] font-mono px-1 rounded border border-border-color text-text-muted"
                        title={`Macro-Slot ${s.macroButtonIndex}`}
                      >
                        M{s.macroButtonIndex}
                      </span>
                    )}
                    <span
                      role="button"
                      aria-label={`Delete ${s.name}`}
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onDelete(s.id);
                        }
                      }}
                      className="text-text-dim hover:text-accent-danger transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Beispiele */}
      <div className="border-t border-border-color px-2 py-2">
        <button
          type="button"
          onClick={() => setExampleOpen((v) => !v)}
          className="w-full flex items-center justify-between px-2 py-1 text-[11px] text-text-muted hover:text-text-primary rounded hover:bg-bg-elevated/50"
          data-testid="script-examples-toggle"
        >
          <span className="uppercase tracking-widest">Beispiele</span>
          <span className="text-text-dim">{exampleOpen ? "▴" : "▾"}</span>
        </button>
        {exampleOpen && (
          <ul className="mt-1 space-y-0.5">
            {SCRIPT_EXAMPLES.map((ex) => (
              <li key={ex.name}>
                <button
                  type="button"
                  onClick={() => onAddFromExample(ex)}
                  className="w-full text-left px-2 py-1 text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-elevated rounded transition-colors"
                  data-testid={`script-example-${ex.id}`}
                >
                  {ex.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
