/**
 * PerformancePopupApp.tsx — separates Performance-Mode-Fenster (ROADMAP feature).
 *
 * Wird gerendert wenn der App mit URL-Param `?perfPopup=1` gestartet wird.
 * Im Electron-Mode öffnet das Main-Process via `createPerformanceWindow()` ein
 * zweites BrowserWindow das diese URL lädt — der User kann dann Pads parallel
 * zur DrumMachine/Mixer-UI im Haupt-Fenster nutzen.
 *
 * State-Sync-Architektur:
 *   - Main-Renderer schickt `perf-sync:state` Events mit dem aktuellen State
 *     (pads, activePattern, queuedPattern, quantizeMode, bpm, currentStep,
 *      patterns). Wird hier in `state`-React-State gespeichert.
 *   - User-Aktionen im Popup (Pad-Click, Quantize-Toggle) werden via
 *     `sendPerfPopupAction` ins Main-Renderer dispatched (über Main-Process-
 *     Routing).
 *
 * Phase 1 Scope (diese Version):
 *   - Play-Mode funktioniert (Pad-Click triggert Pattern-Wechsel im Main)
 *   - Quantize-Mode-Toggle funktioniert
 *   - Edit-Mode / Reorder-Mode sind im Popup gesperrt — Hinweis "Im Haupt-
 *     Fenster bearbeiten" wird angezeigt
 *
 * Phase 2 (Future):
 *   - Full Edit/Reorder-Sync
 *   - Web-Fallback via window.open() + BroadcastChannel
 *   - "Always on top" Toggle
 *   - Multiple Popup-Windows (z.B. ein Popup pro Pattern-Bank)
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { PatternLaunchPad } from "./PatternLaunchPad";
import type { PerformancePad, QuantizeMode } from "@/store/usePerformanceStore";

// ─── State-Sync-Schema ────────────────────────────────────────────────────────

/** Vollständiger State-Snapshot, der vom Main-Renderer ins Popup geschickt wird. */
export interface PerfPopupState {
  pads: Array<PerformancePad | null>;
  patterns: Array<{ id: string; name: string }>;
  activePatternId: string;
  queuedPatternId: string | null;
  quantizeMode: QuantizeMode;
  bpm: number;
  currentStep: number;
}

/** Action-Payload, das vom Popup ins Main-Renderer dispatched wird. */
export type PerfPopupAction =
  | { type: "pad-click"; patternId: string }
  | { type: "quantize-mode-change"; mode: QuantizeMode }
  | { type: "close" };

// ─── Default-State (vor erstem Sync) ──────────────────────────────────────────

const INITIAL_STATE: PerfPopupState = {
  pads: Array.from({ length: 16 }, () => null),
  patterns: [],
  activePatternId: "",
  queuedPatternId: null,
  quantizeMode: "bar",
  bpm: 120,
  currentStep: 0,
};

// ─── Komponente ───────────────────────────────────────────────────────────────

export function PerformancePopupApp() {
  const electron = useElectron();
  const [state, setState] = useState<PerfPopupState>(INITIAL_STATE);
  const [synced, setSynced] = useState(false);

  // State-Sync vom Main-Renderer empfangen
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onPerfPopupState?.((payload) => {
      // Defensive: Payload validieren bevor wir es in State packen
      if (!payload || typeof payload !== "object") return;
      const s = payload as Partial<PerfPopupState>;
      setState((prev) => ({
        ...prev,
        ...s,
        // Arrays defensiv prüfen (fallback auf existing wenn fehlt)
        pads: Array.isArray(s.pads) ? s.pads : prev.pads,
        patterns: Array.isArray(s.patterns) ? s.patterns : prev.patterns,
      }));
      setSynced(true);
    });
    return cleanup;
  }, [electron]);

  // Initial-Anfrage an Main, damit der Popup direkt nach Mount synced wird.
  // Wir nutzen dafür einen leeren "request"-Action — Main reagiert mit
  // sendPerfPopupState. Falls Main nicht reagiert (z.B. App noch nicht
  // gemountet), zeigen wir den "Warte auf Sync"-Screen.
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.sendPerfPopupAction?.({ type: "request-state" });
  }, [electron]);

  const dispatchAction = (action: PerfPopupAction) => {
    electron.sendPerfPopupAction?.(action);
  };

  // Im Web-Modus ist das Feature aktuell nicht verfügbar
  if (!electron.isElectron) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">PERFORMANCE MODE</h1>
          <p className="text-text-muted">
            Das separate Performance-Fenster ist aktuell nur in der Electron-Desktop-App verfügbar.
            <br />
            Im Browser nutze bitte den Performance Mode aus der Toolbar.
          </p>
        </div>
      </div>
    );
  }

  // Pre-Sync-Screen
  if (!synced) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">PERFORMANCE MODE</h1>
          <p className="text-text-muted">Verbinde mit Haupt-Fenster...</p>
          <p className="text-text-dim text-xs mt-4">
            Falls der Sync nicht startet: prüfe ob das Haupt-Fenster offen ist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PatternLaunchPad
      pads={state.pads}
      patterns={state.patterns}
      activePatternId={state.activePatternId}
      queuedPatternId={state.queuedPatternId}
      quantizeMode={state.quantizeMode}
      bpm={state.bpm}
      currentStep={state.currentStep}
      onPadClick={(patternId) => dispatchAction({ type: "pad-click", patternId })}
      onQuantizeModeChange={(mode) => dispatchAction({ type: "quantize-mode-change", mode })}
      // Close im Popup → schließt das Fenster (Main wird via perf-window:closed informiert)
      onClose={() => {
        electron.closePerformanceWindow?.();
      }}
    />
  );
}
