/**
 * ChordProgressionPopupApp.tsx — separates Chord-Progression-Fenster (post-v1.28.0).
 *
 * Wrap-and-go: `ChordProgressionPanel` ohne Refactor + DetachableWindowHeader.
 * Bps wird via IPC gespiegelt. Akkord-Vorschau-Playback läuft im Popup-Renderer
 * lokal (WebAudio).
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";
import { ChordProgressionPanel } from "./ChordProgressionPanel";

interface CPPopupState { bpm: number; }

export type ChordProgressionPopupAction = { type: "popup-mounted" };

export function ChordProgressionPopupApp() {
  const electron = useElectron();
  const [state, setState] = useState<CPPopupState>({ bpm: 120 });
  const [synced, setSynced] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onChordProgressionPopupState?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const s = payload as Partial<CPPopupState>;
      setState((prev) => ({ bpm: typeof s.bpm === "number" ? s.bpm : prev.bpm }));
      setSynced(true);
    });
    return cleanup;
  }, [electron]);

  useEffect(() => {
    if (!electron.isElectron) return;
    electron.sendChordProgressionPopupAction?.({ type: "popup-mounted" });
  }, [electron]);

  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isChordProgressionWindowAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
  }, [electron]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setChordProgressionWindowAlwaysOnTop?.(next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  if (!electron.isElectron) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">CHORD PROGRESSIONS</h1>
          <p className="text-text-muted">Nur in Electron verfügbar.</p>
        </div>
      </div>
    );
  }
  if (!synced) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">CHORD PROGRESSIONS</h1>
          <p className="text-text-muted">Verbinde mit Haupt-Fenster...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <DetachableWindowHeader
        title="Chord Progressions"
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closeChordProgressionWindow?.()}
        testIdPrefix="chord-progression-popup"
      />
      <div className="flex-1 overflow-auto p-3">
        <ChordProgressionPanel bpm={state.bpm} />
      </div>
    </div>
  );
}
