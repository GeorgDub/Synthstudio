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
import {
  AUDIO_EXTENSIONS as DD_AUDIO,
  ZIP_EXTENSIONS as DD_ZIP,
  MIDI_EXTENSIONS as DD_MIDI,
  ELECTRIBE_EXTENSIONS as DD_ELECTRIBE,
  KORG_BANK_EXTENSIONS as DD_KORG_BANK,
  getFileExtension as ddGetExt,
} from "@/utils/dragDropDispatch";
import { toast } from "@/store/useToastStore";
import { DragDropOverlay } from "@/components/DragDropOverlay/DragDropOverlay";

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
  /**
   * v3.1.0: Callback wenn ein .e2spat/.e2sallpat/.elst-File gedroppt
   * wurde. Empfaenger ist DrumMachine (vorhandener `electribe:fileImport`-
   * Listener) — bei fehlendem Callback faellt der Default auf das
   * CustomEvent zurueck.
   */
  onElectribeFile?: (file: File) => void;
  /**
   * v3.3.0: Callback wenn ein .esx/.ess/.all KORG Sample-Bank-File gedroppt
   * wurde. Bei fehlendem Callback dispatch des CustomEvents 'korg:bank:open'
   * an window.
   */
  onKorgBankFile?: (file: File) => void;
  /**
   * v2.13: Callback mit den rohen File-Objekten der Audio-Drops (Browser).
   * Dient z.B. der BPM-Erkennung, da `onAudioFiles` nur den Dateinamen
   * weiterreicht, nicht das ArrayBuffer.
   */
  onAudioFilesRaw?: (files: File[]) => void;
  /** Kinder-Elemente (optional) */
  children?: React.ReactNode;
}

// v3.1.0: vereint sich DropType mit dem zentralen FileType (DragDropOverlay).
// "folder" bleibt zonen-spezifisch (Webkit-Entry → isDirectory) und ist NICHT
// im zentralen FileType, weil File-Drops keine Folder transportieren.
type DropType = "audio" | "folder" | "project" | "zip" | "midi" | "electribe" | "korg-bank" | "unknown" | null;

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

// v3.1.0: Extensions kommen jetzt zentral aus dragDropDispatch.ts; die hiesigen
// Konstanten bleiben fuer Drop-Handler-Iteration im Browser-Fallback.
const AUDIO_EXTENSIONS = DD_AUDIO;
// PROJECT-Drop akzeptiert legacy .json + neue .synth-Files
const PROJECT_EXTENSIONS = new Set([".synth", ".json"]);
const ZIP_EXTENSIONS = DD_ZIP;
const MIDI_EXTENSIONS = DD_MIDI;
const ELECTRIBE_EXTENSIONS = DD_ELECTRIBE;
const KORG_BANK_EXTENSIONS = DD_KORG_BANK;

function getFileExtension(name: string): string {
  return ddGetExt(name);
}

function detectDropType(items: DataTransferItemList | null): DropType {
  if (!items || items.length === 0) return null;
  const item = items[0];
  if (item.kind === "file") {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) return "folder";
    const name = entry?.name ?? "";
    const ext = getFileExtension(name);
    if (ZIP_EXTENSIONS.has(ext)) return "zip";
    if (AUDIO_EXTENSIONS.has(ext)) return "audio";
    if (PROJECT_EXTENSIONS.has(ext)) return "project";
    if (MIDI_EXTENSIONS.has(ext)) return "midi";
    if (KORG_BANK_EXTENSIONS.has(ext)) return "korg-bank";
    if (ELECTRIBE_EXTENSIONS.has(ext)) return "electribe";
    // Mehrere Dateien → Audio-Import annehmen
    if (items.length > 1) return "audio";
  }
  return "unknown";
}

// ─── Folder-Overlay-Style (zonen-spezifisch, im DragDropOverlay nicht enthalten) ──
//
// Folders kommen nur per webkitGetAsEntry und werden nicht ueber den File-
// Drop-Pfad geroutet — die ElectronDropZone reicht sie direkt an
// onFolder() durch. Wir rendern den Folder-Overlay daher inline statt
// ueber DragDropOverlay zu gehen.

const FOLDER_OVERLAY = {
  border: "border-accent-success",
  bg: "bg-accent-success/10",
  text: "text-accent-success",
  label: "Ordner importieren",
};

// ─── Komponente ───────────────────────────────────────────────────────────────

export function ElectronDropZone({
  onAudioFiles,
  onFolder,
  onProject,
  onZipFile,
  onMidiFile,
  onElectribeFile,
  onKorgBankFile,
  onAudioFilesRaw,
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
      const audioFileObjects: File[] = [];
      const unknownExts: string[] = [];

      for (const file of files) {
        const ext = getFileExtension(file.name);
        if (ZIP_EXTENSIONS.has(ext)) {
          onZipFile?.(file);
        } else if (MIDI_EXTENSIONS.has(ext)) {
          if (onMidiFile) {
            onMidiFile(file);
          } else {
            // Default-Fallback: dispatch CustomEvent fuer den DrumMachine-Listener
            try { window.dispatchEvent(new CustomEvent<File>("midi:fileImport", { detail: file })); }
            catch { /* ignore */ }
          }
        } else if (KORG_BANK_EXTENSIONS.has(ext)) {
          if (onKorgBankFile) {
            onKorgBankFile(file);
          } else {
            // v3.3.0: Default-Fallback — DrumMachine.tsx hat einen Listener
            // 'korg:bank:open' der den KorgBankModal oeffnet.
            try { window.dispatchEvent(new CustomEvent<File>("korg:bank:open", { detail: file })); }
            catch { /* ignore */ }
          }
        } else if (ELECTRIBE_EXTENSIONS.has(ext)) {
          if (onElectribeFile) {
            onElectribeFile(file);
          } else {
            // v3.1.0: Default-Fallback — DrumMachine.tsx hat einen Listener fuer
            // dieses Event, der den Electribe-Parser anwirft (siehe v2.88).
            try { window.dispatchEvent(new CustomEvent<File>("electribe:fileImport", { detail: file })); }
            catch { /* ignore */ }
          }
        } else if (AUDIO_EXTENSIONS.has(ext)) {
          // Im Browser: Dateiname (kein echter Pfad verfügbar)
          audioFiles.push(file.name);
          audioFileObjects.push(file);
        } else if (PROJECT_EXTENSIONS.has(ext)) {
          onProject?.(file.name);
        } else {
          // v3.1.0: unbekannte Endung → Toast statt silent-ignore
          unknownExts.push(ext || file.name);
        }
      }
      if (audioFiles.length > 0) onAudioFiles?.(audioFiles);
      if (audioFileObjects.length > 0) onAudioFilesRaw?.(audioFileObjects);
      if (unknownExts.length > 0) {
        // Defensive: ein Toast pro Drop, nicht pro File (Toast-Spam-Schutz).
        const sample = unknownExts.slice(0, 3).join(", ");
        const more = unknownExts.length > 3 ? ` (+${unknownExts.length - 3} weitere)` : "";
        try {
          toast(`Nicht unterstuetztes Dateiformat: ${sample}${more}`, {
            kind: "warning",
            duration: 4500,
          });
        } catch { /* test-env ohne toast → ignore */ }
      }
    },
    [onAudioFiles, onProject, onZipFile, onMidiFile, onElectribeFile, onKorgBankFile, onAudioFilesRaw]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // v3.1.0: folder bleibt als Spezialfall inline (Webkit-Entry, kein
  // CustomEvent-Route), alles andere geht ueber DragDropOverlay.
  const showFolderOverlay = isDragging && dropType === "folder";
  const overlayType = dropType === "folder" ? null : dropType;

  return (
    <div
      className="relative w-full h-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Folder-Overlay (zonen-spezifisch — kein CustomEvent-Route). */}
      {showFolderOverlay && (
        <div
          data-testid="drag-drop-overlay-folder"
          className={`
            fixed inset-0 z-50 pointer-events-none
            flex flex-col items-center justify-center gap-4
            border-4 border-dashed transition-all duration-150
            ${FOLDER_OVERLAY.border} ${FOLDER_OVERLAY.bg}
          `}
        >
          <div className={`text-6xl ${FOLDER_OVERLAY.text}`}>📁</div>
          <p className={`text-2xl font-bold tracking-wide ${FOLDER_OVERLAY.text}`}>{FOLDER_OVERLAY.label}</p>
          <p className="text-sm text-text-muted">Alle Audio-Dateien im Ordner werden importiert</p>
        </div>
      )}

      {/* Standalone-Overlay (alle File-basierten Drop-Typen). */}
      <DragDropOverlay
        isVisible={isDragging && !showFolderOverlay}
        fileType={overlayType ?? "unknown"}
      />
    </div>
  );
}

export default ElectronDropZone;
