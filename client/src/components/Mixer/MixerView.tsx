/**
 * Synthstudio – MixerView.tsx
 *
 * Dedizierter Mixer mit Channel-Strips für alle DrumMachine-Kanäle.
 * Features:
 * - Vertikaler Fader (Volume 0–1, mit dB-Anzeige)
 * - Pan-Regler (-1..+1)
 * - Mute / Solo Buttons
 * - VU-Meter (animiert via requestAnimationFrame)
 * - Send-Level zu globalem Reverb + Delay-Bus
 * - Master-Fader rechts
 */

import React, { useEffect, useRef, useCallback } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { MixerState, MixerActions } from "@/store/useMixerStore";
import { AudioEngine } from "@/audio/AudioEngine";

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function volToDb(vol: number): string {
  if (vol <= 0) return "-∞";
  const db = 20 * Math.log10(Math.max(0.001, vol));
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

function vuColor(level: number): string {
  if (level > 0.9) return "#ef4444"; // rot – Clip
  if (level > 0.7) return "#f59e0b"; // gelb – heiß
  return "var(--theme-accent, #06b6d4)"; // Cyan/Theme-Farbe
}

// ─── VU-Meter ────────────────────────────────────────────────────────────────

function VuMeter({ level }: { level: number }) {
  const NUM_SEGMENTS = 16;
  return (
    <div className="flex flex-col-reverse gap-px h-32 w-3">
      {Array.from({ length: NUM_SEGMENTS }, (_, i) => {
        const threshold = (i + 1) / NUM_SEGMENTS;
        const active = level >= threshold;
        const color =
          i >= 14 ? "#ef4444" :
          i >= 11 ? "#f59e0b" :
          "var(--theme-accent, #06b6d4)";
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-opacity duration-75"
            style={{
              backgroundColor: active ? color : "#1e293b",
              opacity: active ? 1 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Mixer-Kanal ─────────────────────────────────────────────────────────────

interface MixerChannelProps {
  partId: string;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  sendReverb: number;
  sendDelay: number;
  peakLevel: number;
  isMaster?: boolean;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onSendChange: (bus: "reverb" | "delay", v: number) => void;
}

function MixerChannel({
  name, volume, pan, muted, soloed,
  sendReverb, sendDelay, peakLevel,
  isMaster,
  onVolumeChange, onPanChange, onMuteToggle, onSoloToggle, onSendChange,
}: MixerChannelProps) {
  const labelColor = muted ? "text-slate-600" : soloed ? "text-yellow-400" : "text-slate-300";

  return (
    <div
      className={[
        "flex flex-col items-center gap-1 px-2 py-2 select-none",
        "border-r border-slate-800 last:border-r-0",
        isMaster ? "bg-slate-900/60 border-l border-slate-700 pl-3" : "",
        muted ? "opacity-50" : "",
      ].join(" ")}
      style={{ minWidth: isMaster ? "64px" : "52px" }}
    >
      {/* Kanalname */}
      <span
        className={`text-[9px] font-medium uppercase tracking-wide truncate w-full text-center ${labelColor}`}
        title={name}
      >
        {name}
      </span>

      {/* VU-Meter + Fader nebeneinander */}
      <div className="flex items-end gap-1 h-32">
        <VuMeter level={peakLevel} />

        {/* Vertikaler Fader */}
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          className="h-32 w-3 accent-cyan-500 cursor-pointer"
          style={{ writingMode: "vertical-lr", direction: "rtl", appearance: "slider-vertical" as React.CSSProperties["appearance"] }}
          title={volToDb(volume)}
        />
      </div>

      {/* dB-Anzeige */}
      <span className="text-[8px] text-slate-500 font-mono">{volToDb(volume)}</span>

      {/* Pan-Regler */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-slate-600 uppercase">Pan</span>
        <input
          type="range"
          min={-1} max={1} step={0.01}
          value={pan}
          onChange={e => onPanChange(parseFloat(e.target.value))}
          className="w-full accent-cyan-500 cursor-pointer"
          title={pan === 0 ? "C" : pan > 0 ? `R ${Math.round(pan * 100)}` : `L ${Math.round(-pan * 100)}`}
        />
        <span className="text-[8px] text-slate-500 font-mono">
          {pan === 0 ? "C" : pan > 0 ? `R${Math.round(pan * 100)}` : `L${Math.round(-pan * 100)}`}
        </span>
      </div>

      {/* Mute / Solo */}
      {!isMaster && (
        <div className="flex gap-1">
          <button
            onClick={onMuteToggle}
            title="Mute (M)"
            className={[
              "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
              muted
                ? "bg-orange-600 text-white"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-orange-400",
            ].join(" ")}
          >
            M
          </button>
          <button
            onClick={onSoloToggle}
            title="Solo (S)"
            className={[
              "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
              soloed
                ? "bg-yellow-500 text-slate-900"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-yellow-400",
            ].join(" ")}
          >
            S
          </button>
        </div>
      )}

      {/* Send-Regler (nur für normale Kanäle) */}
      {!isMaster && (
        <div className="flex flex-col gap-1 w-full mt-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[7px] text-purple-400 uppercase">Rev</span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={sendReverb}
              onChange={e => onSendChange("reverb", parseFloat(e.target.value))}
              className="w-full accent-purple-500 cursor-pointer"
            />
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[7px] text-blue-400 uppercase">Dly</span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={sendDelay}
              onChange={e => onSendChange("delay", parseFloat(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MixerView ───────────────────────────────────────────────────────────────

interface MixerViewProps {
  dm: DrumMachineState & DrumMachineActions;
  mixer: MixerState & MixerActions;
  className?: string;
}

export function MixerView({ dm, mixer, className = "" }: MixerViewProps) {
  const pattern = dm.getActivePattern();
  const parts = pattern?.parts ?? [];

  // VU-Meter Animation via requestAnimationFrame
  // (vereinfacht: setzt peakLevel via AnalyserNode wenn verfügbar)
  const analyserMap = useRef<Map<string, AnalyserNode>>(new Map());
  const rafRef = useRef<number>(0);

  const updateVu = useCallback(() => {
    analyserMap.current.forEach((analyser, partId) => {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      mixer.setChannelPeakLevel(partId, Math.min(1, peak));
    });
    rafRef.current = requestAnimationFrame(updateVu);
  }, [mixer]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateVu);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateVu]);

  // Kanäle im Mixer-Store sicherstellen
  useEffect(() => {
    parts.forEach(p => mixer.ensureChannel(p.id));
  }, [parts, mixer]);

  const handleVolumeChange = useCallback((partId: string, vol: number) => {
    dm.setPartVolume(partId, vol);
    AudioEngine.setChannelVolume(partId, vol);
  }, [dm]);

  const handlePanChange = useCallback((partId: string, pan: number) => {
    dm.setPartPan(partId, pan);
    AudioEngine.setChannelPan(partId, pan);
  }, [dm]);

  const handleSendChange = useCallback((partId: string, bus: "reverb" | "delay", level: number) => {
    mixer.setChannelSend(partId, bus, level);
    AudioEngine.setChannelSend(partId, bus, level);
  }, [mixer]);

  const handleMasterVolume = useCallback((vol: number) => {
    mixer.setMasterVolume(vol);
    AudioEngine.setMasterVolume(vol);
  }, [mixer]);

  return (
    <div className={`flex flex-col h-full bg-[#0a0a0a] overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center px-4 py-2 border-b border-slate-800 bg-[#0d0d0d]">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Mixer</span>
        <span className="ml-3 text-[10px] text-slate-700">
          {parts.length} Kanäle · Global: Reverb + Delay Send
        </span>
      </div>

      {/* Channel Strips */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full items-stretch">
          {parts.map(part => {
            const ch = mixer.channels[part.id];
            return (
              <MixerChannel
                key={part.id}
                partId={part.id}
                name={part.name}
                volume={part.volume}
                pan={part.pan}
                muted={part.muted}
                soloed={part.soloed}
                sendReverb={ch?.sends.reverb ?? 0}
                sendDelay={ch?.sends.delay ?? 0}
                peakLevel={ch?.peakLevel ?? 0}
                onVolumeChange={vol => handleVolumeChange(part.id, vol)}
                onPanChange={pan => handlePanChange(part.id, pan)}
                onMuteToggle={() => dm.setPartMuted(part.id, !part.muted)}
                onSoloToggle={() => dm.setPartSoloed(part.id, !part.soloed)}
                onSendChange={(bus, level) => handleSendChange(part.id, bus, level)}
              />
            );
          })}

          {/* Master-Kanal */}
          <MixerChannel
            partId="__master__"
            name="Master"
            volume={mixer.masterVolume}
            pan={0}
            muted={false}
            soloed={false}
            sendReverb={0}
            sendDelay={0}
            peakLevel={0}
            isMaster
            onVolumeChange={handleMasterVolume}
            onPanChange={() => {}}
            onMuteToggle={() => {}}
            onSoloToggle={() => {}}
            onSendChange={() => {}}
          />
        </div>
      </div>

      {/* Bus-Labels */}
      <div className="flex gap-4 px-4 py-1 border-t border-slate-800 bg-[#0d0d0d]">
        <span className="text-[9px] text-purple-400 uppercase tracking-wide">
          ● Global Reverb Bus
        </span>
        <span className="text-[9px] text-blue-400 uppercase tracking-wide">
          ● Global Delay Bus
        </span>
      </div>
    </div>
  );
}
