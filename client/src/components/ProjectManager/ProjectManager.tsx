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
import React, { useCallback, useState } from "react";

import { useElectron } from "../../../../electron/useElectron";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ProjectManagerProps {
  projectName: string;
  isDirty: boolean;
  onSave: () => void;
  onLoad: () => void;
  onNew: () => void;
  onExport: () => void;
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function ProjectManager({
  projectName,
  isDirty,
  onSave,
  onLoad,
  onNew,
  onExport,
}: ProjectManagerProps) {
  // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
  const electron = useElectron();

  const [isSaving, setIsSaving] = useState(false);

  // ── Speichern ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      if (electron.isElectron) {
        // In Electron: nativer Speichern-Dialog über saveFileDialog
        const result = await electron.saveFileDialog({
          title: "Projekt speichern",
          defaultPath: `${projectName}.esx1`,
          filters: [
            { name: "Synthstudio-Projekte", extensions: ["esx1"] },
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
        // Browser-Fallback: window.confirm
        const confirmed = window.confirm(
          `"${projectName}" hat ungespeicherte Änderungen. Verwerfen?`
        );
        if (!confirmed) return;
      }
    }
    onNew();
  }, [electron, isDirty, projectName, onNew, handleSave]);

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
        className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-slate-200 transition-colors duration-100"
      >
        Neu
      </button>

      {/* Öffnen */}
      <button
        onClick={onLoad}
        title={electron.isElectron ? "Projekt öffnen – nativer Dialog (Ctrl+O)" : "Projekt öffnen (Ctrl+O)"}
        className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-slate-200 transition-colors duration-100"
      >
        Öffnen
      </button>

      {/* Speichern */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        title={electron.isElectron ? "Projekt speichern – nativer Dialog (Ctrl+S)" : "Projekt speichern (Ctrl+S)"}
        className={[
          "px-2 py-1 text-xs rounded border transition-colors duration-100",
          isDirty
            ? "bg-cyan-900/40 text-cyan-400 border-cyan-800 hover:bg-cyan-800/60 hover:text-cyan-300"
            : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200",
          isSaving ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        {isSaving ? "..." : "Speichern"}
      </button>

      {/* Exportieren */}
      <button
        onClick={handleExport}
        title={electron.isElectron ? "Projekt exportieren – nativer Dialog (Ctrl+E)" : "Projekt exportieren (Ctrl+E)"}
        className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-slate-200 transition-colors duration-100"
      >
        Export
      </button>
    </div>
  );
}

export default ProjectManager;
