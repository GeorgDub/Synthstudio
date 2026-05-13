/**
 * KeyboardSamplerPopupApp.tsx — separates Keyboard-Sampler-Fenster (post-v1.28.0).
 *
 * Wrap-and-go: `KeyboardSamplerPanel` wird ohne Refactor in einen
 * DetachableWindowHeader-Frame eingepackt. Samples-Prop wird via IPC vom Main
 * gespiegelt. Der Store (`useKeyboardSamplerStore`) ist localStorage-persistent,
 * daher haben beide Renderer denselben Mapping-State (kein extra Sync nötig).
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";
import { KeyboardSamplerPanel } from "./KeyboardSamplerPanel";
import type { Sample } from "@/store/useProjectStore";

interface KSPopupState { samples: Sample[]; }

export type KeyboardSamplerPopupAction = { type: "popup-mounted" };

export function KeyboardSamplerPopupApp() {
  const electron = useElectron();
  const [state, setState] = useState<KSPopupState>({ samples: [] });
  const [synced, setSynced] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onKeyboardSamplerPopupState?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const s = payload as Partial<KSPopupState>;
      setState((prev) => ({ samples: Array.isArray(s.samples) ? s.samples : prev.samples }));
      setSynced(true);
    });
    return cleanup;
  }, [electron]);

  useEffect(() => {
    if (!electron.isElectron) return;
    electron.sendKeyboardSamplerPopupAction?.({ type: "popup-mounted" });
  }, [electron]);

  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isKeyboardSamplerWindowAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
  }, [electron]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setKeyboardSamplerWindowAlwaysOnTop?.(next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  if (!electron.isElectron) {
    return <PopupUnavailable title="KEYBOARD SAMPLER" />;
  }
  if (!synced) {
    return <PopupWaiting title="KEYBOARD SAMPLER" />;
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <DetachableWindowHeader
        title="Keyboard Sampler"
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closeKeyboardSamplerWindow?.()}
        testIdPrefix="keyboard-sampler-popup"
      />
      <div className="flex-1 overflow-auto p-3">
        <KeyboardSamplerPanel samples={state.samples} />
      </div>
    </div>
  );
}

function PopupUnavailable({ title }: { title: string }) {
  return (
    <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
      <div>
        <h1 className="text-accent-secondary text-2xl font-bold mb-2">{title}</h1>
        <p className="text-text-muted">
          Das separate Fenster ist nur in der Electron-Desktop-App verfügbar.
        </p>
      </div>
    </div>
  );
}

function PopupWaiting({ title }: { title: string }) {
  return (
    <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
      <div>
        <h1 className="text-accent-secondary text-2xl font-bold mb-2">{title}</h1>
        <p className="text-text-muted">Verbinde mit Haupt-Fenster...</p>
      </div>
    </div>
  );
}
