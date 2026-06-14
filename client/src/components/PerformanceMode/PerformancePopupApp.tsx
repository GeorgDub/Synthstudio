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
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { PatternLaunchPad, type PerformanceStoreActions } from "./PatternLaunchPad";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";
import type { PerformancePad, QuantizeMode } from "@/store/usePerformanceStore";

// ─── Popup-lokaler Playhead-Store (TASK-251) ──────────────────────────────────
// Der Popup ist ein eigener Electron-Renderer und kann den usePlayheadStore des
// Haupt-Fensters NICHT erreichen — der Step kommt pro Step via IPC
// (perf-sync:state). Früher floss currentStep in den großen React-State des
// Popups → jede Step-Nachricht re-renderte das gesamte PerformancePopupApp.
// Wir spiegeln daher das Playhead-Store-Pattern lokal: ein useSyncExternalStore-
// Singleton, das NUR der kleine Launchpad-Leaf-Wrapper abonniert. Der Step wird
// aus dem IPC-State herausgezogen und hierher geleitet — der restliche
// PerfPopupState ändert sich pro Step nicht mehr, also re-rendert das Root nicht.
let _popupStep = 0;
const _popupStepListeners = new Set<() => void>();
function setPopupPlayhead(step: number): void {
  if (step === _popupStep) return;
  _popupStep = step;
  _popupStepListeners.forEach((fn) => fn());
}
function subscribePopupPlayhead(listener: () => void): () => void {
  _popupStepListeners.add(listener);
  return () => {
    _popupStepListeners.delete(listener);
  };
}
function getPopupPlayhead(): number {
  return _popupStep;
}
function usePopupPlayhead(): number {
  return useSyncExternalStore(subscribePopupPlayhead, getPopupPlayhead, getPopupPlayhead);
}

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
  | { type: "request-state" }
  // Phase 2: Edit-Mode-Actions
  | { type: "set-pad-at"; index: number; pad: PerformancePad | null }
  | { type: "set-pad-color"; index: number; color: string }
  | { type: "set-pad-label"; index: number; label: string }
  | { type: "clear-pad"; index: number }
  // Phase 2: Reorder-Mode-Actions
  | { type: "move-pad"; fromIndex: number; toIndex: number }
  | { type: "move-multiple-pads"; fromIndices: number[]; toIndex: number };

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

// ─── Leaf-Wrapper für den Playhead (TASK-251) ─────────────────────────────────
// Abonniert den popup-lokalen Playhead-Store NUR hier. Re-rendert pro Step nur
// dieser kleine Subtree, NICHT das PerformancePopupApp-Root.
function PopupPlayheadLaunchPad(
  props: Omit<ComponentProps<typeof PatternLaunchPad>, "currentStep">,
) {
  const currentStep = usePopupPlayhead();
  return <PatternLaunchPad {...props} currentStep={currentStep} />;
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function PerformancePopupApp() {
  const electron = useElectron();
  const [state, setState] = useState<PerfPopupState>(INITIAL_STATE);
  const [synced, setSynced] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  // State-Sync vom Main-Renderer empfangen
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onPerfPopupState?.((payload) => {
      // Defensive: Payload validieren bevor wir es in State packen
      if (!payload || typeof payload !== "object") return;
      const s = payload as Partial<PerfPopupState>;
      // TASK-251: currentStep NICHT in den großen React-State — sonst re-rendert
      // das gesamte Popup pro Step. Stattdessen in den popup-lokalen Playhead-
      // Store leiten; nur der kleine Launchpad-Leaf abonniert ihn.
      if (typeof s.currentStep === "number") {
        setPopupPlayhead(s.currentStep);
      }
      setState((prev) => {
        // currentStep aus dem Diff ausklammern — eine reine Step-Nachricht darf
        // keinen Root-Rerender erzeugen.
        const { currentStep: _ignored, ...rest } = s;
        const next: PerfPopupState = {
          ...prev,
          ...rest,
          // currentStep im React-State unverändert lassen (nur fürs IPC-Schema).
          currentStep: prev.currentStep,
          // Arrays defensiv prüfen (fallback auf existing wenn fehlt)
          pads: Array.isArray(s.pads) ? s.pads : prev.pads,
          patterns: Array.isArray(s.patterns) ? s.patterns : prev.patterns,
        };
        // Identitäts-Guard: wenn sich (ohne Step) nichts geändert hat, prev
        // zurückgeben → kein Rerender.
        const changed =
          next.pads !== prev.pads ||
          next.patterns !== prev.patterns ||
          next.activePatternId !== prev.activePatternId ||
          next.queuedPatternId !== prev.queuedPatternId ||
          next.quantizeMode !== prev.quantizeMode ||
          next.bpm !== prev.bpm;
        return changed ? next : prev;
      });
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
  // BUG-023: nur auf Mount — sonst re-sendet jeder Render wegen useElectron-Ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial-State für Always-on-top abfragen
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isPerfPopupAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
  }, [electron]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setPerfPopupAlwaysOnTop?.(next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  const dispatchAction = (action: PerfPopupAction) => {
    electron.sendPerfPopupAction?.(action);
  };

  // Phase 2: Store-Action-Overrides für PatternLaunchPad.
  // Jede Operation wird statt direkt in den lokalen Store via IPC-Action
  // ins Main-Fenster geschickt. Main dispatcht in den echten Store und
  // broadcasted den neuen State zurück — der Popup re-rendert dann.
  //
  // useMemo damit das Objekt stable bleibt (sonst triggert PatternLaunchPad
  // einen useMemo-Rebuild bei jedem Render).
  const storeActions: PerformanceStoreActions = useMemo(() => ({
    setPadAt: (index, pad) => dispatchAction({ type: "set-pad-at", index, pad }),
    setPadColor: (index, color) => dispatchAction({ type: "set-pad-color", index, color }),
    setPadLabel: (index, label) => dispatchAction({ type: "set-pad-label", index, label }),
    movePad: (fromIndex, toIndex) => dispatchAction({ type: "move-pad", fromIndex, toIndex }),
    moveMultiplePads: (fromIndices, toIndex) => dispatchAction({ type: "move-multiple-pads", fromIndices, toIndex }),
    clearPad: (index) => dispatchAction({ type: "clear-pad", index }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [electron]);

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
    <div className="flex flex-col h-screen bg-bg-base">
      <DetachableWindowHeader
        title="Performance Mode"
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closePerformanceWindow?.()}
        testIdPrefix="perf-popup"
      />

      <PopupPlayheadLaunchPad
        pads={state.pads}
        patterns={state.patterns}
        activePatternId={state.activePatternId}
        queuedPatternId={state.queuedPatternId}
        quantizeMode={state.quantizeMode}
        bpm={state.bpm}
        storeActions={storeActions}
        onPadClick={(patternId) => dispatchAction({ type: "pad-click", patternId })}
        onQuantizeModeChange={(mode) => dispatchAction({ type: "quantize-mode-change", mode })}
        // BUG-020 (post-v1.33.0): popupMode=true damit PatternLaunchPad relative
        // statt fixed inset-0 rendert — DetachableWindowHeader oben drüber bleibt
        // sichtbar.
        popupMode
        // Close im Popup → schließt das Fenster (Main wird via perf-window:closed informiert)
        onClose={() => {
          electron.closePerformanceWindow?.();
        }}
      />
    </div>
  );
}
