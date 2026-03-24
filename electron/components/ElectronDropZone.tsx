/**
 * Synthstudio – ElectronDropZone (Frontend-Agent)
 *
 * Globale Drag & Drop Overlay-Komponente für Electron.
 * Zeigt ein visuelles Feedback wenn Dateien über das Fenster gezogen werden.
 * Im Browser: HTML5 Drag & Drop Fallback.
 *
 * Verwendung:
 * ```tsx
 * <ElectronDropZone
 *   onAudioFiles={(paths) => importSamples(paths)}
 *   onFolder={(path) => importFolder(path)}
 *   onProject={(path) => openProject(path)}
 * />
 * ```
 */
import React, { useState, useEffect, useCallback, useRef } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ElectronDropZoneProps {
  /** Callback wenn Audio-Dateien gedroppt wurden */
  onAudioFiles?: (filePaths: string[]) => void;
  /** Callback wenn ein Ordner gedroppt wurde */
  onFolder?: (folderPath: string) => void;
  /** Callback wenn eine Projekt-Datei (.synth) gedroppt wurde */
  onProject?: (filePath: string) => void;
  /** Kinder-Elemente (optional) */
  children?: React.ReactNode;
}

type DropType = "audio" | "folder" | "project" | "unknown" | null;

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);
const PROJECT_EXTENSIONS = new Set([".synth", ".json"]);

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function detectDropType(items: DataTransferItemList | null): DropType {
  if (!items || items.length === 0) return null;
  const item = items[0];
  if (item.kind === "file") {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) return "folder";
    const ext = getFileExtension(entry?.name ?? "");
    if (AUDIO_EXTENSIONS.has(ext)) return "audio";
    if (PROJECT_EXTENSIONS.has(ext)) return "project";
    // Mehrere Dateien → Audio-Import annehmen
    if (items.length > 1) return "audio";
  }
  return "unknown";
}

// ─── Farben pro Drop-Typ ──────────────────────────────────────────────────────

const DROP_STYLES: Record<NonNullable<DropType>, { border: string; bg: string; text: string; label: string }> = {
  audio: {
    border: "border-cyan-500",
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    label: "Audio-Dateien ablegen",
  },
  folder: {
    border: "border-emerald-500",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    label: "Ordner importieren",
  },
  project: {
    border: "border-amber-500",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    label: "Projekt öffnen",
  },
  unknown: {
    border: "border-slate-500",
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    label: "Dateien ablegen",
  },
};

// ─── Komponente ───────────────────────────────────────────────────────────────

export function ElectronDropZone({
  onAudioFiles,
  onFolder,
  onProject,
  children,
}: ElectronDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dropType, setDropType] = useState<DropType>(null);
  const dragCounter = useRef(0);
  const isElectronEnv = typeof window !== "undefined" && !!window.electronAPI;

  // ── Electron: IPC-Events für Drag & Drop ──────────────────────────────────
  useEffect(() => {
    if (!isElectronEnv || !window.electronAPI) return;

    const cleanupBulk = window.electronAPI.onDragDropBulkImport?.((data) => {
      onAudioFiles?.(data.audioFiles ?? []);
      if (data.folders?.[0]) onFolder?.(data.folders[0]);
    });

    const cleanupSample = window.electronAPI.onDragDropLoadSample?.((data) => {
      onAudioFiles?.([data.filePath]);
    });

    const cleanupProject = window.electronAPI.onDragDropOpenProject?.((data) => {
      onProject?.(data.filePath);
    });

    return () => {
      cleanupBulk?.();
      cleanupSample?.();
      cleanupProject?.();
    };
  }, [isElectronEnv, onAudioFiles, onFolder, onProject]);

  // ── Browser: HTML5 Drag & Drop Fallback ───────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) {
      setIsDragging(true);
      setDropType(detectDropType(e.dataTransfer.items));
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
      setDropType(null);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      setDropType(null);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const audioFiles: string[] = [];
      for (const file of files) {
        const ext = getFileExtension(file.name);
        if (AUDIO_EXTENSIONS.has(ext)) {
          // Im Browser: Dateiname (kein echter Pfad verfügbar)
          audioFiles.push(file.name);
        } else if (PROJECT_EXTENSIONS.has(ext)) {
          onProject?.(file.name);
        }
      }
      if (audioFiles.length > 0) onAudioFiles?.(audioFiles);
    },
    [onAudioFiles, onProject]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const style = dropType ? DROP_STYLES[dropType] : DROP_STYLES.unknown;

  return (
    <div
      className="relative w-full h-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Overlay – nur sichtbar wenn aktiv gedraggt wird */}
      {isDragging && (
        <div
          className={`
            fixed inset-0 z-50 pointer-events-none
            flex flex-col items-center justify-center gap-4
            border-4 border-dashed transition-all duration-150
            ${style.border} ${style.bg}
          `}
        >
          {/* Icon */}
          <div className={`text-6xl ${style.text}`}>
            {dropType === "folder" ? "📁" : dropType === "project" ? "🎵" : "🎚️"}
          </div>

          {/* Label */}
          <p className={`text-2xl font-bold tracking-wide ${style.text}`}>
            {style.label}
          </p>

          {/* Subtext */}
          <p className="text-sm text-slate-400">
            {dropType === "audio" && "WAV, MP3, OGG, FLAC, AIFF werden unterstützt"}
            {dropType === "folder" && "Alle Audio-Dateien im Ordner werden importiert"}
            {dropType === "project" && ".synth Projektdatei wird geöffnet"}
            {dropType === "unknown" && "Datei wird analysiert..."}
          </p>
        </div>
      )}
    </div>
  );
}

export default ElectronDropZone;
