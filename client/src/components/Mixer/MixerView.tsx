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

import React, { useEffect, useRef, useCallback, useState } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { MixerState, MixerActions } from "@/store/useMixerStore";
import { AudioEngine } from "@/audio/AudioEngine";
import type { PartData } from "@/audio/AudioEngine";
import { MIXER_FX_TYPES, summarizeEqBands, type MixerFxType } from "@/utils/mixerFx";
import { ExportPanel } from "./ExportPanel";

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

// ─── Spectrum Display ─────────────────────────────────────────────────────────

function SpectrumDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    // Sync canvas resolution to CSS size via ResizeObserver
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
    });
    ro.observe(canvas);
    canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;

    let rafId: number;
    let dataArray: Float32Array<ArrayBuffer> | null = null;

    // Read CSS vars once per frame (cheap, prevents CSS-var string in fillStyle)
    const getCssColor = (varName: string, fallback: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;

    const draw = () => {
      const analyser = AudioEngine.getOutputAnalyser();
      if (!analyser) { rafId = requestAnimationFrame(draw); return; }

      if (!dataArray || dataArray.length !== analyser.frequencyBinCount) {
        dataArray = new Float32Array(analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;
      }
      analyser.getFloatFrequencyData(dataArray);

      const w = canvas.width;
      const h = canvas.height;
      const dpr = window.devicePixelRatio;

      // Background (resolved CSS var, not "var(...)" string — canvas doesn't parse CSS vars)
      ctx2d.fillStyle = getCssColor("--ss-bg-base", "#0a0a0a");
      ctx2d.fillRect(0, 0, w, h);

      // dB grid lines: -72, -48, -24, 0
      const DB_FLOOR = -96; // bottom of display range
      const dbLines = [-72, -48, -24, 0];
      ctx2d.strokeStyle = "rgba(255,255,255,0.07)";
      ctx2d.lineWidth = dpr;
      for (const db of dbLines) {
        const y = h - ((db - DB_FLOOR) / (-DB_FLOOR)) * h;
        ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(w, y); ctx2d.stroke();
      }

      const accentPrimary   = getCssColor("--ss-accent-primary",   "#f59e0b");
      const accentSecondary = getCssColor("--ss-accent-secondary",  "#06b6d4");
      const accentDanger    = getCssColor("--ss-accent-danger",     "#f43f5e");

      // Only display the perceptually relevant bins (0 – 14 kHz ≈ 70% of Nyquist)
      const displayBins = Math.floor(dataArray.length * 0.65);
      const barW = Math.max(dpr, (w / displayBins) - dpr * 0.5);

      for (let i = 0; i < displayBins; i++) {
        const db = dataArray[i]; // Float32: -Infinity..0 dB
        if (!isFinite(db)) continue;
        const norm = Math.max(0, Math.min(1, (db - DB_FLOOR) / (-DB_FLOOR)));
        if (norm < 0.001) continue;
        const barH = norm * h;
        const x = (i / displayBins) * w;

        // Color: bass → secondary, mids → primary, clip → danger
        const t = i / displayBins;
        let color = t < 0.25 ? accentSecondary : accentPrimary;
        if (norm > 0.92) color = accentDanger; // near-clip red

        ctx2d.fillStyle = color;
        ctx2d.globalAlpha = 0.7 + norm * 0.3;
        ctx2d.fillRect(x, h - barH, barW, barH);
      }
      ctx2d.globalAlpha = 1;
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-20 rounded block"
    />
  );
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
  selected?: boolean;
  isMaster?: boolean;
  onSelect?: () => void;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onSendChange: (bus: "reverb" | "delay", v: number) => void;
}

function MixerChannel({
  name, volume, pan, muted, soloed,
  sendReverb, sendDelay, peakLevel,
  selected, isMaster, onSelect,
  onVolumeChange, onPanChange, onMuteToggle, onSoloToggle, onSendChange,
}: MixerChannelProps) {
  const labelColor = muted ? "text-text-dim" : soloed ? "text-yellow-400" : "text-text-primary";

  return (
    <div
      onClick={onSelect}
      className={[
        "flex flex-col items-center gap-1 px-2 py-2 select-none",
        "border-r border-border-color last:border-r-0 cursor-pointer",
        isMaster ? "bg-bg-panel/60 border-l border-border-color pl-3" : "",
        selected ? "bg-cyan-950/25 ring-1 ring-cyan-500/60 ring-inset" : "",
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
          className="h-32 w-3 accent-accent-primary cursor-pointer"
          style={{ writingMode: "vertical-lr", direction: "rtl", appearance: "slider-vertical" as React.CSSProperties["appearance"] }}
          title={volToDb(volume)}
        />
      </div>

      {/* dB-Anzeige */}
      <span className="text-[8px] text-text-dim font-mono">{volToDb(volume)}</span>

      {/* Pan-Regler */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-text-dim uppercase">Pan</span>
        <input
          type="range"
          min={-1} max={1} step={0.01}
          value={pan}
          onChange={e => onPanChange(parseFloat(e.target.value))}
          className="w-full accent-accent-primary cursor-pointer"
          title={pan === 0 ? "C" : pan > 0 ? `R ${Math.round(pan * 100)}` : `L ${Math.round(-pan * 100)}`}
        />
        <span className="text-[8px] text-text-dim font-mono">
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
                : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-orange-400",
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
                : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-yellow-400",
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

// ─── Phase-B Channel Inspector ───────────────────────────────────────────────

interface ChannelInspectorProps {
  part: PartData | undefined;
  parts: PartData[];
  mixer: MixerState & MixerActions;
}

function ChannelInspector({ part, parts, mixer }: ChannelInspectorProps) {
  if (!part) {
    return (
      <aside className="w-80 shrink-0 border-l border-border-color bg-bg-panel p-4 text-xs text-text-dim">
        Kanal im Mixer auswählen
      </aside>
    );
  }

  const chain = mixer.insertChains[part.id] ?? [];
  const eqBands = mixer.eq16[part.id] ?? [];
  const eqSummary = summarizeEqBands(eqBands);
  const sidechain = mixer.sidechains[part.id];
  const transient = mixer.transientShapers[part.id];

  return (
    <aside className="w-80 shrink-0 border-l border-border-color bg-bg-panel overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-border-color bg-bg-panel px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-text-dim">Channel Inspector</div>
        <div className="truncate text-sm font-semibold text-text-primary">{part.name}</div>
      </div>

      <section className="border-b border-border-color p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Insert FX Chain</span>
          <select
            aria-label="Insert FX hinzufügen"
            value=""
            onChange={e => {
              if (!e.target.value) return;
              mixer.addInsertFx(part.id, e.target.value as MixerFxType);
              e.target.value = "";
            }}
            className="rounded bg-bg-panel px-2 py-1 text-[10px] text-text-primary border border-border-color"
          >
            <option value="">Add FX</option>
            {MIXER_FX_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          {chain.length === 0 && (
            <div className="rounded border border-dashed border-border-color px-2 py-3 text-center text-[10px] text-text-dim">
              Keine Inserts
            </div>
          )}
          {chain.map((slot, index) => (
            <div
              key={slot.id}
              className={[
                "flex items-center gap-1 rounded border px-2 py-1.5",
                slot.enabled ? "border-border-color bg-bg-panel/70" : "border-border-color bg-slate-950 text-text-dim",
              ].join(" ")}
            >
              <button
                type="button"
                title="Bypass"
                onClick={() => mixer.toggleInsertFx(part.id, slot.id)}
                className={slot.enabled ? "text-[10px] text-accent-secondary" : "text-[10px] text-text-dim"}
              >
                ON
              </button>
              <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary">{slot.name}</span>
              <button type="button" title="Nach oben" onClick={() => mixer.moveInsertFx(part.id, index, index - 1)} className="text-[10px] text-text-dim hover:text-text-primary">Up</button>
              <button type="button" title="Nach unten" onClick={() => mixer.moveInsertFx(part.id, index, index + 1)} className="text-[10px] text-text-dim hover:text-text-primary">Dn</button>
              <button type="button" title="Entfernen" onClick={() => mixer.removeInsertFx(part.id, slot.id)} className="text-[10px] text-red-400 hover:text-red-300">X</button>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-border-color p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Parametric EQ 16</span>
          <button
            type="button"
            onClick={() => mixer.resetEqBands(part.id)}
            className="rounded bg-bg-elevated px-2 py-1 text-[10px] text-text-muted hover:text-text-primary"
          >
            Reset
          </button>
        </div>
        <div className="flex h-24 items-end gap-1">
          {eqBands.map((band, index) => (
            <div key={band.frequency} className="flex flex-1 flex-col items-center gap-1">
              <input
                aria-label={`EQ Band ${band.frequency} Hz`}
                type="range"
                min={-24}
                max={24}
                step={0.5}
                value={band.gain}
                onChange={e => mixer.setEqBandGain(part.id, index, parseFloat(e.target.value))}
                className="h-16 w-2 accent-accent-primary"
                style={{ writingMode: "vertical-lr", direction: "rtl", appearance: "slider-vertical" as React.CSSProperties["appearance"] }}
                title={`${band.frequency} Hz: ${band.gain.toFixed(1)} dB`}
              />
              <span className="text-[7px] text-text-dim">{index + 1}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[9px] text-text-dim">
          <span>Low {eqSummary.low.toFixed(1)} dB</span>
          <span>Mid {eqSummary.mid.toFixed(1)} dB</span>
          <span>High {eqSummary.high.toFixed(1)} dB</span>
        </div>
      </section>

      <section className="border-b border-border-color p-3">
        <label className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          <input
            type="checkbox"
            checked={sidechain?.enabled ?? false}
            onChange={e => mixer.setSidechain(part.id, { enabled: e.target.checked })}
            className="accent-accent-primary"
          />
          Sidechain Compressor
        </label>
        <select
          aria-label="Sidechain Quelle"
          value={sidechain?.sourcePartId ?? ""}
          onChange={e => mixer.setSidechain(part.id, { sourcePartId: e.target.value || null })}
          className="mb-2 w-full rounded border border-border-color bg-bg-panel px-2 py-1 text-xs text-text-primary"
        >
          <option value="">Quelle wählen</option>
          {parts.filter(p => p.id !== part.id).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <ControlRow label="Amount" value={sidechain?.amount ?? 0.5} min={0} max={1} step={0.01} onChange={v => mixer.setSidechain(part.id, { amount: v })} />
        <ControlRow label="Attack" value={sidechain?.attack ?? 0.01} min={0.001} max={1} step={0.001} onChange={v => mixer.setSidechain(part.id, { attack: v })} />
        <ControlRow label="Release" value={sidechain?.release ?? 0.18} min={0.01} max={2} step={0.01} onChange={v => mixer.setSidechain(part.id, { release: v })} />
      </section>

      <section className="p-3">
        <label className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          <input
            type="checkbox"
            checked={transient?.enabled ?? false}
            onChange={e => mixer.setTransientShaper(part.id, { enabled: e.target.checked })}
            className="accent-accent-primary"
          />
          Transient Shaper
        </label>
        <ControlRow label="Attack" value={transient?.attack ?? 0} min={-1} max={1} step={0.01} onChange={v => mixer.setTransientShaper(part.id, { attack: v })} />
        <ControlRow label="Sustain" value={transient?.sustain ?? 0} min={-1} max={1} step={0.01} onChange={v => mixer.setTransientShaper(part.id, { sustain: v })} />
        <ControlRow label="Mix" value={transient?.mix ?? 1} min={0} max={1} step={0.01} onChange={v => mixer.setTransientShaper(part.id, { mix: v })} />
      </section>
    </aside>
  );
}

function ControlRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-1.5 grid grid-cols-[56px_1fr_42px] items-center gap-2 text-[10px] text-text-dim">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="accent-accent-primary"
      />
      <span className="text-right font-mono">{value.toFixed(2)}</span>
    </label>
  );
}

// ─── MixerView ───────────────────────────────────────────────────────────────

interface MixerViewProps {
  dm: DrumMachineState & DrumMachineActions;
  mixer: MixerState & MixerActions;
  samples?: import("@/store/useProjectStore").Sample[];
  bpm?: number;
  projectName?: string;
  className?: string;
}

export function MixerView({ dm, mixer, samples = [], bpm = 120, projectName = "Synthstudio", className = "" }: MixerViewProps) {
  const pattern = dm.getActivePattern();
  const parts = pattern?.parts ?? [];
  const selectedPart = parts.find(part => part.id === mixer.selectedChannelId) ?? parts[0];

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

  useEffect(() => {
    if (!mixer.selectedChannelId && parts[0]) {
      mixer.setSelectedChannel(parts[0].id);
    }
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

  // Sidechain-Einstellungen an AudioEngine weitergeben wenn sie sich ändern
  useEffect(() => {
    Object.entries(mixer.sidechains).forEach(([partId, sc]) => {
      AudioEngine.setSidechainSettings(partId, sc);
    });
  }, [mixer.sidechains]);

  const handleReturnVolume = useCallback((id: "reverb" | "delay", vol: number) => {
    mixer.setReturnTrackVolume(id, vol);
    AudioEngine.setReturnTrackVolume(id, mixer.returnTracks[id].muted ? 0 : vol);
  }, [mixer]);

  const handleReturnMuted = useCallback((id: "reverb" | "delay", muted: boolean) => {
    mixer.setReturnTrackMuted(id, muted);
    AudioEngine.setReturnTrackVolume(id, muted ? 0 : mixer.returnTracks[id].volume);
  }, [mixer]);

  const [showSpectrum, setShowSpectrum] = useState(true);
  const [busCompEnabled, setBusCompEnabled] = useState(false);
  const [busCompSettings, setBusCompSettings] = useState({
    threshold: -18, ratio: 4, attack: 0.005, release: 0.1, makeup: 0,
  });

  // Bus Compressor synchronisieren
  useEffect(() => {
    AudioEngine.setBusCompressor({ enabled: busCompEnabled, ...busCompSettings });
  }, [busCompEnabled, busCompSettings]);

  // Insert Chains an AudioEngine weitergeben wenn sie sich ändern
  useEffect(() => {
    Object.entries(mixer.insertChains).forEach(([partId, chain]) => {
      AudioEngine.applyInsertChain(partId, chain as Array<{type: string; params: Record<string, number|string|boolean>; enabled: boolean}>);
    });
  }, [mixer.insertChains]);

  return (
    <div className={`flex flex-col h-full bg-bg-base overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-color bg-bg-panel flex-wrap">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Mixer</span>
        <span className="text-[10px] text-text-dim">{parts.length} Kanäle</span>

        {/* Bus Compressor Toggle */}
        <button
          onClick={() => setBusCompEnabled(p => !p)}
          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${busCompEnabled ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-color text-text-dim hover:text-text-primary"}`}
          title="Bus Kompressor (Drum Bus)"
        >
          🗜 Bus Comp
        </button>

        <button
          onClick={() => setShowSpectrum(p => !p)}
          className={`ml-auto px-2 py-0.5 text-[10px] rounded border transition-colors ${showSpectrum ? "border-accent-secondary text-accent-secondary" : "border-border-color text-text-dim hover:text-text-primary"}`}
          title="Spectrum Analyzer ein/ausblenden"
        >
          ▶▶ Spectrum
        </button>
      </div>

      {/* Bus Compressor Settings */}
      {busCompEnabled && (
        <div className="px-4 py-2 bg-bg-panel border-b border-border-color flex items-center gap-4 flex-wrap">
          <span className="text-[10px] font-bold text-accent-primary uppercase tracking-wide">Bus Comp</span>
          {(["threshold", "ratio", "attack", "release", "makeup"] as const).map(key => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-dim capitalize">{key}</span>
              <input type="range"
                min={key === "threshold" ? -60 : key === "ratio" ? 1 : key === "makeup" ? -6 : 0.001}
                max={key === "threshold" ? 0 : key === "ratio" ? 20 : key === "makeup" ? 12 : key === "attack" ? 0.1 : 1}
                step={key === "threshold" || key === "makeup" ? 0.5 : 0.001}
                value={busCompSettings[key]}
                onChange={e => setBusCompSettings(p => ({ ...p, [key]: Number(e.target.value) }))}
                className="w-16 accent-accent-primary"
              />
              <span className="text-[10px] font-mono text-text-muted w-10">
                {key === "threshold" || key === "makeup" ? `${busCompSettings[key].toFixed(1)}dB` :
                 key === "ratio" ? `${busCompSettings[key].toFixed(1)}:1` :
                 `${(busCompSettings[key] * 1000).toFixed(0)}ms`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Spectrum Analyzer */}
      {showSpectrum && (
        <div className="px-3 pt-2 pb-1 bg-bg-base border-b border-border-color">
          <SpectrumDisplay />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
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
                  selected={selectedPart?.id === part.id}
                  onSelect={() => mixer.setSelectedChannel(part.id)}
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

        <ChannelInspector part={selectedPart} parts={parts} mixer={mixer} />
      </div>

      {/* Bus-Labels */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-1 border-t border-border-color bg-bg-panel">
        {(["reverb", "delay"] as const).map(id => {
          const track = mixer.returnTracks[id];
          return (
            <div key={id} className="flex items-center gap-2 text-[9px] uppercase tracking-wide">
              <button
                type="button"
                onClick={() => handleReturnMuted(id, !track.muted)}
                className={track.muted ? "text-orange-400" : id === "reverb" ? "text-purple-400" : "text-blue-400"}
              >
                {track.muted ? "Muted" : track.name}
              </button>
              <input
                aria-label={`${track.name} Volume`}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.volume}
                onChange={e => handleReturnVolume(id, parseFloat(e.target.value))}
                className={id === "reverb" ? "w-24 accent-purple-500" : "w-24 accent-blue-500"}
              />
            </div>
          );
        })}
      </div>

      {/* Export Panel */}
      <ExportPanel pattern={pattern} bpm={bpm} samples={samples} allPatterns={dm.patterns} projectName={projectName} />
    </div>
  );
}
