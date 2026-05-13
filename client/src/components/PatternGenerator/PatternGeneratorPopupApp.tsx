/**
 * PatternGeneratorPopupApp.tsx — separates Pattern-Generator-Fenster
 * (Multi-Window-Workspace, post-v1.27.0).
 *
 * Gerendert wenn die App mit URL-Param `?patternGenPopup=1` startet.
 * Singleton.
 *
 * Architektur:
 *   - Komponente wraped `<PatternGeneratorPanel />` (Original-Komponente,
 *     unverändert) in einen DetachableWindowHeader-Frame.
 *   - PatternGeneratorPanel dispatcht beim "Anwenden"-Klick einen
 *     CustomEvent `pattern-generator:apply` auf das eigene Window-Objekt.
 *     Wir fangen den Event ab und forwarden ihn via IPC zum Main, das ihn
 *     auf seinem Window re-dispatcht — der existierende handleApply-Handler
 *     in App.tsx läuft dann unverändert.
 *   - Genre/Komplexität/Prompt-State läuft per `usePatternGeneratorStore`
 *     mit localStorage-Persistence: User-Edits in Popup landen via Storage
 *     im Main, beim nächsten Mount sind die Drafts auch dort sichtbar.
 *   - AI-API-Calls (Anthropic/OpenAI) laufen im Popup-Renderer direkt —
 *     Anthropic-Key + Provider werden aus localStorage gelesen, identisch
 *     zum Main.
 *
 * Web-Fallback: nicht verfügbar — Multi-Window ist Electron-only.
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";
import { PatternGeneratorPanel } from "./PatternGeneratorPanel";

/** Action vom Popup → Main. */
export type PatternGenPopupAction =
  | { type: "apply-pattern"; pattern: GeneratedPatternPayload };

/** Generierte-Pattern-Daten (sync mit App.tsx handleApply-Schema). */
export interface GeneratedPatternPayload {
  bpm: number;
  parts: Array<{
    name: string;
    steps: Array<{ active: boolean; velocity: number }>;
  }>;
}

export function PatternGeneratorPopupApp() {
  const electron = useElectron();
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  // CustomEvent „pattern-generator:apply" abfangen und via IPC zum Main forwarden
  useEffect(() => {
    if (!electron.isElectron) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<GeneratedPatternPayload>).detail;
      if (!detail || !Array.isArray(detail.parts)) return;
      // Stop propagation so even if there's any default behavior, only our
      // forward-to-main path runs. (Defensive — there's no default behavior.)
      electron.sendPatternGenPopupAction?.({ type: "apply-pattern", pattern: detail });
    };
    window.addEventListener("pattern-generator:apply", handler);
    return () => window.removeEventListener("pattern-generator:apply", handler);
  }, [electron]);

  // Always-on-top initial
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isPatternGenWindowAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
  }, [electron]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setPatternGenWindowAlwaysOnTop?.(next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  if (!electron.isElectron) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">PATTERN GENERATOR</h1>
          <p className="text-text-muted">
            Das separate Pattern-Generator-Fenster ist nur in der Electron-Desktop-App verfügbar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <DetachableWindowHeader
        title="Pattern Generator"
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closePatternGenWindow?.()}
        testIdPrefix="pattern-gen-popup"
      />

      {/* PatternGeneratorPanel wird unverändert gemounted. Apply-Button in
          der Komponente dispatcht den CustomEvent — wir fangen ihn oben ab. */}
      <div className="flex-1 overflow-hidden">
        <PatternGeneratorPanel />
      </div>
    </div>
  );
}
