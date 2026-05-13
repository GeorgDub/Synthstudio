/**
 * Synthstudio – ScriptRunner (v1.16.0)
 *
 * Refactor: ersetzt den alten `new Function`-Single-Editor durch ein
 * List + Editor Layout mit:
 *   - Sidebar mit persistierter Script-Liste (useScriptStore)
 *   - Editor mit Name, Enabled-Toggle, Scope-Toggle, Key-Binding, Macro-Slot
 *   - Konsole mit Live-Logs aus dem Worker-Sandbox
 *   - Beispiele-Snippets als Quick-Start
 *
 * Sandbox-Integration:
 *   - Modul-Singleton `scriptSandbox` (siehe sandbox/scriptSandboxInstance.ts)
 *   - Bridge wird in einem useEffect via `configureSandboxBridge()` registriert
 *     — alle Setter werden über Refs aktualisiert, damit Closure-Staleness
 *     ausgeschlossen ist.
 *
 * Sicherheit:
 *   - Script-Code wird IMMER im Web-Worker ausgeführt, niemals via `new Function`
 *     im Main-Thread (siehe ScriptSandbox)
 *   - Code-Size hart auf MAX_SCRIPT_CODE_BYTES (10 KB) gekappt — UI zeigt Counter
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useScriptStore,
  validateScript,
  findScriptByMacroIndex,
  type Script,
  MAX_SCRIPT_CODE_BYTES,
  DEFAULT_MAX_RUNTIME_MS,
} from "@/store/useScriptStore";
import { scriptSandbox } from "@/sandbox/scriptSandboxInstance";
import type { SandboxLogEntry, SandboxRunResult } from "@/sandbox/useScriptSandbox";
import { ScriptList } from "./ScriptList";
import { ScriptEditor, SCRIPT_EXAMPLES } from "./ScriptEditor";
import { AiScriptGeneratorDialog } from "./AiScriptGeneratorDialog";

interface ScriptRunnerProps {
  /** Aktueller BPM-Wert (für Anzeige; Sandbox liest via setBpm-Setter). */
  bpm: number;
  /** Ob Transport läuft (für Anzeige). */
  isPlaying: boolean;
  /**
   * Setter für globalen BPM — wird im UI NICHT direkt verwendet, aber als
   * "Living Reference" akzeptiert, weil App.tsx den Sandbox-Bridge zentral
   * via configureSandboxBridge() verdrahtet.
   */
  onBpmChange?: (bpm: number) => void;
  /** Toggle Play/Stop für Transport. Wird ebenfalls über die Bridge gemapped. */
  onPlayStop?: () => void;
  /** Optional: DrumMachine-Store-Referenz (für ScriptEditor / spätere Features). */
  dm?: unknown;
}

export function ScriptRunner({ bpm, isPlaying }: ScriptRunnerProps) {
  const { scripts, addScript, removeScript, updateScript } = useScriptStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<SandboxLogEntry[]>([]);
  const [runStatus, setRunStatus] = useState<SandboxRunResult["status"] | null>(null);
  const [runMessage, setRunMessage] = useState<string | undefined>(undefined);
  const [runDuration, setRunDuration] = useState<number | null>(null);
  // KI-Generator (post-v1.24.0 ROADMAP feature)
  const [aiDialogOpen, setAiDialogOpen] = useState(false);

  // ─── Selected Script & Derivates ──────────────────────────────────────────
  const selectedScript = useMemo<Script | null>(
    () => scripts.find((s) => s.id === selectedId) ?? null,
    [scripts, selectedId],
  );

  // Wenn die Liste leer ist → Selection clearen
  useEffect(() => {
    if (selectedId && !scripts.some((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [scripts, selectedId]);

  // ─── Aktionen: Neu / Auswählen / Löschen / Update ─────────────────────────
  const handleNew = useCallback(() => {
    try {
      const id = addScript({
        name: `Neues Script ${scripts.length + 1}`,
        code: "// Neues Skript — schreibe deinen Code hier\nss.log('Hallo, Welt!');\n",
        scope: "app",
        enabled: true,
        maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      });
      setSelectedId(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLogs((prev) => [
        ...prev,
        { type: "error", message: msg, timestamp: Date.now() },
      ]);
    }
  }, [addScript, scripts.length]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    // Konsole für neue Selection leeren — User soll nicht alte Logs sehen
    setLogs([]);
    setRunStatus(null);
    setRunMessage(undefined);
    setRunDuration(null);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      if (!window.confirm("Skript wirklich löschen?")) return;
      removeScript(id);
      if (selectedId === id) setSelectedId(null);
    },
    [removeScript, selectedId],
  );

  const handleUpdate = useCallback(
    (patch: Partial<Omit<Script, "id" | "createdAt">>) => {
      if (!selectedId) return;
      updateScript(selectedId, patch);
    },
    [selectedId, updateScript],
  );

  const handleAddFromExample = useCallback(
    (example: { name: string; code: string }) => {
      try {
        const id = addScript({
          name: example.name,
          code: example.code,
          scope: "app",
          enabled: true,
          maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
        });
        setSelectedId(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLogs((prev) => [
          ...prev,
          { type: "error", message: msg, timestamp: Date.now() },
        ]);
      }
    },
    [addScript],
  );

  // ─── Run / Abort ──────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!selectedScript || running) return;
    setRunning(true);
    setRunStatus(null);
    setRunMessage(undefined);
    setRunDuration(null);
    setLogs([]);

    const result = await scriptSandbox.run(selectedScript.code, {
      maxRuntimeMs: selectedScript.maxRuntimeMs,
      onLog: (entry) => {
        // Append live
        setLogs((prev) => prev.concat([entry]));
      },
    });
    setRunning(false);
    setRunStatus(result.status);
    setRunMessage(result.message);
    setRunDuration(result.durationMs);
    // Falls onLog im Worker einige Entries verloren hat → finaler State aus result.logs
    setLogs(result.logs);
  }, [selectedScript, running]);

  const handleAbort = useCallback(() => {
    if (!running) return;
    scriptSandbox.abort();
  }, [running]);

  // ─── Validation für Inline-Error ──────────────────────────────────────────
  const validationErrors = useMemo<string[]>(() => {
    if (!selectedScript) return [];
    const check = validateScript(selectedScript);
    return check.ok ? [] : check.errors;
  }, [selectedScript]);

  // ─── Macro-Slot-Konflikt-Detection ────────────────────────────────────────
  const macroSlotConflict = useCallback(
    (idx: number): string | null => {
      if (!selectedScript) return null;
      const found = findScriptByMacroIndex(
        scripts.filter((s) => s.id !== selectedScript.id),
        idx,
      );
      return found ? found.name : null;
    },
    [scripts, selectedScript],
  );

  /** Handler vom KI-Dialog: legt das generierte Skript als neuen Script-Eintrag an + selektiert. */
  const handleAiAccept = useCallback((code: string, suggestedName: string) => {
    try {
      const id = addScript({
        name: suggestedName,
        code,
        scope: "app",
        enabled: true,
        maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
      });
      setSelectedId(id);
      setLogs([]);
      setRunStatus(null);
      setRunMessage(undefined);
      setRunDuration(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLogs((prev) => [
        ...prev,
        { type: "error", message: `KI-Script konnte nicht gespeichert werden: ${msg}`, timestamp: Date.now() },
      ]);
    }
  }, [addScript]);

  return (
    <div
      className="flex flex-col h-full max-h-[80vh] min-h-[480px] rounded-lg border border-border-color bg-bg-panel overflow-hidden"
      data-testid="script-runner"
    >
      {/* Header */}
      <div className="flex items-center px-4 py-2 border-b border-border-color bg-bg-elevated flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-text-primary uppercase tracking-widest">
            Script Runner
          </span>
          <span className="text-[10px] text-text-dim">
            BPM: <span className="text-text-muted">{bpm}</span>
            {" · "}
            {isPlaying ? (
              <span className="text-accent-success">▶ Playing</span>
            ) : (
              <span className="text-text-dim">⏸ Stopped</span>
            )}
          </span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAiDialogOpen(true)}
          className="px-3 py-1 text-xs rounded bg-bg-elevated border border-accent-secondary/40 text-accent-secondary hover:bg-accent-secondary/10 font-medium mr-2"
          data-testid="script-ai-generate"
          title="Skript mit KI generieren (Anthropic API)"
        >
          ✨ KI
        </button>
        <button
          type="button"
          onClick={handleNew}
          className="px-3 py-1 text-xs rounded bg-accent-primary text-white hover:opacity-80 font-medium"
          data-testid="script-add-new"
        >
          + Neu
        </button>
      </div>

      {/* Body: List + Editor */}
      <div className="flex flex-1 overflow-hidden">
        <ScriptList
          scripts={scripts}
          selectedId={selectedId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onAddFromExample={handleAddFromExample}
        />
        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedScript ? (
            <ScriptEditor
              script={selectedScript}
              running={running}
              logs={logs}
              runStatus={runStatus}
              runMessage={runMessage}
              runDuration={runDuration}
              validationErrors={validationErrors}
              macroSlotConflict={macroSlotConflict}
              allScripts={scripts}
              onUpdate={handleUpdate}
              onRun={handleRun}
              onAbort={handleAbort}
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6">
              <div className="text-center max-w-xs">
                <div className="text-text-dim text-xs mb-2 uppercase tracking-widest">
                  Kein Skript ausgewählt
                </div>
                <p className="text-text-muted text-xs leading-relaxed">
                  Wähle ein bestehendes Skript in der Liste oder klicke auf
                  <span className="text-accent-primary font-medium"> + Neu</span>,
                  um ein neues anzulegen.
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={handleNew}
                    className="px-3 py-1 text-xs rounded bg-accent-primary text-white hover:opacity-80"
                  >
                    + Neues Skript erstellen
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KI-Generator Dialog (ROADMAP Phase S — post-v1.24.0) */}
      <AiScriptGeneratorDialog
        isOpen={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        onAccept={handleAiAccept}
      />
    </div>
  );
}

// Re-export for tests / external consumers
export { SCRIPT_EXAMPLES, MAX_SCRIPT_CODE_BYTES };
