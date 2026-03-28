/**
 * Synthstudio – ElectronTitleBar (Frontend-Agent)
 *
 * Benutzerdefinierte Titelleiste für Electron.
 * Zeigt App-Name, Projektname, isDirty-Indikator und Fenster-Buttons.
 * Gibt null zurück wenn nicht in Electron (window.electronAPI undefined).
 *
 * Verwendung:
 * ```tsx
 * <ElectronTitleBar projectName="Mein Projekt" isDirty={true} />
 * ```
 */
import React, { useState, useCallback } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ElectronTitleBarProps {
  /** Name des aktuellen Projekts */
  projectName?: string;
  /** Ob es ungespeicherte Änderungen gibt */
  isDirty?: boolean;
  /** Zusätzliche CSS-Klassen */
  className?: string;
}

// ─── Fenster-Button-Komponente ────────────────────────────────────────────────

interface WindowButtonProps {
  onClick: () => void;
  title: string;
  hoverColor: string;
  children: React.ReactNode;
}

function WindowButton({ onClick, title, hoverColor, children }: WindowButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`
        w-12 h-full flex items-center justify-center
        text-slate-400 transition-colors duration-100
        hover:${hoverColor} hover:text-white
        focus:outline-none
      `}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {children}
    </button>
  );
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────

export function ElectronTitleBar({
  projectName,
  isDirty = false,
  className = "",
}: ElectronTitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  // Nur in Electron rendern
  if (typeof window === "undefined" || !window.electronAPI) {
    return null;
  }

  const api = window.electronAPI;

  const handleMinimize = useCallback(() => {
    api.minimizeWindow?.();
  }, [api]);

  const handleMaximize = useCallback(() => {
    api.maximizeWindow?.();
    setIsMaximized((prev) => !prev);
  }, [api]);

  const handleClose = useCallback(() => {
    api.forceCloseWindow?.();
  }, [api]);

  // ── Titel zusammensetzen ──────────────────────────────────────────────────
  const appName = "Synthstudio";
  const titleParts: string[] = [appName];
  if (projectName) titleParts.push(projectName);
  const title = titleParts.join(" – ");

  return (
    <div
      className={`
        flex items-center justify-between
        h-8 bg-[#0d0d0d] border-b border-slate-800
        select-none ${className}
      `}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Linke Seite: App-Icon + Titel */}
      <div className="flex items-center gap-2 px-3 min-w-0">
        {/* Kleines App-Icon (Platzhalter) */}
        <div className="w-4 h-4 rounded-full bg-cyan-500 flex-shrink-0 opacity-80" />

        {/* Titel */}
        <span className="text-xs text-slate-300 truncate font-medium">
          {title}
        </span>

        {/* isDirty-Indikator */}
        {isDirty && (
          <span
            className="text-cyan-400 text-xs flex-shrink-0"
            title="Ungespeicherte Änderungen"
          >
            ●
          </span>
        )}
      </div>

      {/* Mitte: Projektname (zentriert) */}
      {projectName && (
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="text-xs text-slate-500 truncate max-w-[200px] block text-center">
            {projectName}
            {isDirty && " *"}
          </span>
        </div>
      )}

      {/* Rechte Seite: Fenster-Buttons */}
      <div
        className="flex items-center h-full flex-shrink-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Minimieren */}
        <WindowButton
          onClick={handleMinimize}
          title="Minimieren"
          hoverColor="bg-slate-700"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </WindowButton>

        {/* Maximieren / Wiederherstellen */}
        <WindowButton
          onClick={handleMaximize}
          title={isMaximized ? "Wiederherstellen" : "Maximieren"}
          hoverColor="bg-slate-700"
        >
          {isMaximized ? (
            /* Wiederherstellen-Icon */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="8" height="8" />
              <rect x="0" y="2" width="8" height="8" fill="#0d0d0d" />
              <rect x="0" y="2" width="8" height="8" />
            </svg>
          ) : (
            /* Maximieren-Icon */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0" y="0" width="10" height="10" />
            </svg>
          )}
        </WindowButton>

        {/* Schließen */}
        <WindowButton
          onClick={handleClose}
          title="Schließen"
          hoverColor="bg-red-600"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </WindowButton>
      </div>
    </div>
  );
}

export default ElectronTitleBar;
