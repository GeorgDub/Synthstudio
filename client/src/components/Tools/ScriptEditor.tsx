/**
 * Synthstudio – ScriptEditor (sub-component of ScriptRunner)
 *
 * Editor + Bindings + Konsole für ein einzelnes Skript.
 *
 * Features:
 *   - Code-Editor (textarea) mit Auto-Save onBlur + Ctrl+S
 *   - Name-Input mit Save-Button
 *   - Enabled-Toggle, Scope-Toggle (App / Project)
 *   - KeyBinding-Recording (inline, Esc zum Abbrechen)
 *   - Macro-Slot-Dropdown mit Konflikt-Warnung
 *   - Konsole mit Live-Log-Stream
 *   - Validation-Errors als rote Inline-Anzeige
 *   - Code-Size-Counter (Byte/10000)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, Pencil, X } from "lucide-react";
import type {
  Script,
  KeyCombo,
  ScriptScope,
} from "@/store/useScriptStore";
import { MAX_SCRIPT_CODE_BYTES } from "@/store/useScriptStore";
import type { SandboxLogEntry, SandboxRunResult } from "@/sandbox/useScriptSandbox";
import {
  eventToScriptCombo,
  findKeyConflict,
} from "@/hooks/useScriptKeyBindings";
import { eventToCombo as eventToActionCombo } from "@/hooks/keyboardActionDefs";
import { getAllBindings } from "@/store/useKeyboardBindingsStore";
import { ACTIONS } from "@/hooks/keyboardActionDefs";

// ─── Beispiel-Snippets ───────────────────────────────────────────────────────

export const SCRIPT_EXAMPLES: ReadonlyArray<{
  id: string;
  name: string;
  code: string;
}> = [
  {
    id: "bpm-ramp",
    name: "BPM Ramp Up",
    code: `// BPM Ramp: 100 → 140 in 1-Sekunden-Schritten
for (let bpm = 100; bpm <= 140; bpm += 5) {
  await ss.bpm(bpm);
  await ss.log("BPM: " + bpm);
  await ss.wait(1000);
}
await ss.log("Ramp complete.");
`,
  },
  {
    id: "random-fill",
    name: "Random Pattern Fill",
    code: `// Zufallsverteilung — randomisiert das aktuelle Pattern
await ss.dispatch("pattern-randomize");
await ss.log("Pattern randomisiert.");
`,
  },
  {
    id: "drop-hit",
    name: "Drop Hit",
    code: `// Stop, kurz warten, dann wieder anschalten — klassischer Drop
await ss.stop();
await ss.log("Drop in 500ms…");
await ss.wait(500);
await ss.play();
await ss.log("Drop!");
`,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function comboToScriptLabel(c: KeyCombo): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta) parts.push("Meta");
  const key = c.key.length === 1 ? c.key.toUpperCase() : c.key;
  parts.push(key);
  return parts.join("+");
}

function statusLabel(s: SandboxRunResult["status"]): { text: string; cls: string } {
  switch (s) {
    case "success":
      return { text: "erfolgreich", cls: "text-accent-success" };
    case "error":
      return { text: "Fehler", cls: "text-accent-danger" };
    case "timeout":
      return { text: "Timeout", cls: "text-accent-danger" };
    case "aborted":
      return { text: "abgebrochen", cls: "text-text-muted" };
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface ScriptEditorProps {
  script: Script;
  running: boolean;
  logs: SandboxLogEntry[];
  runStatus: SandboxRunResult["status"] | null;
  runMessage: string | undefined;
  runDuration: number | null;
  validationErrors: string[];
  macroSlotConflict: (idx: number) => string | null;
  allScripts: Script[];
  onUpdate: (patch: Partial<Omit<Script, "id" | "createdAt">>) => void;
  onRun: () => void;
  onAbort: () => void;
}

export function ScriptEditor({
  script,
  running,
  logs,
  runStatus,
  runMessage,
  runDuration,
  validationErrors,
  macroSlotConflict,
  allScripts,
  onUpdate,
  onRun,
  onAbort,
}: ScriptEditorProps) {
  // ─── Local form state (mirrors script, edited per-field) ──────────────────
  const [nameDraft, setNameDraft] = useState(script.name);
  const [codeDraft, setCodeDraft] = useState(script.code);
  const [recording, setRecording] = useState(false);
  const [keyConflict, setKeyConflict] = useState<string | null>(null);

  // Wenn die Selection wechselt (neues Script), Drafts zurücksetzen.
  const lastIdRef = useRef(script.id);
  useEffect(() => {
    if (lastIdRef.current !== script.id) {
      lastIdRef.current = script.id;
      setNameDraft(script.name);
      setCodeDraft(script.code);
      setKeyConflict(null);
      setRecording(false);
    }
  }, [script.id, script.name, script.code]);

  // ─── Code-Editor Auto-Save (onBlur + Ctrl+S) ──────────────────────────────
  const codeRef = useRef<HTMLTextAreaElement | null>(null);

  const saveCode = useCallback(() => {
    if (codeDraft !== script.code) {
      onUpdate({ code: codeDraft });
    }
  }, [codeDraft, script.code, onUpdate]);

  const saveName = useCallback(() => {
    const trimmed = nameDraft.trim();
    if (trimmed.length === 0) {
      // Reset, leerer Name ist nicht erlaubt (validation würde failen)
      setNameDraft(script.name);
      return;
    }
    if (trimmed !== script.name) {
      onUpdate({ name: trimmed });
    }
  }, [nameDraft, script.name, onUpdate]);

  const handleCodeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+S → save (preventDefault, NICHT global)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCode();
        return;
      }
      // Tab in textarea → 2 spaces einfügen (nicht Focus wegspringen)
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = codeDraft.slice(0, start) + "  " + codeDraft.slice(end);
        setCodeDraft(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [codeDraft, saveCode],
  );

  // ─── Key-Binding Recording ────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    setRecording(true);
    setKeyConflict(null);
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" || e.key === "Escape") {
        stopRecording();
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      const scriptCombo = eventToScriptCombo(e);
      const actionCombo = eventToActionCombo(e);
      const conflict = findKeyConflict(
        actionCombo,
        scriptCombo,
        allScripts.filter((s) => s.id !== script.id),
        getAllBindings(),
      );

      if (conflict) {
        if (conflict.kind === "action") {
          const a = ACTIONS.find((x) => x.id === conflict.id);
          setKeyConflict(
            `Konflikt mit Standard-Action: ${a?.label ?? conflict.id}. Skript würde nicht feuern.`,
          );
        } else {
          const other = allScripts.find((s) => s.id === conflict.id);
          setKeyConflict(
            `Konflikt mit Skript "${other?.name ?? "?"}". Diese Combo ist bereits belegt.`,
          );
        }
      } else {
        setKeyConflict(null);
      }
      onUpdate({ keyBinding: scriptCombo });
      stopRecording();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [recording, allScripts, script.id, onUpdate, stopRecording]);

  const clearKeyBinding = useCallback(() => {
    onUpdate({ keyBinding: undefined });
    setKeyConflict(null);
  }, [onUpdate]);

  // ─── Macro-Slot dropdown ─────────────────────────────────────────────────
  const handleMacroChange = useCallback(
    (raw: string) => {
      if (raw === "none") {
        onUpdate({ macroButtonIndex: undefined });
      } else {
        const idx = Number.parseInt(raw, 10);
        if (Number.isInteger(idx) && idx >= 0 && idx <= 7) {
          onUpdate({ macroButtonIndex: idx });
        }
      }
    },
    [onUpdate],
  );

  // ─── Live byte counter (basiert auf draft, NICHT auf persisted code) ─────
  const codeByteLen = useMemo(() => {
    try {
      return new TextEncoder().encode(codeDraft).length;
    } catch {
      return codeDraft.length;
    }
  }, [codeDraft]);

  // ─── Render ──────────────────────────────────────────────────────────────
  const overByteLimit = codeByteLen > MAX_SCRIPT_CODE_BYTES;
  const currentMacroConflict =
    typeof script.macroButtonIndex === "number"
      ? macroSlotConflict(script.macroButtonIndex)
      : null;

  return (
    <div
      className="h-full flex flex-col p-4 gap-3 overflow-y-auto"
      data-testid="script-editor"
    >
      {/* Toolbar: Run / Abort */}
      <div className="flex items-center gap-2 flex-wrap">
        {running ? (
          <button
            type="button"
            onClick={onAbort}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-accent-danger text-white font-medium hover:opacity-80"
            data-testid="script-abort"
          >
            <Square className="w-3 h-3" />
            Abbrechen
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            disabled={validationErrors.length > 0}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
              validationErrors.length > 0
                ? "bg-bg-elevated text-text-dim cursor-not-allowed"
                : "bg-accent-success text-white hover:opacity-80"
            }`}
            data-testid="script-run"
          >
            <Play className="w-3 h-3" />
            Ausführen
          </button>
        )}
        {runStatus && (
          <span
            className={`text-[11px] ${statusLabel(runStatus).cls}`}
            data-testid="script-run-status"
          >
            {statusLabel(runStatus).text}
            {runDuration !== null && ` (${(runDuration / 1000).toFixed(2)}s)`}
            {runMessage && `: ${runMessage}`}
          </span>
        )}
      </div>

      {/* Name + Enabled + Scope */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-text-dim min-w-[3rem]">Name:</label>
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={saveName}
          className="flex-1 min-w-[200px] px-2 py-1 text-xs rounded bg-bg-elevated border border-border-color text-text-primary focus:border-accent-primary outline-none"
          data-testid="script-name-input"
        />
        <button
          type="button"
          onClick={saveName}
          className="px-2 py-1 text-[11px] rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary hover:border-accent-primary"
          data-testid="script-name-save"
        >
          Save
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={script.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="accent-accent-primary"
            data-testid="script-enabled-toggle"
          />
          Aktiviert
        </label>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-dim">Scope:</span>
          <label className="flex items-center gap-1 text-[11px] text-text-muted cursor-pointer">
            <input
              type="radio"
              name={`scope-${script.id}`}
              checked={script.scope === "app"}
              onChange={() => onUpdate({ scope: "app" as ScriptScope })}
              className="accent-accent-primary"
              data-testid="script-scope-app"
            />
            App
          </label>
          <label className="flex items-center gap-1 text-[11px] text-text-muted cursor-pointer">
            <input
              type="radio"
              name={`scope-${script.id}`}
              checked={script.scope === "project"}
              onChange={() => onUpdate({ scope: "project" as ScriptScope })}
              className="accent-accent-primary"
              data-testid="script-scope-project"
            />
            Projekt
          </label>
        </div>
      </div>

      {/* Key-Binding */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-dim min-w-[5.5rem]">Keyboard:</span>
        <span
          className={`min-w-[100px] px-2 py-0.5 rounded border font-mono text-[11px] text-center ${
            recording
              ? "border-accent-primary text-accent-primary animate-pulse"
              : script.keyBinding
                ? "border-accent-secondary text-accent-secondary"
                : "border-border-color text-text-dim"
          }`}
          data-testid="script-key-display"
        >
          {recording
            ? "Taste drücken… (Esc abbrechen)"
            : script.keyBinding
              ? comboToScriptLabel(script.keyBinding)
              : "(keine Bindung)"}
        </span>
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary hover:border-accent-primary"
          aria-label={recording ? "Cancel recording" : "Record key combo"}
          data-testid="script-key-edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
        {script.keyBinding && (
          <button
            type="button"
            onClick={clearKeyBinding}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-bg-elevated border border-border-color text-text-muted hover:text-accent-danger hover:border-accent-danger"
            aria-label="Clear key binding"
            data-testid="script-key-clear"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {keyConflict && (
          <span
            className="text-[10px] text-accent-danger flex-1 min-w-[200px]"
            data-testid="script-key-conflict"
          >
            ⚠ {keyConflict}
          </span>
        )}
      </div>

      {/* Macro-Slot */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-dim min-w-[5.5rem]">Macro-Slot:</span>
        <select
          value={
            typeof script.macroButtonIndex === "number"
              ? String(script.macroButtonIndex)
              : "none"
          }
          onChange={(e) => handleMacroChange(e.target.value)}
          className="px-2 py-1 text-[11px] rounded bg-bg-elevated border border-border-color text-text-primary focus:border-accent-primary outline-none"
          data-testid="script-macro-select"
        >
          <option value="none">kein</option>
          {Array.from({ length: 8 }, (_, i) => (
            <option key={i} value={i}>
              Slot {i}
            </option>
          ))}
        </select>
        {currentMacroConflict && (
          <span
            className="text-[10px] text-accent-danger"
            data-testid="script-macro-conflict"
          >
            ⚠ Slot ist bereits an „{currentMacroConflict}" gebunden
          </span>
        )}
      </div>

      {/* Code Editor */}
      <div className="flex-1 flex flex-col min-h-[180px]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-text-dim">
            Code <span className="text-text-dim">(JavaScript, max 10 KB)</span>
          </span>
          <span
            className={`text-[10px] font-mono ${
              overByteLimit ? "text-accent-danger" : "text-text-dim"
            }`}
            data-testid="script-code-size"
          >
            {codeByteLen} / {MAX_SCRIPT_CODE_BYTES} Bytes
          </span>
        </div>
        <textarea
          ref={codeRef}
          value={codeDraft}
          onChange={(e) => setCodeDraft(e.target.value)}
          onBlur={saveCode}
          onKeyDown={handleCodeKeyDown}
          spellCheck={false}
          placeholder="// Skriptcode hier eingeben…"
          className="flex-1 w-full font-mono text-xs bg-bg-base text-text-primary border border-border-color rounded p-3 resize-none focus:border-accent-primary outline-none"
          style={{ tabSize: 2, minHeight: 160 }}
          data-testid="script-code-editor"
        />
        {validationErrors.length > 0 && (
          <div
            className="mt-1 px-2 py-1 text-[10px] text-accent-danger bg-accent-danger/10 border border-accent-danger/40 rounded"
            data-testid="script-validation-errors"
          >
            <strong>Validierung fehlgeschlagen:</strong>{" "}
            {validationErrors.join("; ")}
          </div>
        )}
      </div>

      {/* Konsole */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-text-dim uppercase tracking-widest">
            Konsole
          </span>
          {logs.length > 0 && (
            <span className="text-[10px] text-text-dim">
              {logs.length} Eintr{logs.length === 1 ? "ag" : "äge"}
            </span>
          )}
        </div>
        <div
          className="font-mono text-[10px] bg-bg-base border border-border-color rounded p-2 max-h-32 overflow-y-auto space-y-0.5"
          data-testid="script-console"
        >
          {logs.length === 0 ? (
            <div className="text-text-dim italic">
              Noch keine Ausgabe. Klicke auf „Ausführen" um das Skript zu starten.
            </div>
          ) : (
            logs.map((entry, i) => {
              const cls =
                entry.type === "error"
                  ? "text-accent-danger"
                  : entry.type === "system"
                    ? "text-text-dim italic"
                    : "text-text-primary";
              const prefix =
                entry.type === "error" ? "✗ " : entry.type === "system" ? "• " : "→ ";
              return (
                <div key={i} className={cls}>
                  {prefix}
                  {entry.message}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
