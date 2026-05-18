/**
 * Synthstudio – DragDropOverlay (v3.1.0)
 *
 * Standalone visuelles Drop-Feedback-Overlay.
 *
 * Wird gerendert wenn der User Files ueber das App-Window zieht.
 * Erkennt den ersten Drop-Type via detectFileType() und stellt die
 * Overlay-Farbe/Label entsprechend.
 *
 * Verwendung:
 *   <DragDropOverlay isVisible={isDragging} fileType={dropType} />
 *
 * Komponente ist purely-presentational — der Container (ElectronDropZone)
 * besitzt die Drag-State-Logik und reicht `isVisible` + `fileType` runter.
 *
 * Akzeptanz (TASK v3.1.0):
 *   - Kein hardcoded Tailwind-Farb-Token (bg-slate-*, text-cyan-* etc.)
 *   - pointer-events-none auf dem Overlay damit kein Drop-Underflow
 *   - Stable data-testid="drag-drop-overlay" fuer Playwright-Smoke
 */
import React from "react";
import type { FileType } from "@/utils/dragDropDispatch";

export interface DragDropOverlayProps {
  /** Sichtbarkeit (gesteuert vom Container via dragenter/dragleave/drop). */
  isVisible: boolean;
  /** Erkannter File-Typ — null wenn kein File im DataTransfer. */
  fileType: FileType | null;
}

// ─── Farben pro Drop-Typ ──────────────────────────────────────────────────────
//
// Kategorische Palette: jeder Drop-Typ kriegt eine visuell unterscheidbare
// Akzent-Farbe (4 semantische Tokens — kein hardcoded slate/cyan/etc).
//
//   audio     → accent-primary    (Haupt-Workflow)
//   project   → accent-secondary  (.synth-Datei)
//   zip       → accent-secondary  (verwandt mit Bulk-Import)
//   midi      → accent-success    (Pattern-Daten)
//   electribe → accent-success    (Pattern-Daten/Bank)
//   unknown   → text-muted        (neutral)
//
// Themes mit nur 3 Akzent-Farben verlieren die Differenzierung zwischen
// project und zip — der Icon/Label-Text traegt die Information dominant.

const OVERLAY_STYLES: Record<FileType, { border: string; bg: string; text: string; label: string; icon: string }> = {
  audio: {
    border: "border-accent-primary",
    bg: "bg-accent-primary/10",
    text: "text-accent-primary",
    label: "Audio-Dateien ablegen",
    icon: "🎚️",
  },
  project: {
    border: "border-accent-secondary",
    bg: "bg-accent-secondary/10",
    text: "text-accent-secondary",
    label: "Projekt oeffnen",
    icon: "🎵",
  },
  zip: {
    border: "border-accent-secondary",
    bg: "bg-accent-secondary/10",
    text: "text-accent-secondary",
    label: "ZIP-Archiv extrahieren",
    icon: "🗜️",
  },
  midi: {
    border: "border-accent-success",
    bg: "bg-accent-success/10",
    text: "text-accent-success",
    label: "MIDI-File importieren",
    icon: "🎹",
  },
  electribe: {
    border: "border-accent-success",
    bg: "bg-accent-success/10",
    text: "text-accent-success",
    label: "KORG Electribe Pattern importieren",
    icon: "🥁",
  },
  unknown: {
    border: "border-border-color",
    bg: "bg-bg-elevated/40",
    text: "text-text-muted",
    label: "Datei wird analysiert...",
    icon: "📦",
  },
};

const SUBTEXT_BY_TYPE: Record<FileType, string> = {
  audio: "WAV, MP3, OGG, FLAC, AIFF werden unterstuetzt",
  project: ".synth Projektdatei wird geladen",
  zip: "Audio-Samples aus dem Archiv werden extrahiert",
  midi: "Notes werden in das aktuelle Pattern importiert",
  electribe: ".e2spat / .e2sallpat / .esx / .elst — KORG Hardware-Pattern",
  unknown: "Datei-Typ unbekannt — wird ignoriert",
};

// ─── Komponente ───────────────────────────────────────────────────────────────

export function DragDropOverlay({ isVisible, fileType }: DragDropOverlayProps): React.ReactElement | null {
  if (!isVisible) return null;
  const type: FileType = fileType ?? "unknown";
  const style = OVERLAY_STYLES[type];
  const subtext = SUBTEXT_BY_TYPE[type];

  return (
    <div
      data-testid="drag-drop-overlay"
      data-drop-type={type}
      className={`
        fixed inset-0 z-50 pointer-events-none
        flex flex-col items-center justify-center gap-4
        border-4 border-dashed transition-all duration-150
        ${style.border} ${style.bg}
      `}
    >
      <div className={`text-6xl ${style.text}`}>{style.icon}</div>
      <p className={`text-2xl font-bold tracking-wide ${style.text}`}>{style.label}</p>
      <p className="text-sm text-text-muted">{subtext}</p>
    </div>
  );
}

export default DragDropOverlay;
