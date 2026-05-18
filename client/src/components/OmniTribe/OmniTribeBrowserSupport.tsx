/**
 * OmniTribeBrowserSupport.tsx — Banner für Browser ohne Web-MIDI-Unterstützung.
 *
 * v3.19.0: DoD §16 — "Firefox/Safari-Hinweis im UI wenn Web-MIDI nicht
 * verfügbar". Wird im OmniTribe-Tab prominent oben angezeigt sobald
 * `navigator.requestMIDIAccess` nicht definiert ist (Firefox/Safari).
 *
 * Reine semantische Tailwind-Tokens (bg-bg-panel / text-accent-danger / etc.).
 * Isomorph: render-noop bei SSR (typeof navigator === "undefined"), zeigt
 * Banner nur bei tatsächlich fehlendem Web-MIDI.
 */

import type { ReactElement } from "react";

/**
 * Detektion ist als pure Function exportiert, damit Tests das ohne Hook-Setup
 * verifizieren können.
 */
export function isWebMidiSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as Navigator).requestMIDIAccess === "function";
}

export interface OmniTribeBrowserSupportProps {
  /**
   * Erlaubt expliziten Override für Tests / Storybook. Wenn nicht gesetzt,
   * wird `isWebMidiSupported()` zur Laufzeit ausgewertet.
   */
  supported?: boolean;
}

export function OmniTribeBrowserSupport({
  supported,
}: OmniTribeBrowserSupportProps): ReactElement | null {
  const ok = typeof supported === "boolean" ? supported : isWebMidiSupported();
  if (ok) return null;

  return (
    <div
      role="alert"
      data-testid="omnitribe-browser-unsupported"
      className="bg-bg-panel border border-accent-danger rounded p-3 flex items-start gap-3"
    >
      <span
        aria-hidden="true"
        className="text-accent-danger text-base leading-none mt-0.5"
      >
        !
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-accent-danger">
          Web-MIDI nicht verfügbar in diesem Browser
        </p>
        <p className="text-xs text-text-muted">
          Bitte Chrome, Edge oder Opera nutzen — alternativ die
          Synthstudio-Desktop-App. Firefox &amp; Safari unterstützen die
          Web-MIDI-API nicht und können daher nicht mit dem OmniTribe-Gerät
          kommunizieren.
        </p>
      </div>
    </div>
  );
}

export default OmniTribeBrowserSupport;
