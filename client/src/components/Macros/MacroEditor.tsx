/**
 * Synthstudio – MacroEditor (v3.68.0)
 *
 * Modal/Panel zum Editieren der Quick-Action Macros (useQuickActionStore).
 *
 * Aufbau:
 *  - Linke Sidebar: Liste aller Macros + "+ Neu"-Button
 *  - Rechter Pane: Detail-Editor des selektierten Macros
 *      - Name, Description (Textareas)
 *      - Keybind (Capture-Input — nächster Tastendruck wird übernommen)
 *      - Actions-Liste mit Up/Down Reorder + Delete pro Action
 *      - "+ Add Action" Dropdown mit allen Action-Kinds
 *      - "▶ Test Macro" Button (executeQuickActionMacro)
 *
 * Theming: nur semantische Tailwind-Klassen (`bg-bg-panel`, `text-text-primary`
 * etc.) wie in CLAUDE.md vorgeschrieben.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Trash2, Play, ChevronUp, ChevronDown, X } from "lucide-react";
import {
  useQuickActionStore,
  addQuickActionMacro,
  updateQuickActionMacro,
  removeQuickActionMacro,
  reorderQuickActionMacro,
  eventToKeybind,
  normalizeKeybind,
  QUICK_ACTION_KINDS,
  type QuickActionMacro,
  type QuickActionMacroAction,
  type QuickActionKind,
} from "@/store/useQuickActionStore";
import {
  executeQuickActionMacro,
  type QuickActionContext,
} from "@/utils/quickActionExecutor";

interface MacroEditorProps {
  open: boolean;
  onClose: () => void;
  /**
   * Optionaler Kontext zum Testen der Macros direkt aus dem Editor.
   * Wenn fehlt → "Test"-Button ist disabled.
   */
  testContext?: QuickActionContext;
}

const ACTION_KIND_LABELS: Record<QuickActionKind, string> = {
  "mute-all-drum-parts": "Mute alle Drum-Parts",
  "set-channel-volume":  "Channel Volume setzen",
  "set-channel-pan":     "Channel Pan setzen",
  "set-channel-mute":    "Channel Mute",
  "switch-pattern":      "Pattern wechseln",
  "set-bpm":             "BPM setzen",
  "trigger-scene":       "Scene triggern",
  "play-pad":            "Pad spielen",
  "set-master-volume":   "Master Volume setzen",
  "delay":               "Delay (ms)",
};

/** Erzeugt eine neue Default-Action für den gegebenen Kind. */
function defaultActionForKind(kind: QuickActionKind): QuickActionMacroAction {
  switch (kind) {
    case "mute-all-drum-parts": return { kind, value: true };
    case "set-channel-volume":  return { kind, channelId: "", value: 0.8 };
    case "set-channel-pan":     return { kind, channelId: "", value: 0 };
    case "set-channel-mute":    return { kind, channelId: "", value: true };
    case "switch-pattern":      return { kind, patternId: "" };
    case "set-bpm":             return { kind, bpm: 120 };
    case "trigger-scene":       return { kind, sceneIndex: 0 };
    case "play-pad":            return { kind, padIndex: 0 };
    case "set-master-volume":   return { kind, value: 0.8 };
    case "delay":               return { kind, ms: 100 };
  }
}

export function MacroEditor({ open, onClose, testContext }: MacroEditorProps) {
  const { macros } = useQuickActionStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keybindRecording, setKeybindRecording] = useState(false);

  // Auto-select first macro
  useEffect(() => {
    if (open && !selectedId && macros.length > 0) {
      setSelectedId(macros[0].id);
    }
  }, [open, macros, selectedId]);

  const selectedMacro: QuickActionMacro | null = useMemo(
    () => macros.find((m) => m.id === selectedId) ?? null,
    [macros, selectedId],
  );

  // Capture next key-press for keybind input
  useEffect(() => {
    if (!keybindRecording || !selectedMacro) return;

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setKeybindRecording(false);
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const keybind = eventToKeybind(e);
      updateQuickActionMacro(selectedMacro.id, { keybind });
      setKeybindRecording(false);
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [keybindRecording, selectedMacro]);

  const handleAddMacro = useCallback(() => {
    const created = addQuickActionMacro({ name: "Neues Macro", actions: [] });
    setSelectedId(created.id);
  }, []);

  const handleRemoveMacro = useCallback((id: string) => {
    if (!confirm("Dieses Macro wirklich löschen?")) return;
    removeQuickActionMacro(id);
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const handleAddAction = useCallback((kind: QuickActionKind) => {
    if (!selectedMacro) return;
    const next = [...selectedMacro.actions, defaultActionForKind(kind)];
    updateQuickActionMacro(selectedMacro.id, { actions: next });
  }, [selectedMacro]);

  const handleRemoveAction = useCallback((idx: number) => {
    if (!selectedMacro) return;
    const next = selectedMacro.actions.filter((_, i) => i !== idx);
    updateQuickActionMacro(selectedMacro.id, { actions: next });
  }, [selectedMacro]);

  const handleUpdateAction = useCallback((idx: number, patch: Partial<QuickActionMacroAction>) => {
    if (!selectedMacro) return;
    const next = selectedMacro.actions.map((a, i) => {
      if (i !== idx) return a;
      // We rely on the discriminated kind staying stable — patch must NOT
      // change `kind`. Cast through unknown is the typescript-safe way.
      return { ...a, ...patch } as QuickActionMacroAction;
    });
    updateQuickActionMacro(selectedMacro.id, { actions: next });
  }, [selectedMacro]);

  const handleMoveAction = useCallback((idx: number, dir: -1 | 1) => {
    if (!selectedMacro) return;
    reorderQuickActionMacro(selectedMacro.id, idx, idx + dir);
  }, [selectedMacro]);

  const handleTest = useCallback(() => {
    if (!selectedMacro || !testContext) return;
    void executeQuickActionMacro(selectedMacro, testContext);
  }, [selectedMacro, testContext]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-label="Quick-Action Macros"
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-2xl w-[min(1100px,95vw)] h-[min(700px,90vh)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-color">
          <h2 className="text-lg font-semibold text-text-primary">
            Quick-Action Macros
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <aside className="w-64 border-r border-border-color flex flex-col bg-bg-base">
            <div className="p-3 border-b border-border-color">
              <button
                onClick={handleAddMacro}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent-primary text-bg-base rounded font-medium hover:opacity-90 transition-opacity"
              >
                <Plus size={16} />
                <span>Neues Macro</span>
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto">
              {macros.length === 0 && (
                <li className="px-4 py-6 text-sm text-text-dim text-center">
                  Noch keine Macros.
                </li>
              )}
              {macros.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => setSelectedId(m.id)}
                    className={`w-full text-left px-4 py-3 border-b border-border-subtle hover:bg-bg-elevated transition-colors ${
                      selectedId === m.id ? "bg-bg-elevated" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-text-primary truncate">
                        {m.name}
                      </span>
                      {m.keybind && (
                        <span className="text-xs text-accent-secondary font-mono shrink-0">
                          {m.keybind}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-dim mt-0.5">
                      {m.actions.length} Action{m.actions.length === 1 ? "" : "s"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Detail-Pane */}
          <section className="flex-1 overflow-y-auto p-6">
            {!selectedMacro ? (
              <div className="text-text-dim text-sm text-center mt-10">
                Wähle ein Macro aus der Liste oder lege ein neues an.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Toolbar */}
                <div className="flex items-center justify-between">
                  <input
                    type="text"
                    value={selectedMacro.name}
                    onChange={(e) => updateQuickActionMacro(selectedMacro.id, { name: e.target.value })}
                    className="text-xl font-semibold bg-transparent text-text-primary border-b border-transparent focus:border-accent-primary outline-none flex-1 mr-4"
                    placeholder="Macro-Name"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleTest}
                      disabled={!testContext}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-accent-success text-bg-base rounded font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                      title={testContext ? "Macro jetzt ausführen" : "Test-Kontext nicht verfügbar"}
                    >
                      <Play size={14} />
                      Test
                    </button>
                    <button
                      onClick={() => handleRemoveMacro(selectedMacro.id)}
                      className="p-1.5 text-accent-danger hover:bg-bg-elevated rounded transition-colors"
                      aria-label="Macro löschen"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs text-text-muted uppercase tracking-wide mb-1">
                    Beschreibung
                  </label>
                  <textarea
                    value={selectedMacro.description ?? ""}
                    onChange={(e) =>
                      updateQuickActionMacro(selectedMacro.id, { description: e.target.value || undefined })
                    }
                    className="w-full bg-bg-elevated text-text-primary border border-border-color rounded px-3 py-2 text-sm resize-none focus:border-accent-primary outline-none"
                    rows={2}
                    placeholder="Optional: Was tut dieses Macro?"
                  />
                </div>

                {/* Keybind */}
                <div>
                  <label className="block text-xs text-text-muted uppercase tracking-wide mb-1">
                    Tastatur-Shortcut
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setKeybindRecording((v) => !v)}
                      className={`px-3 py-2 rounded text-sm font-mono border transition-colors ${
                        keybindRecording
                          ? "bg-accent-danger text-bg-base border-accent-danger"
                          : "bg-bg-elevated text-text-primary border-border-color hover:border-accent-primary"
                      }`}
                    >
                      {keybindRecording
                        ? "Drücke eine Taste… (Esc = Abbruch)"
                        : selectedMacro.keybind ?? "Keine Bindung"}
                    </button>
                    {selectedMacro.keybind && !keybindRecording && (
                      <button
                        onClick={() => updateQuickActionMacro(selectedMacro.id, { keybind: undefined })}
                        className="text-xs text-text-muted hover:text-accent-danger"
                      >
                        Entfernen
                      </button>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-text-muted uppercase tracking-wide">
                      Actions ({selectedMacro.actions.length})
                    </label>
                    <AddActionDropdown onAdd={handleAddAction} />
                  </div>
                  <ul className="space-y-2">
                    {selectedMacro.actions.length === 0 && (
                      <li className="text-sm text-text-dim italic p-3 border border-dashed border-border-color rounded">
                        Noch keine Actions. Füge oben rechts welche hinzu.
                      </li>
                    )}
                    {selectedMacro.actions.map((action, idx) => (
                      <li
                        key={idx}
                        className="bg-bg-elevated border border-border-color rounded p-3 flex items-start gap-3"
                      >
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleMoveAction(idx, -1)}
                            disabled={idx === 0}
                            className="text-text-muted hover:text-accent-primary disabled:opacity-30"
                            aria-label="Nach oben"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={() => handleMoveAction(idx, 1)}
                            disabled={idx === selectedMacro.actions.length - 1}
                            className="text-text-muted hover:text-accent-primary disabled:opacity-30"
                            aria-label="Nach unten"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-text-primary mb-1.5">
                            {ACTION_KIND_LABELS[action.kind]}
                          </div>
                          <ActionFields
                            action={action}
                            onChange={(patch) => handleUpdateAction(idx, patch)}
                          />
                        </div>
                        <button
                          onClick={() => handleRemoveAction(idx)}
                          className="text-accent-danger hover:bg-bg-base rounded p-1"
                          aria-label="Action löschen"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── AddActionDropdown ───────────────────────────────────────────────────────

function AddActionDropdown({ onAdd }: { onAdd: (kind: QuickActionKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-primary text-bg-base rounded font-medium hover:opacity-90 transition-opacity"
      >
        <Plus size={14} />
        Action hinzufügen
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-10 bg-bg-panel border border-border-color rounded shadow-xl w-64"
          onMouseLeave={() => setOpen(false)}
        >
          <ul>
            {QUICK_ACTION_KINDS.map((kind) => (
              <li key={kind}>
                <button
                  onClick={() => { onAdd(kind); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-elevated transition-colors"
                >
                  {ACTION_KIND_LABELS[kind]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── ActionFields (per-Kind Inputs) ──────────────────────────────────────────

interface ActionFieldsProps {
  action: QuickActionMacroAction;
  onChange: (patch: Partial<QuickActionMacroAction>) => void;
}

function ActionFields({ action, onChange }: ActionFieldsProps) {
  switch (action.kind) {
    case "mute-all-drum-parts":
    case "set-channel-mute":
      return (
        <div className="flex items-center gap-3">
          {action.kind === "set-channel-mute" && (
            <input
              type="text"
              placeholder="Channel-ID"
              value={action.channelId}
              onChange={(e) => onChange({ channelId: e.target.value } as Partial<QuickActionMacroAction>)}
              className="bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs flex-1"
            />
          )}
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={action.value}
              onChange={(e) => onChange({ value: e.target.checked } as Partial<QuickActionMacroAction>)}
            />
            Mute
          </label>
        </div>
      );
    case "set-channel-volume":
    case "set-channel-pan":
      return (
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Channel-ID"
            value={action.channelId}
            onChange={(e) => onChange({ channelId: e.target.value } as Partial<QuickActionMacroAction>)}
            className="bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs flex-1"
          />
          <input
            type="number"
            step="0.01"
            value={action.value}
            onChange={(e) => onChange({ value: Number(e.target.value) } as Partial<QuickActionMacroAction>)}
            className="bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs w-24"
          />
        </div>
      );
    case "switch-pattern":
      return (
        <input
          type="text"
          placeholder="Pattern-ID"
          value={action.patternId}
          onChange={(e) => onChange({ patternId: e.target.value } as Partial<QuickActionMacroAction>)}
          className="w-full bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs"
        />
      );
    case "set-bpm":
      return (
        <input
          type="number"
          min={20}
          max={300}
          value={action.bpm}
          onChange={(e) => onChange({ bpm: Number(e.target.value) } as Partial<QuickActionMacroAction>)}
          className="bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs w-32"
        />
      );
    case "trigger-scene":
    case "play-pad":
      return (
        <input
          type="number"
          min={0}
          max={31}
          value={action.kind === "trigger-scene" ? action.sceneIndex : action.padIndex}
          onChange={(e) =>
            onChange(
              action.kind === "trigger-scene"
                ? ({ sceneIndex: Number(e.target.value) } as Partial<QuickActionMacroAction>)
                : ({ padIndex: Number(e.target.value) } as Partial<QuickActionMacroAction>)
            )
          }
          className="bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs w-24"
        />
      );
    case "set-master-volume":
      return (
        <input
          type="number"
          step="0.01"
          min={0}
          max={1}
          value={action.value}
          onChange={(e) => onChange({ value: Number(e.target.value) } as Partial<QuickActionMacroAction>)}
          className="bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs w-24"
        />
      );
    case "delay":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={10000}
            value={action.ms}
            onChange={(e) => onChange({ ms: Number(e.target.value) } as Partial<QuickActionMacroAction>)}
            className="bg-bg-base text-text-primary border border-border-color rounded px-2 py-1 text-xs w-24"
          />
          <span className="text-xs text-text-dim">ms</span>
        </div>
      );
  }
  // Reachability check
  const _exhaustive: never = action;
  void _exhaustive;
  return null;
}

// keep keybind normalize util available alongside (for tests)
export { normalizeKeybind };
