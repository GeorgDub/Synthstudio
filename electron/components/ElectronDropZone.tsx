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
  /**
   * Callback wenn ein ZIP-Archiv mit Audio-Samples gedroppt wurde.
   * Im Browser werden File-Objekte übergeben, in Electron der Pfad.
   */
  onZipFile?: (file: File) => void;
  /**
   * v2.12: Callback wenn ein .mid/.midi-File gedroppt wurde.
   * Empfänger ist typischerweise DrumMachine via window-event.
   */
  onMidiFile?: (file: File) => void;
  /** Kinder-Elemente (optional) */
  children?: React.ReactNode;
}

type DropType = "audio" | "folder" | "project" | "zip" | "midi" | "unknown" | null;

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);
const PROJECT_EXTENSIONS = new Set([".synth", ".json"]);
const ZIP_EXTENSIONS = new Set([".zip"]);
const MIDI_EXTENSIONS = new Set([".mid", ".midi"]);

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
    if (ZIP_EXTENSIONS.has(ext)) return "zip";
    if (AUDIO_EXTENSIONS.has(ext)) return "audio";
    if (PROJECT_EXTENSIONS.has(ext)) return "project";
    if (MIDI_EXTENSIONS.has(ext)) return "midi";
    // Mehrere Dateien → Audio-Import annehmen
    if (items.length > 1) return "audio";
  }
  return "unknown";
}

// ─── Farben pro Drop-Typ ──────────────────────────────────────────────────────
//
// Kategorische Palette: jeder Drop-Typ benötigt eine visuell unterscheidbare
// Farbe. Wir mappen auf die vier semantischen Akzent-Tokens (TASK-122):
//   audio   → accent-primary   (Hauptaktion, kommt am häufigsten vor)
//   folder  → accent-success   (Bulk-Import = positiv)
//   project → accent-secondary (Projektdatei, abgehoben)
//   zip     → accent-secondary (verwandt mit Projektimport)
//   unknown → text-muted       (neutral, keine Aktion bestimmt)
//
// Wegen der Überschneidung project/zip wird zip im Border-Stil über die
// Border-Farbe zusätzlich gedimmt. Themes mit nur drei Akzenten verlieren
// die Differenzierung zwischen project und zip – akzeptiert als trade-off,
// da die ohnehin große Drop-Overlay-Icons + Texte die Drop-Type-Information
// dominant tragen.

const DROP_STYLES: Record<NonNullable<DropType>, { border: string; bg: string; text: string; label: string }> = {
  audio: {
    border: "border-accent-primary",
    bg: "bg-accent-primary/10",
    text: "text-accent-primary",
    label: "Audio-Dateien ablegen",
  },
  folder: {
    border: "border-accent-success",
    bg: "bg-accent-success/10",
    text: "text-accent-success",
    label: "Ordner importieren",
  },
  project: {
    border: "border-accent-secondary",
    bg: "bg-accent-secondary/10",
    text: "text-accent-secondary",
    label: "Projekt öffnen",
  },
  zip: {
    border: "border-accent-secondary",
    bg: "bg-accent-secondary/10",
    text: "text-accent-secondary",
    label: "ZIP-Archiv extrahieren",
  },
  midi: {
    border: "border-accent-success",
    bg: "bg-accent-success/10",
    text: "text-accent-success",
    label: "MIDI-File importieren",
  },
  unknown: {
    border: "border-border-color",
    bg: "bg-bg-elevated/10",
    text: "text-text-muted",
    label: "Dateien ablegen",
  },
};

// ─── Komponente ───────────────────────────────────────────────────────────────

export function ElectronDropZone({
  onAudioFiles,
  onFolder,
  onProject,
  onZipFile,
  onMidiFile,
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
      const audioPaths = data.audioFiles.map((f) => f.path);
      if (audioPaths.length > 0) onAudioFiles?.(audioPaths);
      if (data.folders?.[0]) onFolder?.(data.folders[0].path);
    });

    const cleanupSample = window.electronAPI.onDragDropLoadSample?.((data) => {
      onAudioFiles?.([data.path]);
    });

    const cleanupProject = window.electronAPI.onDragDropOpenProject?.((filePath) => {
      onProject?.(filePath);
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
        if (ZIP_EXTENSIONS.has(ext)) {
          onZipFile?.(file);
        } else if (MIDI_EXTENSIONS.has(ext)) {
          onMidiFile?.(file);
        } else if (AUDIO_EXTENSIONS.has(ext)) {
          // Im Browser: Dateiname (kein echter Pfad verfügbar)
          audioFiles.push(file.name);
        } else if (PROJECT_EXTENSIONS.has(ext)) {
          onProject?.(file.name);
        }
      }
      if (audioFiles.length > 0) onAudioFiles?.(audioFiles);
    },
    [onAudioFiles, onProject, onZipFile, onMidiFile]
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
            {dropType === "folder"
              ? "📁"
              : dropType === "project"
              ? "🎵"
              : dropType === "zip"
              ? "🗜️"
              : dropType === "midi"
              ? "🎹"
              : "🎚️"}
          </div>

          {/* Label */}
          <p className={`text-2xl font-bold tracking-wide ${style.text}`}>
            {style.label}
          </p>

          {/* Subtext */}
          <p className="text-sm text-text-muted">
            {dropType === "audio" && "WAV, MP3, OGG, FLAC, AIFF werden unterstützt"}
            {dropType === "folder" && "Alle Audio-Dateien im Ordner werden importiert"}
            {dropType === "project" && ".synth Projektdatei wird geöffnet"}
            {dropType === "zip" && "Audio-Dateien aus dem Archiv werden extrahiert"}
            {dropType === "midi" && "Notes werden in das aktuelle Pattern importiert"}
            {dropType === "unknown" && "Datei wird analysiert..."}
          </p>
        </div>
      )}
    </div>
  );
}

export default ElectronDropZone;
