/**
 * DetachableWindowHeader — geteilter Header für pinnable Popup-Fenster
 * (Multi-Window-Workspace, post-v1.26.0).
 *
 * Wird genutzt von:
 *  - PerformancePopupApp
 *  - FxPopupApp
 *  - MixerPopupApp
 *  - SampleBrowserPopupApp
 *  - PatternGeneratorPopupApp
 *  - KeyboardSamplerPopupApp / ChordProgressionPopupApp / PatternLibraryPopupApp
 *
 * Layout (post-v1.30.0 UX-Redesign nach User-Feedback):
 *   - 28px hohe schmale Leiste, Drag-Region für Fenster-Move.
 *   - EIN Button rechts: 📌 "Anpinnen" → schließt das Popup-Fenster.
 *     Da der Main-Renderer auf das Window-Closed-Event hört, wird das Panel
 *     automatisch wieder im Hauptfenster gerendert (= "zurück anpinnen").
 *   - Kein ✕ mehr (war im Wording mehrdeutig + im Verdacht den BUG-018-Quit
 *     zu triggern; einheitlicher Single-Button-Flow ist robuster + klarer).
 *   - Always-on-top-Toggle entfernt (bei Bedarf via OS-Window-Feature).
 *
 * Bei Bug-018: dieser Header tut nichts gefährliches mehr — wenn der einzige
 * Button (Pin) den popup.close() triggert, MUSS die App weiterleben.
 */
import React from "react";

export interface DetachableWindowHeaderProps {
  /** Sichtbarer Titel-Text (Uppercase tracked). */
  title: string;
  /**
   * Wird ausgelöst wenn der User den 📌-Button klickt. Soll das Popup-Fenster
   * schließen — der Main-Renderer hört auf das X-Window-Closed-Event und
   * rendert das Panel wieder inline.
   */
  onClose: () => void;
  /** Optional: data-testid Präfix. Default: "popup". */
  testIdPrefix?: string;

  /**
   * @deprecated Always-on-top wurde post-v1.30.0 aus dem Header entfernt
   * (User-Feedback: Single-Button-Flow ist robuster). Props bleiben optional
   * für Backward-Compat mit existierenden Aufrufern; werden ignoriert.
   */
  alwaysOnTop?: boolean;
  /** @deprecated siehe alwaysOnTop. */
  onToggleAlwaysOnTop?: () => void;
}

export function DetachableWindowHeader({
  title,
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
          onClick={onClose}
          aria-label={`${title} zurück ins Hauptfenster anpinnen`}
          title="Fenster zurück ins Hauptfenster anpinnen"
          data-testid={`${testIdPrefix}-pin-back`}
          className="px-2 py-0.5 text-[10px] rounded border border-border-color text-text-dim hover:text-accent-primary hover:border-accent-primary transition-colors active:scale-95"
        >
          📌 Anpinnen
        </button>
      </div>
    </div>
  );
}
