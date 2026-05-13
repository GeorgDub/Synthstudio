/**
 * MixerPopupApp.tsx — separates Mixer-Fenster (Multi-Window-Workspace,
 * post-v1.26.0).
 *
 * Wird gerendert wenn die App mit URL-Param `?mixerPopup=1` gestartet wird.
 * Singleton wie das Performance-Popup — pro Session ein Mixer-Fenster.
 *
 * Scope (Phase 1):
 *   - Channel-Strips mit Volume-Slider, Pan-Slider, Mute/Solo
 *   - Master-Volume
 *   - BPM-Anzeige
 *   - Live-Sync: jede Änderung im Main spiegelt sich live im Popup wider und
 *     umgekehrt.
 *
 * NICHT in Phase 1 (bleiben im Haupt-Fenster):
 *   - VU-Meter (Live-Audio-Levels)
 *   - Spectrum Analyzer (Live-FFT)
 *   - Channel-Inspector mit FX-Controls (FX-Window deckt das bereits ab)
 *   - Audio-Track-Strips
 *   - Export-Panel
 *
 * State-Sync-Architektur (identisch zu PerformancePopupApp + FxPopupApp):
 *   - Main-Renderer schickt `mixer-sync:state` Events
 *   - Popup-Aktionen via `mixer-sync:action` zurück
 */
import { useEffect, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";

// ─── State-Sync-Schema ────────────────────────────────────────────────────────

/** Minimaler Channel-Strip-State pro Part. */
export interface MixerPopupChannel {
  partId: string;
  name: string;
  volume: number; // 0..1
  pan: number;    // -1..+1
  muted: boolean;
  soloed: boolean;
}

/** Vollständiger Snapshot, der vom Main-Renderer ins Popup geschickt wird. */
export interface MixerPopupState {
  channels: MixerPopupChannel[];
  masterVolume: number; // 0..1
  bpm: number;
  selectedPartId: string | null;
}

/** Action-Payload, das vom Popup ins Main-Renderer dispatched wird. */
export type MixerPopupAction =
  | { type: "request-state" }
  | { type: "set-part-volume"; partId: string; volume: number }
  | { type: "set-part-pan"; partId: string; pan: number }
  | { type: "set-part-mute"; partId: string; muted: boolean }
  | { type: "set-part-solo"; partId: string; soloed: boolean; shiftKey: boolean }
  | { type: "select-part"; partId: string }
  | { type: "set-master-volume"; volume: number };

const INITIAL_STATE: MixerPopupState = {
  channels: [],
  masterVolume: 1,
  bpm: 120,
  selectedPartId: null,
};

// ─── Komponente ───────────────────────────────────────────────────────────────

export function MixerPopupApp() {
  const electron = useElectron();
  const [state, setState] = useState<MixerPopupState>(INITIAL_STATE);
  const [synced, setSynced] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  // State-Sync vom Main empfangen
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onMixerPopupState?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const s = payload as Partial<MixerPopupState>;
      setState((prev) => ({
        ...prev,
        ...s,
        channels: Array.isArray(s.channels) ? s.channels : prev.channels,
      }));
      setSynced(true);
    });
    return cleanup;
  }, [electron]);

  // Initial-Sync anfragen (NUR auf Mount — BUG-023: vorher [electron]-dep
  // führte zu Re-Send auf jedem Render weil useElectron() neue Refs zurückgibt,
  // was nach Popup-Close den mixerPopupOpen-State zurück auf true gestellt hat)
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.sendMixerPopupAction?.({ type: "request-state" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always-on-top initial laden
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isMixerWindowAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
  }, [electron]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setMixerWindowAlwaysOnTop?.(next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  const dispatchAction = (action: MixerPopupAction) => {
    electron.sendMixerPopupAction?.(action);
    // Optimistic local update so UI feels responsive
    setState((prev) => applyActionLocally(prev, action));
  };

  if (!electron.isElectron) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">MIXER</h1>
          <p className="text-text-muted">
            Das separate Mixer-Fenster ist aktuell nur in der Electron-Desktop-App verfügbar.
          </p>
        </div>
      </div>
    );
  }

  if (!synced) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">MIXER</h1>
          <p className="text-text-muted">Verbinde mit Haupt-Fenster...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <DetachableWindowHeader
        title="Mixer"
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closeMixerWindow?.()}
        testIdPrefix="mixer-popup"
      />

      {/* BPM-Anzeige links oben */}
      <div className="flex items-center px-3 py-1.5 border-b border-border-color text-[10px] text-text-dim uppercase tracking-wider">
        <span>BPM: <span className="text-text-primary font-mono">{state.bpm.toFixed(1)}</span></span>
        <span className="ml-auto">Channels: <span className="text-text-primary">{state.channels.length}</span></span>
      </div>

      {/* Channel-Strips horizontal scrollbar */}
      <div className="flex-1 overflow-auto p-3">
        <div className="flex gap-2 h-full" data-testid="mixer-popup-channels">
          {state.channels.map((channel) => (
            <ChannelStripPopup
              key={channel.partId}
              channel={channel}
              selected={state.selectedPartId === channel.partId}
              onSelect={() => dispatchAction({ type: "select-part", partId: channel.partId })}
              onVolumeChange={(v) => dispatchAction({ type: "set-part-volume", partId: channel.partId, volume: v })}
              onPanChange={(p) => dispatchAction({ type: "set-part-pan", partId: channel.partId, pan: p })}
              onMuteToggle={() => dispatchAction({ type: "set-part-mute", partId: channel.partId, muted: !channel.muted })}
              onSoloToggle={(shiftKey) =>
                dispatchAction({ type: "set-part-solo", partId: channel.partId, soloed: !channel.soloed, shiftKey })
              }
            />
          ))}

          {/* Master-Strip rechts */}
          <MasterStrip
            volume={state.masterVolume}
            onVolumeChange={(v) => dispatchAction({ type: "set-master-volume", volume: v })}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Channel-Strip ────────────────────────────────────────────────────────────

interface ChannelStripPopupProps {
  channel: MixerPopupChannel;
  selected: boolean;
  onSelect: () => void;
  onVolumeChange: (v: number) => void;
  onPanChange: (p: number) => void;
  onMuteToggle: () => void;
  onSoloToggle: (shiftKey: boolean) => void;
}

function ChannelStripPopup({
  channel,
  selected,
  onSelect,
  onVolumeChange,
  onPanChange,
  onMuteToggle,
  onSoloToggle,
}: ChannelStripPopupProps) {
  return (
    <div
      onClick={onSelect}
      data-testid={`mixer-popup-channel-${channel.partId}`}
      className={[
        "w-20 flex flex-col items-center gap-2 p-2 rounded border cursor-pointer flex-shrink-0",
        selected ? "border-accent-primary bg-bg-elevated" : "border-border-color bg-bg-panel hover:border-accent-secondary",
      ].join(" ")}
    >
      <div className="text-[10px] font-medium text-text-primary truncate w-full text-center">
        {channel.name}
      </div>

      {/* Mute / Solo */}
      <div className="flex gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onMuteToggle(); }}
          aria-label={channel.muted ? "Stumm aufheben" : "Stumm schalten"}
          data-testid={`mixer-popup-mute-${channel.partId}`}
          className={[
            "w-6 h-5 rounded text-[9px] font-bold transition-colors",
            channel.muted ? "bg-accent-danger text-white" : "bg-bg-elevated text-text-dim hover:text-text-primary",
          ].join(" ")}
        >
          M
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSoloToggle(e.shiftKey); }}
          aria-label={channel.soloed ? "Solo aufheben" : "Solo aktivieren"}
          data-testid={`mixer-popup-solo-${channel.partId}`}
          className={[
            "w-6 h-5 rounded text-[9px] font-bold transition-colors",
            channel.soloed ? "bg-accent-success text-bg-base" : "bg-bg-elevated text-text-dim hover:text-text-primary",
          ].join(" ")}
        >
          S
        </button>
      </div>

      {/* Pan */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-text-dim uppercase tracking-wide">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={channel.pan}
          onChange={(e) => onPanChange(parseFloat(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="w-full accent-accent-primary cursor-pointer"
          data-testid={`mixer-popup-pan-${channel.partId}`}
        />
        <span className="text-[8px] text-text-muted font-mono">
          {channel.pan === 0 ? "C" : channel.pan < 0 ? `L${Math.round(-channel.pan * 100)}` : `R${Math.round(channel.pan * 100)}`}
        </span>
      </div>

      {/* Volume — vertical fader */}
      <div className="flex flex-col items-center gap-0.5 flex-1 w-full">
        <span className="text-[8px] text-text-dim uppercase tracking-wide">Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={channel.volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="w-full accent-accent-primary cursor-pointer"
          style={{ writingMode: "vertical-lr" as unknown as undefined, direction: "rtl" } as React.CSSProperties}
          data-testid={`mixer-popup-volume-${channel.partId}`}
        />
        <span className="text-[8px] text-text-muted font-mono">
          {Math.round(channel.volume * 100)}
        </span>
      </div>
    </div>
  );
}

// ─── Master-Strip ─────────────────────────────────────────────────────────────

function MasterStrip({ volume, onVolumeChange }: { volume: number; onVolumeChange: (v: number) => void }) {
  return (
    <div
      data-testid="mixer-popup-master"
      className="w-20 flex flex-col items-center gap-2 p-2 rounded border border-accent-secondary bg-bg-elevated flex-shrink-0 ml-2"
    >
      <div className="text-[10px] font-bold text-accent-secondary uppercase tracking-wider">
        Master
      </div>
      <div className="flex-1 w-full flex flex-col items-center gap-0.5">
        <span className="text-[8px] text-text-dim uppercase tracking-wide">Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-full accent-accent-secondary cursor-pointer flex-1"
          style={{ writingMode: "vertical-lr" as unknown as undefined, direction: "rtl" } as React.CSSProperties}
          data-testid="mixer-popup-master-volume"
        />
        <span className="text-[8px] text-text-muted font-mono">
          {Math.round(volume * 100)}
        </span>
      </div>
    </div>
  );
}

// ─── Optimistic local-state update ────────────────────────────────────────────

function applyActionLocally(state: MixerPopupState, action: MixerPopupAction): MixerPopupState {
  switch (action.type) {
    case "set-part-volume":
      return {
        ...state,
        channels: state.channels.map((c) =>
          c.partId === action.partId ? { ...c, volume: action.volume } : c,
        ),
      };
    case "set-part-pan":
      return {
        ...state,
        channels: state.channels.map((c) =>
          c.partId === action.partId ? { ...c, pan: action.pan } : c,
        ),
      };
    case "set-part-mute":
      return {
        ...state,
        channels: state.channels.map((c) =>
          c.partId === action.partId ? { ...c, muted: action.muted } : c,
        ),
      };
    case "set-part-solo":
      // Optimistic: nur den geänderten Channel umlegen; das Main wird die
      // exclusive-vs-additive-Logik korrekt anwenden und uns den finalen
      // Snapshot zurückspielen.
      return {
        ...state,
        channels: state.channels.map((c) =>
          c.partId === action.partId ? { ...c, soloed: action.soloed } : c,
        ),
      };
    case "select-part":
      return { ...state, selectedPartId: action.partId };
    case "set-master-volume":
      return { ...state, masterVolume: action.volume };
    case "request-state":
      return state;
  }
}
