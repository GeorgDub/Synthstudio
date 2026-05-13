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
import React, { useState, useCallback, useEffect } from "react";

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
        text-text-muted transition-colors duration-100
        hover:${hoverColor} hover:text-text-primary
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
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Nur in Electron rendern
  const inElectron = typeof window !== "undefined" && !!window.electronAPI;
  const api = inElectron ? window.electronAPI : null;

  // BUG-009 Fix: Im Fullscreen versteckt sich die Custom-TitleBar komplett.
  // Hintergrund: `WebkitAppRegion: drag` auf dem TitleBar-Container wird im
  // Fullscreen-Mode von Chromium anders gehandled — die Drag-Region schluckt
  // pointer-events von darüberliegenden `fixed inset-0` Overlays (z.B. das
  // Performance-Mode Mode-Toggle), was deren Buttons unklickbar macht. In
  // Fullscreen ist die Drag-Region ohnehin sinnlos (Fenster lässt sich nicht
  // bewegen), also rendern wir die TitleBar gar nicht erst.
  useEffect(() => {
    if (!api) return;
    // Initial-State abfragen — User könnte via OS-Shortcut (F11/CMD+CTRL+F) in
    // Fullscreen sein bevor der Renderer mountet.
    api.isFullscreen?.().then((fs) => setIsFullscreen(!!fs)).catch(() => {});
    // Subscription für Fullscreen-Wechsel
    const cleanup = api.onFullscreenChanged?.(setIsFullscreen);
    return cleanup;
  }, [api]);

  if (!inElectron || !api) return null;
  if (isFullscreen) return null;

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
        h-8 bg-bg-base border-b border-border-color
        select-none ${className}
      `}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Linke Seite: App-Icon + Titel */}
      <div className="flex items-center gap-2 px-3 min-w-0">
        {/* Kleines App-Icon (Platzhalter) */}
        <div className="w-4 h-4 rounded-full bg-accent-primary flex-shrink-0 opacity-80" />

        {/* Titel */}
        <span className="text-xs text-text-primary truncate font-medium">
          {title}
        </span>

        {/* isDirty-Indikator */}
        {isDirty && (
          <span
            className="text-accent-primary text-xs flex-shrink-0"
            title="Ungespeicherte Änderungen"
          >
            ●
          </span>
        )}
      </div>

      {/* Mitte: Projektname (zentriert) */}
      {projectName && (
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="text-xs text-text-dim truncate max-w-[200px] block text-center">
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
          hoverColor="bg-bg-elevated"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </WindowButton>

        {/* Maximieren / Wiederherstellen */}
        <WindowButton
          onClick={handleMaximize}
          title={isMaximized ? "Wiederherstellen" : "Maximieren"}
          hoverColor="bg-bg-elevated"
        >
          {isMaximized ? (
            /* Wiederherstellen-Icon
             * Note: SVG rect fill below uses raw hex "#0d0d0d" intentionally —
             * it acts as the punch-through mask for the back rectangle of the
             * "restore" icon and is rendered on the title-bar bg. We keep it
             * theme-independent because <rect fill="..."> doesn't resolve
             * CSS variables; matching the title-bar bg via currentColor would
             * require a different SVG structure. Color-Refactor-Sonderfall. */
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
          hoverColor="bg-accent-danger"
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
