/**
 * Synthstudio – LiveInputStrip.tsx (TASK-233 / v2.85)
 *
 * Mixer-Channel-Strip für einen Live-Input (USB-Audio von KORG-Hardware etc.).
 * Analog zu AudioTrackStrip, aber für Realtime-Streams.
 *
 * UI-Features:
 *  - Device-Picker (navigator.mediaDevices.enumerateDevices)
 *  - Volume / Pan / Mute / Solo
 *  - Send-Knobs (Reverb / Delay)
 *  - Latency-Compensation-Slider (0..200 ms, advanced)
 *  - Remove-Button
 *  - Connect / Disconnect (toggle attachLiveInput vs detachLiveInput)
 *  - Permission-Denied-Banner
 *  - Status-LED grün/rot je nach attached-State
 *
 * Eingang/Ausgang läuft komplett über AudioEngine (FX-Chain wie drum-part).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "@/audio/AudioEngine";
import {
  updateLiveInputChannel,
  removeLiveInputChannel,
  setLiveInputSoloed,
  setLiveInputRecordArm,
  type LiveInputChannelData,
} from "@/store/useLiveInputStore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function volToDb(vol: number): string {
  if (vol <= 0) return "-∞";
  const db = 20 * Math.log10(Math.max(0.001, vol));
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

interface AudioInputDeviceOption {
  deviceId: string;
  label: string;
}

// ─── Komponente ──────────────────────────────────────────────────────────────

export interface LiveInputStripProps {
  channel: LiveInputChannelData;
}

export function LiveInputStrip({ channel }: LiveInputStripProps) {
  const [devices, setDevices] = useState<AudioInputDeviceOption[]>([]);
  const [attached, setAttached] = useState<boolean>(() => AudioEngine.isLiveInputAttached(channel.id));
  const [permError, setPermError] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);

  // Hardware-Indikator-LED: Stream attached?
  useEffect(() => {
    setAttached(AudioEngine.isLiveInputAttached(channel.id));
  }, [channel.id, channel.deviceId]);

  // Devices enumerieren (manche Devices erscheinen erst nach Permission-Grant)
  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Eingang ${d.deviceId.slice(0, 6) || "(unbenannt)"}`,
        }));
      setDevices(inputs);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);

  // Auf devicechange-Events lauschen (Hot-Plug/Unplug)
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const handler = () => { void refreshDevices(); };
    navigator.mediaDevices.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener?.("devicechange", handler);
    };
  }, [refreshDevices]);

  // Audio-Engine-State synchronisieren mit Store
  useEffect(() => {
    AudioEngine.setChannelVolume(channel.id, channel.muted ? 0 : channel.volume);
    AudioEngine.setChannelPan(channel.id, channel.pan);
    AudioEngine.setChannelSend(channel.id, "reverb", channel.sends.reverb);
    AudioEngine.setChannelSend(channel.id, "delay", channel.sends.delay);
    AudioEngine.setLiveInputLatencyMs(channel.id, channel.latencyCompensationMs);
  }, [channel.id, channel.volume, channel.muted, channel.pan, channel.sends.reverb, channel.sends.delay, channel.latencyCompensationMs]);

  const handleAttach = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    setAttachBusy(true);
    setPermError(null);
    try {
      await AudioEngine.attachLiveInput(channel.id, deviceId);
      setAttached(true);
      // Nach erstem Grant erscheinen Labels — refresh.
      void refreshDevices();
      const label = devices.find((d) => d.deviceId === deviceId)?.label;
      updateLiveInputChannel(channel.id, { deviceId, deviceLabel: label });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPermError(
        msg.includes("Permission") || msg.includes("NotAllowed")
          ? "Mikrofon-Berechtigung verweigert"
          : `Fehler: ${msg}`,
      );
      setAttached(false);
    } finally {
      setAttachBusy(false);
    }
  }, [channel.id, devices, refreshDevices]);

  const handleDetach = useCallback(() => {
    AudioEngine.detachLiveInput(channel.id);
    setAttached(false);
  }, [channel.id]);

  const handleRemove = useCallback(() => {
    // TASK-234: aktive Aufnahme abräumen (kein Encode — Channel verschwindet).
    AudioEngine.cancelRecording(channel.id);
    AudioEngine.detachLiveInput(channel.id);
    removeLiveInputChannel(channel.id);
  }, [channel.id]);

  const handleVolumeChange = useCallback((v: number) => {
    updateLiveInputChannel(channel.id, { volume: v });
  }, [channel.id]);

  const handlePanChange = useCallback((v: number) => {
    updateLiveInputChannel(channel.id, { pan: v });
  }, [channel.id]);

  const handleSendChange = useCallback((bus: "reverb" | "delay", v: number) => {
    updateLiveInputChannel(channel.id, {
      sends: { ...channel.sends, [bus]: v },
    });
  }, [channel.id, channel.sends]);

  const handleMuteToggle = useCallback(() => {
    updateLiveInputChannel(channel.id, { muted: !channel.muted });
  }, [channel.id, channel.muted]);

  const handleSoloToggle = useCallback((shiftKey: boolean) => {
    setLiveInputSoloed(channel.id, !channel.soloed, !shiftKey);
  }, [channel.id, channel.soloed]);

  const handleRecArmToggle = useCallback(() => {
    setLiveInputRecordArm(channel.id, !channel.recordArmed);
  }, [channel.id, channel.recordArmed]);

  // Recording-Status: vom AudioEngine pollen während transport läuft.
  const [isRec, setIsRec] = useState(false);
  useEffect(() => {
    if (!channel.recordArmed) {
      setIsRec(false);
      return;
    }
    const tick = () => setIsRec(AudioEngine.isRecordingChannel(channel.id));
    tick();
    const handle = window.setInterval(tick, 250);
    return () => window.clearInterval(handle);
  }, [channel.id, channel.recordArmed]);

  const handleLatencyChange = useCallback((ms: number) => {
    updateLiveInputChannel(channel.id, { latencyCompensationMs: ms });
  }, [channel.id]);

  const handleNameChange = useCallback((newName: string) => {
    updateLiveInputChannel(channel.id, { name: newName.trim() || channel.name });
  }, [channel.id, channel.name]);

  const labelColor = channel.muted ? "text-text-dim" : channel.soloed ? "text-accent-success" : "text-text-primary";

  return (
    <div
      data-testid={`liveinput-strip-${channel.id}`}
      data-live-input-channel-id={channel.id}
      className="flex flex-col items-center gap-1 px-2 py-2 select-none border-r border-border-color last:border-r-0"
      style={{ minWidth: "78px" }}
    >
      {/* Type-Indicator + Name */}
      <div className="flex items-center gap-1 w-full">
        <span
          className="text-[8px] font-bold uppercase px-1 rounded bg-accent-secondary/20 text-accent-secondary tracking-wider"
          title="Live Input (USB-Audio)"
        >
          IN
        </span>
        <span
          className={`flex-1 text-[9px] font-medium truncate ${labelColor}`}
          title={channel.name}
        >
          {channel.name}
        </span>
        <button
          type="button"
          onClick={handleRemove}
          aria-label="Live-Input entfernen"
          title="Channel entfernen + Stream stoppen"
          className="text-[9px] text-text-dim hover:text-accent-danger"
        >
          ✕
        </button>
      </div>

      {/* Device-Picker */}
      <select
        data-testid={`liveinput-device-select-${channel.id}`}
        value={channel.deviceId ?? ""}
        onChange={(e) => {
          const newId = e.target.value;
          if (!newId) {
            handleDetach();
            updateLiveInputChannel(channel.id, { deviceId: null });
          } else {
            void handleAttach(newId);
          }
        }}
        disabled={attachBusy}
        className="w-full text-[9px] bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-text-primary"
        title="Audio-Input-Gerät wählen"
      >
        <option value="">— kein Gerät —</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>

      {/* Status-LED */}
      <div className="flex items-center gap-1 w-full text-[8px]">
        <span
          aria-label={attached ? "verbunden" : "nicht verbunden"}
          title={attached ? "Live-Stream aktiv" : "Kein Stream"}
          className={`w-2 h-2 rounded-full ${attached ? "bg-accent-success" : "bg-text-dim/40"}`}
        />
        <span className="text-text-dim">{attached ? "live" : "off"}</span>
      </div>

      {permError && (
        <div className="text-[8px] text-accent-danger text-center" role="alert">
          {permError}
        </div>
      )}

      {/* Fader */}
      <input
        type="range"
        min={0} max={1.5} step={0.01}
        value={channel.volume}
        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
        className="h-32 w-3 accent-accent-primary cursor-pointer"
        style={{ writingMode: "vertical-lr", direction: "rtl", appearance: "slider-vertical" as React.CSSProperties["appearance"] }}
        title={`Volume ${volToDb(channel.volume)}`}
        aria-label={`${channel.name} Volume`}
      />
      <span className="text-[8px] text-text-dim font-mono">{volToDb(channel.volume)}</span>

      {/* Pan */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-text-dim uppercase">Pan</span>
        <input
          type="range"
          min={-1} max={1} step={0.01}
          value={channel.pan}
          onChange={(e) => handlePanChange(parseFloat(e.target.value))}
          className="w-full accent-accent-primary cursor-pointer"
          aria-label={`${channel.name} Pan`}
        />
      </div>

      {/* Mute / Solo / Record-Arm */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={handleMuteToggle}
          className={[
            "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
            channel.muted ? "bg-accent-secondary text-bg-base" : "bg-bg-elevated text-text-dim hover:text-accent-secondary",
          ].join(" ")}
          title="Mute"
        >
          M
        </button>
        <button
          type="button"
          onClick={(e) => handleSoloToggle(e.shiftKey)}
          className={[
            "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
            channel.soloed ? "bg-accent-success text-bg-base" : "bg-bg-elevated text-text-dim hover:text-accent-success",
          ].join(" ")}
          title="Solo (Shift+Klick = exclusive)"
        >
          S
        </button>
        {/* Record-Arm (TASK-234) — rot leuchtend wenn armed, blinkend wenn live aufnimmt */}
        <button
          type="button"
          onClick={handleRecArmToggle}
          data-testid={`liveinput-rec-arm-${channel.id}`}
          aria-pressed={!!channel.recordArmed}
          aria-label={`Record-Arm ${channel.name}`}
          className={[
            "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
            channel.recordArmed
              ? `bg-accent-danger text-bg-base ${isRec ? "animate-pulse" : ""}`
              : "bg-bg-elevated text-text-dim hover:text-accent-danger",
          ].join(" ")}
          title={
            channel.recordArmed
              ? isRec
                ? "Aufnahme läuft — bei Stop wird Audio-Track erzeugt"
                : "Record-armed (rec startet bei Play)"
              : "Record-Arm"
          }
        >
          ●
        </button>
      </div>

      {/* Sends */}
      <div className="flex flex-col gap-1 w-full mt-1">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[7px] text-accent-secondary uppercase">Rev</span>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={channel.sends.reverb}
            onChange={(e) => handleSendChange("reverb", parseFloat(e.target.value))}
            className="w-full accent-accent-secondary cursor-pointer"
            aria-label="Reverb Send"
          />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[7px] text-accent-primary uppercase">Dly</span>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={channel.sends.delay}
            onChange={(e) => handleSendChange("delay", parseFloat(e.target.value))}
            className="w-full accent-accent-primary cursor-pointer"
            aria-label="Delay Send"
          />
        </div>
      </div>

      {/* Latency-Compensation (advanced) */}
      <div className="flex flex-col items-center gap-0.5 w-full mt-1 pt-1 border-t border-border-color/30">
        <span className="text-[7px] text-text-dim uppercase" title="Plugin-Delay-Compensation in ms (manuell)">
          Lat {channel.latencyCompensationMs}ms
        </span>
        <input
          type="range"
          min={0} max={200} step={1}
          value={channel.latencyCompensationMs}
          onChange={(e) => handleLatencyChange(parseInt(e.target.value, 10))}
          className="w-full accent-accent-primary cursor-pointer"
          aria-label="Latency Compensation in ms"
          data-testid={`liveinput-latency-${channel.id}`}
        />
      </div>

      {/* Hidden Rename (focusable via aria for advanced users) */}
      <input
        type="text"
        defaultValue={channel.name}
        onBlur={(e) => handleNameChange(e.target.value)}
        className="w-full text-[9px] bg-transparent border-b border-border-color/30 text-center text-text-dim focus:border-accent-primary outline-none"
        title="Channel-Namen ändern (Enter)"
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        aria-label="Channel-Name"
      />
    </div>
  );
}
