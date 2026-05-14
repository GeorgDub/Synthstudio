/**
 * FxPopupApp.tsx — separates pinnable FX-Window pro Kanal
 * (Multi-Window-Workspace Phase 1, post-v1.25.0).
 *
 * Wird gerendert wenn die App mit URL-Param `?fxPopup=<channelId>` gestartet
 * wird. Im Electron-Mode öffnet der Main-Process via `createFxWindow()` ein
 * eigenes BrowserWindow pro Kanal — der User kann mehrere FX-Panels gleichzeitig
 * neben dem Haupt-Fenster offen halten.
 *
 * State-Sync-Architektur (identisch zu PerformancePopupApp):
 *   - Main-Renderer schickt `fx-sync:state` Events mit { channelId, state }.
 *     `state` enthält `{ name, fx }` für den Kanal.
 *   - Parameter-Änderungen im Popup → `fx-sync:action` (channelId + Partial<ChannelFx>)
 *     ins Main-Renderer dispatched, der den Store via setPartFx aktualisiert.
 *
 * Im Web-Fallback nicht verfügbar — analog Performance-Popup.
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { FxPanelBody } from "./FxPanel";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";
import type { ChannelFx } from "@/audio/AudioEngine";

/** Vollständiger State-Snapshot pro Kanal, vom Main-Renderer geschickt. */
export interface FxPopupState {
  partId: string;
  partName: string;
  fx: ChannelFx;
}

/** Action-Payload, das vom Popup zum Main-Renderer geht. */
export type FxPopupAction =
  | { type: "request-state" }
  | { type: "fx-change"; partial: Partial<ChannelFx> };

export interface FxPopupAppProps {
  channelId: string;
}

export function FxPopupApp({ channelId }: FxPopupAppProps) {
  const electron = useElectron();
  const [state, setState] = useState<FxPopupState | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  // State-Sync vom Main-Renderer empfangen (gefiltert auf eigene channelId)
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onFxPopupState?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      if (payload.channelId !== channelId) return;
      const incoming = payload.state as Partial<FxPopupState> | undefined;
      if (!incoming || typeof incoming !== "object" || !incoming.fx) return;
      setState({
        partId: incoming.partId ?? channelId,
        partName: incoming.partName ?? channelId,
        fx: incoming.fx,
      });
    });
    return cleanup;
  }, [electron, channelId]);

  // Initial-Request an Main — nur einmal pro channelId (BUG-023)
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.sendFxPopupAction?.(channelId, { type: "request-state" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Always-on-top initial laden
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isFxWindowAlwaysOnTop?.(channelId).then(setAlwaysOnTop).catch(() => {});
  }, [electron, channelId]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setFxWindowAlwaysOnTop?.(channelId, next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  const handleFxChange = (partial: Partial<ChannelFx>) => {
    electron.sendFxPopupAction?.(channelId, { type: "fx-change", partial });
    // Optimistic UI: lokal sofort updaten damit der Popup responsive ist
    setState((prev) => (prev ? { ...prev, fx: { ...prev.fx, ...partial } } : prev));
  };

  if (!electron.isElectron) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">FX</h1>
          <p className="text-text-muted">
            Das separate FX-Fenster ist aktuell nur in der Electron-Desktop-App verfügbar.
          </p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">FX</h1>
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
        title={`FX — ${state.partName}`}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closeFxWindow?.(channelId)}
        testIdPrefix="fx-popup"
      />

      <div className="flex-1 overflow-auto p-3">
        <FxPanelBody fx={state.fx} onFxChange={handleFxChange} partId={state.partId} partName={state.partName} />
      </div>
    </div>
  );
}
