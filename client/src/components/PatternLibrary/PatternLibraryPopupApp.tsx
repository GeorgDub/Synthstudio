/**
 * PatternLibraryPopupApp.tsx — separates Pattern-Library-Fenster (post-v1.28.0).
 *
 * Wrap-and-go: `PatternLibrary` ohne Refactor + DetachableWindowHeader.
 *
 * Props die gespiegelt werden:
 *   - currentPattern (PatternData): nur metadata + step-counts werden gebraucht
 *     im Library-Save-Flow
 *   - globalBpm (number)
 *
 * Action: onLoadPattern → IPC → Main → dm.addPatternData.
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";
import { PatternLibrary } from "./PatternLibrary";
import type { PatternData } from "@/audio/AudioEngine";

interface PLPopupState {
  currentPattern: PatternData | undefined;
  globalBpm: number;
}

export type PatternLibraryPopupAction =
  | { type: "popup-mounted" }
  | { type: "load-pattern"; pattern: PatternData };

export function PatternLibraryPopupApp() {
  const electron = useElectron();
  const [state, setState] = useState<PLPopupState>({ currentPattern: undefined, globalBpm: 120 });
  const [synced, setSynced] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onPatternLibraryPopupState?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const s = payload as Partial<PLPopupState>;
      setState((prev) => ({
        currentPattern: s.currentPattern ?? prev.currentPattern,
        globalBpm: typeof s.globalBpm === "number" ? s.globalBpm : prev.globalBpm,
      }));
      setSynced(true);
    });
    return cleanup;
  }, [electron]);

  useEffect(() => {
    if (!electron.isElectron) return;
    electron.sendPatternLibraryPopupAction?.({ type: "popup-mounted" });
  }, [electron]);

  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isPatternLibraryWindowAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
  }, [electron]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setPatternLibraryWindowAlwaysOnTop?.(next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  const handleLoadPattern = (pattern: PatternData) => {
    electron.sendPatternLibraryPopupAction?.({ type: "load-pattern", pattern });
  };

  if (!electron.isElectron) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">PATTERN LIBRARY</h1>
          <p className="text-text-muted">Nur in Electron verfügbar.</p>
        </div>
      </div>
    );
  }
  if (!synced) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">PATTERN LIBRARY</h1>
          <p className="text-text-muted">Verbinde mit Haupt-Fenster...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <DetachableWindowHeader
        title="Pattern Library"
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closePatternLibraryWindow?.()}
        testIdPrefix="pattern-library-popup"
      />
      <div className="flex-1 overflow-hidden">
        <PatternLibrary
          currentPattern={state.currentPattern}
          globalBpm={state.globalBpm}
          onLoadPattern={handleLoadPattern}
        />
      </div>
    </div>
  );
}
