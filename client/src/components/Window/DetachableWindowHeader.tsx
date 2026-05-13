/**
 * DetachableWindowHeader — geteilter Header für pinnable Popup-Fenster
 * (Multi-Window-Workspace, post-v1.26.0).
 *
 * Wird genutzt von:
 *  - PerformancePopupApp
 *  - FxPopupApp
 *  - MixerPopupApp (neu)
 *
 * Verhalten:
 *  - 28px hohe schmale Leiste, Drag-Region für Fenster-Move.
 *  - Rechts: 📌 Pin-Toggle (Always-on-top) + ✕ Close-Button, beide no-drag
 *    damit sie klickbar bleiben.
 *  - Pin-State wird über IPC-Callback geliefert; Container ist stateless.
 *
 * Sicherheits-Hinweis (BUG-017): das Popup-Fenster hat per `win.setMenu(null)`
 * KEIN App-Menu. Der ✕ hier ruft die Window-spezifische Close-Funktion auf
 * (z.B. `electron.closePerformanceWindow`) — niemals `app.quit()`.
 */
import React from "react";

export interface DetachableWindowHeaderProps {
  /** Sichtbarer Titel-Text (Uppercase tracked). */
  title: string;
  /** Aktueller Always-on-top Status. */
  alwaysOnTop: boolean;
  /** Toggle-Callback für den Pin-Button. */
  onToggleAlwaysOnTop: () => void;
  /** Close-Callback für das ✕. */
  onClose: () => void;
  /** Optional: data-testid Präfix (z.B. "fx-popup" → "fx-popup-close"). Default: "popup". */
  testIdPrefix?: string;
}

export function DetachableWindowHeader({
  title,
  alwaysOnTop,
  onToggleAlwaysOnTop,
  onClose,
  testIdPrefix = "popup",
}: DetachableWindowHeaderProps) {
  return (
    <div
      className="flex items-center h-7 px-3 bg-bg-elevated border-b border-border-color select-none flex-shrink-0"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <span className="text-[10px] text-text-dim uppercase tracking-wider flex-1">
        {title}
      </span>
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={onToggleAlwaysOnTop}
          aria-label={alwaysOnTop ? "Always-on-top deaktivieren" : "Always-on-top aktivieren"}
          title={alwaysOnTop ? "Fenster bleibt im Vordergrund (Klick zum Lösen)" : "Fenster im Vordergrund halten"}
          data-testid={`${testIdPrefix}-always-on-top`}
          className={[
            "px-2 py-0.5 text-[10px] rounded border transition-colors active:scale-95",
            alwaysOnTop
              ? "bg-accent-primary/20 text-accent-primary border-accent-primary"
              : "bg-bg-base text-text-dim border-border-color hover:text-text-primary hover:border-accent-secondary",
          ].join(" ")}
        >
          📌 {alwaysOnTop ? "Pinned" : "Pin"}
        </button>
        <button
          onClick={onClose}
          aria-label={`${title} schließen`}
          data-testid={`${testIdPrefix}-close`}
          title="Fenster schließen"
          className="w-5 h-5 rounded text-[12px] text-text-dim hover:bg-accent-danger hover:text-bg-base transition-colors active:scale-95 flex items-center justify-center"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
