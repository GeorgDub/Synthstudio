/**
 * Synthstudio – GranularSynthPanel
 *
 * UI für den Granular-Synthesizer. Steuert alle GranularParams
 * und zeigt einen Mini-Visualizer der Grain-Wolke.
 * Startet / stoppt die Granular-Engine im AudioEngine-Singleton.
 *
 * v3.17.0: OmniTribe-Bridge-Wiring. Wenn die Bridge connected ist:
 *   - UI-Slider → omniTribeBridge.setParam(part, 0x19, paramLow, midi)
 *     via Throttled-Sender (60 Hz pro Param-Key).
 *   - paramChange-CustomEvent von der Bridge → patcht den lokalen
 *     Store via onChange. Bridge-side Echo-Schutz (50ms pendingSets)
 *     verhindert die Endlosschleife.
 * Disconnected: alle Bridge-Calls sind NO-OPs (sendNrpn checkt
 * isConnected vor Throttler), Synthstudio bleibt eigenstaendig.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plug, PlugZap } from "lucide-react";
import type { GranularParams } from "@/audio/GranularEngine";
import { DEFAULT_GRANULAR_PARAMS } from "@/audio/GranularEngine";
import { AudioEngine } from "@/audio/AudioEngine";
import { omniTribeBridge, type ParamChangeEvent } from "@/audio/OmniTribeBridge";
import {
  OMNITRIBE_GRANULAR,
  clampPartIndex,
  decodeParamLow,
  granularPidToKey,
  midiToGranularUi,
  sendGranularParam,
  type GranularParamKey,
} from "@/utils/omniTribeWiring";

interface GranularSynthPanelProps {
  partId: string;
  /** v3.17: numerischer Part-Index 0..15 fuer OmniTribe-NRPN. Default 0. */
  partIndex?: number;
  sampleUrl?: string;
  params: GranularParams;
  onChange: (params: GranularParams) => void;
}

// ─── Mini-Visualizer ──────────────────────────────────────────────────────────

function GranularViz({ params, active }: { params: GranularParams; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width  = canvas.clientWidth  * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    const bg = getComputedStyle(document.documentElement).getPropertyValue("--ss-bg-base").trim() || "#0a0a0a";
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--ss-accent-primary").trim() || "#f59e0b";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!active) return;

    // Simuliere sichtbare Körner
    const grainCount = Math.round(params.density * 0.5);
    const centerX = params.position * w;
    const sprayPx = params.spray * w * 0.5;
    const grainW = Math.max(2, (params.grainSize / 500) * w * 0.08);
    const grainH = h * 0.6;

    ctx.globalAlpha = 0.6;
    for (let i = 0; i < Math.max(4, grainCount); i++) {
      const x = centerX + (Math.random() * 2 - 1) * sprayPx;
      const panOffset = (Math.random() * 2 - 1) * params.panSpread;
      const y = h * 0.2 + Math.random() * grainH;
      const alpha = 0.3 + params.amplitude * 0.7;

      ctx.fillStyle = accent;
      ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.4);
      ctx.fillRect(
        Math.max(0, Math.min(w - grainW, x + panOffset * w * 0.3 - grainW / 2)),
        y,
        grainW,
        Math.max(1, (params.amplitude * grainH * 0.8) * (0.3 + Math.random() * 0.7))
      );
    }

    // Position-Marker
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = accent;
    ctx.lineWidth = devicePixelRatio * 2;
    ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [params, active]);

  return <canvas ref={canvasRef} className="w-full h-16 rounded block" />;
}

// ─── OmniTribe-Connected-Indicator ────────────────────────────────────────────

function OmniTribeIndicator({ connected }: { connected: boolean }) {
  const title = connected
    ? "Verbunden mit OmniTribe — Encoder spiegeln in der UI"
    : "Lokale Synthese (keine OmniTribe-Hardware verbunden)";
  return (
    <span
      title={title}
      data-testid="omnitribe-indicator-granular"
      data-connected={connected ? "true" : "false"}
      className={`inline-flex items-center gap-1 text-[10px] ${
        connected ? "text-accent-success" : "text-text-dim"
      }`}
    >
      {connected ? (
        <PlugZap className="w-3 h-3" aria-hidden="true" />
      ) : (
        <Plug className="w-3 h-3" aria-hidden="true" />
      )}
      <span className="font-mono uppercase tracking-wide">
        {connected ? "OmniTribe" : "Local"}
      </span>
    </span>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step = 0.01, onChange, unit = "", fmt }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; unit?: string; fmt?: (v: number) => string;
}) {
  const display = fmt ? fmt(value) : (step < 1 ? value.toFixed(step < 0.01 ? 0 : 1) : Math.round(value).toString());
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-text-dim uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-mono text-accent-secondary">{display}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-accent-primary h-1" />
    </div>
  );
}

export function GranularSynthPanel({ partId, partIndex = 0, sampleUrl, params, onChange }: GranularSynthPanelProps) {
  const [active, setActive] = useState(false);
  const [hardwareConnected, setHardwareConnected] = useState(() => omniTribeBridge.isConnected);
  const p = params;
  const part = clampPartIndex(partIndex);

  // Sliding-Reference auf aktuelle Params fuer den paramChange-Listener,
  // damit dieser nicht auf jeden Param-Change re-renderen muss.
  const paramsRef = useRef(p);
  paramsRef.current = p;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const set = useCallback((update: Partial<GranularParams>) => {
    const next = { ...paramsRef.current, ...update };
    onChangeRef.current(next);
    // Live-Update ohne Restart
    if (active) AudioEngine.updateGranularParams(partId, update);
    // v3.17: an OmniTribe spiegeln (NO-OP wenn nicht connected, throttled).
    for (const k of Object.keys(update) as (keyof GranularParams)[]) {
      const value = update[k];
      if (typeof value !== "number") continue;
      switch (k) {
        case "grainSize":   sendGranularParam(part, "grainSize", value); break;
        case "density":     sendGranularParam(part, "density", value); break;
        case "pitchSpray":  sendGranularParam(part, "pitchScatter", value); break;
        case "position":    sendGranularParam(part, "position", value); break;
        case "spray":       sendGranularParam(part, "spray", value); break;
        // Amplitude wird auf 'feedback'-NRPN gemappt (Bridge-Mapping §5 nutzt
        // 'Feedback' als 6ten Slot — Granular-Engine hat keinen echten
        // Feedback-Param, Amplitude ist die naechstliegende UI-Repraesentation
        // bis ein dedizierter Feedback-Param ergaenzt wird).
        case "amplitude":   sendGranularParam(part, "feedback", value); break;
        default: /* pitch, panSpread, pitchSpray-doppelt nicht gemappt */ break;
      }
    }
  }, [active, partId, part]);

  // Granular-Engine starten/stoppen
  const handleToggle = useCallback(async () => {
    if (active) {
      AudioEngine.stopGranular(partId);
      setActive(false);
    } else {
      if (!sampleUrl) { alert("Kein Sample geladen – bitte zuerst ein Sample zuweisen."); return; }
      await AudioEngine.startGranular(partId, sampleUrl, p);
      setActive(true);
    }
  }, [active, partId, sampleUrl, p]);

  // Stoppen wenn Komponente unmountet
  useEffect(() => {
    return () => { AudioEngine.stopGranular(partId); };
  }, [partId]);

  // v3.17: paramChange-Listener fuer Encoder am Geraet → UI-Update.
  // Bridge dispatchet nur wenn der Wert NICHT von uns kommt (Echo-Schutz),
  // daher kein zusaetzlicher Schutz noetig.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ParamChangeEvent>).detail;
      if (!detail) return;
      if (detail.paramHigh !== OMNITRIBE_GRANULAR.PARAM_HIGH) return;
      const decoded = decodeParamLow(detail.paramLow);
      if (decoded.part !== part) return;
      const uiKey: GranularParamKey | null = granularPidToKey(decoded.pid);
      if (!uiKey) return;
      const uiValue = midiToGranularUi(uiKey, detail.value);
      const next: Partial<GranularParams> = {};
      switch (uiKey) {
        case "grainSize":    next.grainSize  = uiValue; break;
        case "density":      next.density    = uiValue; break;
        case "pitchScatter": next.pitchSpray = uiValue; break;
        case "position":     next.position   = uiValue; break;
        case "spray":        next.spray      = uiValue; break;
        case "feedback":     next.amplitude  = uiValue; break;
      }
      onChangeRef.current({ ...paramsRef.current, ...next });
      if (active) AudioEngine.updateGranularParams(partId, next);
    };
    window.addEventListener("omnitribe:paramChange", handler);
    return () => window.removeEventListener("omnitribe:paramChange", handler);
  }, [part, active, partId]);

  // Bridge-Connection-Polling. Bridge ist Singleton ohne Observer-Pattern —
  // wir checken alle 1s ob sich der Connected-State geaendert hat.
  useEffect(() => {
    const id = setInterval(() => {
      const c = omniTribeBridge.isConnected;
      setHardwareConnected(prev => (prev === c ? prev : c));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-bg-panel border border-border-color rounded-lg p-3 text-xs min-w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="text-xs font-bold text-accent-primary uppercase tracking-wider">Granular</span>
        <OmniTribeIndicator connected={hardwareConnected} />
        <button
          onClick={handleToggle}
          className={`px-3 py-1 rounded font-bold text-[10px] transition-colors ${
            active
              ? "bg-accent-primary text-white animate-pulse"
              : "bg-bg-elevated text-text-muted hover:bg-accent-primary/20 hover:text-accent-primary"
          }`}
        >
          {active ? "■ Stop" : "▶ Play"}
        </button>
      </div>

      {/* Visualizer */}
      <div className="mb-3 rounded border border-border-color overflow-hidden">
        <GranularViz params={p} active={active} />
      </div>

      {!sampleUrl && (
        <div className="text-[10px] text-accent-danger mb-2 text-center">
          ⚠ Kein Sample – Sample per Drag &amp; Drop auf den Kanal ziehen
        </div>
      )}

      {/* Parameter Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Slider label="Position"   value={p.position}  min={0} max={1}   step={0.01} onChange={v => set({ position: v })}
          fmt={v => `${Math.round(v * 100)}%`} />
        <Slider label="Streuung"   value={p.spray}     min={0} max={1}   step={0.01} onChange={v => set({ spray: v })}
          fmt={v => `${Math.round(v * 100)}%`} />
        <Slider label="Grain-Größe" value={p.grainSize} min={10} max={500} step={5}  onChange={v => set({ grainSize: v })} unit=" ms" />
        <Slider label="Dichte"     value={p.density}   min={1} max={50}  step={1}   onChange={v => set({ density: v })} unit="/s"
          fmt={v => Math.round(v).toString()} />
        <Slider label="Pitch"      value={p.pitch}     min={-24} max={24} step={1}  onChange={v => set({ pitch: v })} unit=" st"
          fmt={v => (v >= 0 ? "+" : "") + v} />
        <Slider label="Pitch-Spray" value={p.pitchSpray} min={0} max={200} step={5} onChange={v => set({ pitchSpray: v })} unit=" ¢" />
        <Slider label="Lautstärke" value={p.amplitude} min={0} max={1}   step={0.01} onChange={v => set({ amplitude: v })}
          fmt={v => `${Math.round(v * 100)}%`} />
        <Slider label="Panorama"   value={p.panSpread} min={0} max={1}   step={0.01} onChange={v => set({ panSpread: v })}
          fmt={v => `${Math.round(v * 100)}%`} />
      </div>

      {/* Quick Presets */}
      <div className="mt-3 border-t border-border-color pt-2">
        <div className="text-[10px] text-text-dim mb-1.5">Presets</div>
        <div className="flex gap-1 flex-wrap">
          {[
            { label: "Cloud",   p: { grainSize: 200, density: 8,  spray: 0.4, pitch: 0, pitchSpray: 0 } },
            { label: "Shimmer", p: { grainSize: 40,  density: 25, spray: 0.15,pitch: 12, pitchSpray: 30 } },
            { label: "Texture", p: { grainSize: 120, density: 15, spray: 0.6, pitch: 0, pitchSpray: 50 } },
            { label: "Stutter", p: { grainSize: 15,  density: 40, spray: 0.05,pitch: 0, pitchSpray: 0 } },
            { label: "Freeze",  p: { grainSize: 300, density: 5,  spray: 0.02,pitch: 0, pitchSpray: 0 } },
          ].map(preset => (
            <button
              key={preset.label}
              onClick={() => set({ ...DEFAULT_GRANULAR_PARAMS, ...preset.p })}
              className="px-2 py-0.5 text-[10px] rounded bg-bg-elevated text-text-muted hover:bg-accent-primary/20 hover:text-accent-primary transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
