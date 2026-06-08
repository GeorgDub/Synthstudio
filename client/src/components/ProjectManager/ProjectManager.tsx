/**
 * Synthstudio – ProjectManager
 *
 * Kompakte Toolbar-Komponente für Projekt-Operationen:
 * Speichern, Laden, Neu, Exportieren.
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Alle Electron-Aufrufe gehen ausschließlich über den useElectron()-Hook.
 * Kein direktes window.electronAPI. Jede Electron-Logik hinter if (electron.isElectron).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useRef, useState } from "react";

import { useElectron } from "../../../../electron/useElectron";
import { importProjectFile, importResultToPatterns, ImportError, type ImportedMelodicPart } from "@/utils/imports";
import { useConfirm } from "@/components/common/ConfirmDialog";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ProjectManagerProps {
  projectName: string;
  isDirty: boolean;
  onSave: () => void;
  onLoad: () => void;
  onNew: () => void;
  onExport: () => void;
  /**
   * Optional: nach erfolgreichem Import von FL Studio / Ableton / Electribe.
   * `melodicParts` ab v1.66 mitgegeben für FLP-MELODIC-ROUTE Phase 2 — der
   * Konsument routet sie via `routeMelodicPartsToPatterns` in den
   * `useMelodicPartStore`.
   */
  onImportPatterns?: (
    patterns: ReturnType<typeof importResultToPatterns>,
    sourceFormat: string,
    melodicParts?: ImportedMelodicPart[],
  ) => void;
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function ProjectManager({
  projectName,
  isDirty,
  onSave,
  onLoad,
  onNew,
  onExport,
  onImportPatterns,
}: ProjectManagerProps) {
  // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
  const electron = useElectron();
  // v3.144+ — Promise-based Confirm-Dialog (replaces window.confirm())
  const confirm = useConfirm();

  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // ── Import (FL Studio / Ableton / Electribe) ──────────────────────────────
  const handleImportFile = useCallback(async (file: File) => {
    setIsImporting(true);
    try {
      const result = await importProjectFile(file);
      const patterns = importResultToPatterns(result);
      const warnings = result.warnings.length > 0
        ? `\n\nHinweise:\n• ${result.warnings.join("\n• ")}`
        : "";
      alert(`Import erfolgreich: ${result.fileName}\nFormat: ${result.sourceFormat.toUpperCase()}\nPatterns: ${patterns.length}\nBPM: ${result.bpm ?? "—"}${warnings}`);
      onImportPatterns?.(patterns, result.sourceFormat, result.melodicParts);
    } catch (err) {
      const msg = err instanceof ImportError
        ? `Import-Fehler (${err.format}): ${err.message}`
        : err instanceof Error ? err.message : "Unbekannter Fehler";
      alert(msg);
    } finally {
      setIsImporting(false);
    }
  }, [onImportPatterns]);

  // ── Speichern ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      if (electron.isElectron) {
        // In Electron: nativer Speichern-Dialog über saveFileDialog
        const result = await electron.saveFileDialog({
          title: "Projekt speichern",
          defaultPath: `${projectName}.synth`,
          filters: [
            { name: "Synthstudio-Projekte", extensions: ["synth"] },
            { name: "JSON", extensions: ["json"] },
          ],
        });
        if (!result.canceled && result.filePath) {
          // Speichern-Logik wird durch IPC-Bridge-Agent implementiert
          onSave();
        }
      } else {
        // Browser-Fallback: direkt speichern (z.B. localStorage)
        onSave();
      }
    } finally {
      setIsSaving(false);
    }
  }, [electron, projectName, onSave]);

  // ── Neu ───────────────────────────────────────────────────────────────────

  const handleNew = useCallback(async () => {
    if (isDirty) {
      if (electron.isElectron) {
        // In Electron: nativer Bestätigungs-Dialog
        const result = await electron.showMessageDialog({
          type: "question",
          title: "Neues Projekt",
          message: "Ungespeicherte Änderungen verwerfen?",
          detail: `"${projectName}" hat ungespeicherte Änderungen.`,
          buttons: ["Verwerfen", "Abbrechen", "Speichern"],
          defaultId: 2,
        });
        if (result.response === 1) return; // Abbrechen
        if (result.response === 2) {
          await handleSave();
        }
      } else {
        // Browser-Fallback: Promise-based Confirm-Dialog
        const confirmed = await confirm({
          title: "Ungespeicherte Änderungen verwerfen?",
          message: `"${projectName}" hat ungespeicherte Änderungen.`,
          confirmLabel: "Verwerfen",
          destructive: true,
        });
        if (!confirmed) return;
      }
    }
    onNew();
  }, [electron, isDirty, projectName, onNew, handleSave, confirm]);

  // ── Exportieren ───────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (electron.isElectron) {
      // In Electron: nativer Speichern-Dialog für Export
      const result = await electron.saveFileDialog({
        title: "Projekt exportieren",
        defaultPath: `${projectName}.wav`,
        filters: [
          { name: "WAV-Audio", extensions: ["wav"] },
          { name: "MIDI", extensions: ["mid", "midi"] },
        ],
      });
      if (!result.canceled) {
        // Export-Logik wird durch Audio-Engine-Agent implementiert
        onExport();
      }
    } else {
      // Browser-Fallback: direkt exportieren
      onExport();
    }
  }, [electron, projectName, onExport]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-1">
      {/* Neu */}
      <button
        onClick={handleNew}
        title="Neues Projekt (Ctrl+N)"
        className="px-2 py-1 text-xs rounded bg-bg-elevated text-text-muted border border-border-color hover:text-text-primary transition-colors duration-100"
      >
        Neu
      </button>

      {/* Öffnen */}
      <button
        onClick={onLoad}
        title={electron.isElectron ? "Projekt öffnen – nativer Dialog (Ctrl+O)" : "Projekt öffnen (Ctrl+O)"}
        className="px-2 py-1 text-xs rounded bg-bg-elevated text-text-muted border border-border-color hover:text-text-primary transition-colors duration-100"
      >
        Öffnen
      </button>

      {/* Import: FL Studio / Ableton / KORG Electribe */}
      <input
        ref={importInputRef}
        type="file"
        accept=".flp,.als,.esx,.elst,.e2spat,.e2sallpat"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = ""; // Reset für erneuten Import derselben Datei
        }}
      />
      <button
        onClick={() => importInputRef.current?.click()}
        disabled={isImporting}
        title="FL Studio (.flp) / Ableton (.als) / KORG Electribe (.esx/.elst) importieren"
        className="px-2 py-1 text-xs rounded bg-bg-elevated text-text-muted border border-border-color hover:text-text-primary transition-colors duration-100 disabled:opacity-50"
      >
        {isImporting ? "Importiere…" : "Import…"}
      </button>

      {/* Speichern */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        title={electron.isElectron ? "Projekt speichern – nativer Dialog (Ctrl+S)" : "Projekt speichern (Ctrl+S)"}
        className={[
          "px-2 py-1 text-xs rounded border transition-colors duration-100",
          isDirty
            ? "bg-accent-primary/40 text-accent-secondary border-accent-primary hover:bg-accent-primary/60 hover:text-accent-secondary"
            : "bg-bg-elevated text-text-muted border-border-color hover:text-text-primary ",
          isSaving ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        {isSaving ? "..." : "Speichern"}
      </button>

      {/* Exportieren */}
      <button
        onClick={handleExport}
        title={electron.isElectron ? "Projekt exportieren – nativer Dialog (Ctrl+E)" : "Projekt exportieren (Ctrl+E)"}
        className="px-2 py-1 text-xs rounded bg-bg-elevated text-text-muted border border-border-color hover:text-text-primary transition-colors duration-100"
      >
        Export
      </button>
    </div>
  );
}

export default ProjectManager;
