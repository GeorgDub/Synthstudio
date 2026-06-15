/**
 * Synthstudio – LfoModPanel (TASK-257-FOLLOWUP)
 *
 * Schlanke UI für das LFO-Routing-Datenmodell aus useLfoModStore (TASK-257 v1).
 * Zwei Sektionen:
 *   1. LFO-Liste — Quellen (Name, enable, Waveform, Rate Hz, Depth, Phase).
 *   2. Route-Editor — Verknüpfungen LFO → Ziel-Part/Param mit bipolarer Amount.
 *
 * AUDIBILITY: Die Ziel-Part-Auswahl nutzt `parts: PartData[]` (gleiche Quelle
 * wie MixerView/EnvelopeFollowerPanel: dm.getActivePattern().parts). Deren
 * `part.id` ist exakt die Channel-ID, die der App.tsx-rAF-Seam an
 * AudioEngine.setChannelVolume/Pan/FilterFreq/Send(partId, …) weitergibt.
 * Defaults erzeugen hörbare Bewegung (enabled, depth/amount > 0).
 *
 * Nur semantische --ss-*-Token-Klassen, native Selects/Checkboxen (headless-
 * Playwright-tauglich, kein Radix-Portal).
 */
import React, { useCallback, useEffect, useRef } from "react";
import type { PartData } from "@/audio/AudioEngine";
import {
  evaluateLfo,
  sampleLfoCycle,
  type LfoWaveform,
  type LfoShape,
} from "@/utils/lfo";
import {
  useLfoModStore,
  addLfo,
  removeLfo,
  updateLfo,
  addModRoute,
  removeModRoute,
  updateModRoute,
  routeSource,
  resolveLfoIdForSwitch,
  groupRoutesBySource,
  type ModTargetParam,
  type ModSource,
  type ModRoute,
  type LfoConfig,
} from "@/store/useLfoModStore";
import { defaultEnvConfig } from "@/utils/modSource";
import { MACRO_COUNT } from "@/store/useMacroStore";

const WAVEFORMS: LfoWaveform[] = ["sine", "triangle", "square", "saw"];

const MOD_SOURCES: ModSource[] = ["lfo", "macro", "env"];
const SOURCE_LABELS: Record<ModSource, string> = {
  lfo: "LFO",
  macro: "Macro",
  env: "Hüllkurve",
};

const WAVEFORM_LABELS: Record<LfoWaveform, string> = {
  sine: "Sinus",
  triangle: "Dreieck",
  square: "Rechteck",
  saw: "Sägezahn",
};

const PARAM_LABELS: Record<ModTargetParam, string> = {
  volume: "Lautstärke",
  pan: "Pan",
  filterFreq: "Filter Freq",
  reverbMix: "Reverb Mix",
  delayMix: "Delay Mix",
};

// ─── Live-Kurven-Visualisierung (Canvas) ────────────────────────────────────

/** Anzahl voller Zyklen, die im Canvas gezeigt werden. */
const CURVE_CYCLES = 2;
/** Sample-Punkte über alle Zyklen (Auflösung der gezeichneten Kurve). */
const CURVE_POINTS = 160;
const CANVAS_W = 200;
const CANVAS_H = 48;

/**
 * Liest ein --ss-*-Token von :root; `.trim()` entfernt führendes Leerzeichen.
 * BEWUSST kein Hex-Fallback (Hard-Rule: keine hardcodierten Farben im Canvas).
 * `draw()` läuft nur, wenn getContext("2d") != null (echter Browser) — dort
 * sind alle --ss-*-Token aus index.css garantiert definiert.
 */
function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

interface LfoCurveCanvasProps {
  waveform: LfoWaveform;
  rateHz: number;
  depth: number;
  phase: number;
  enabled: boolean;
}

/**
 * Zeichnet die LFO-Kurve (zwei Zyklen) plus einen mitlaufenden Playhead-Punkt.
 * Reuse von sampleLfoCycle (Kurve) + evaluateLfo (Playhead-Y) — keine eigene
 * Wellenform-Math. Farben kommen ausschließlich aus --ss-*-Tokens (das 2D-
 * Canvas-Context kann keine Tailwind-Klassen nutzen). Eine rAF-Schleife pro
 * Canvas, wird bei Unmount gecancelt; in jsdom (getContext → null) No-Op.
 */
function LfoCurveCanvas({
  waveform,
  rateHz,
  depth,
  phase,
  enabled,
}: LfoCurveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Aktuelle Params via Ref, damit die rAF-Schleife nicht neu aufgesetzt wird.
  const paramsRef = useRef({ waveform, rateHz, depth, phase, enabled });
  paramsRef.current = { waveform, rateHz, depth, phase, enabled };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / headless ohne Canvas-Support → No-Op

    let raf = 0;
    const start = typeof performance !== "undefined" ? performance.now() : 0;

    const draw = (now: number) => {
      const p = paramsRef.current;
      const w = CANVAS_W;
      const h = CANVAS_H;
      const mid = h / 2;
      const amp = (h / 2) * 0.9; // 10% Rand oben/unten

      const colCurve = token("--ss-accent-primary");
      const colGrid = token("--ss-border-subtle");
      const colZero = token("--ss-text-dim");
      const colBg = token("--ss-bg-base");
      const colHead = token("--ss-accent-secondary");

      // Hintergrund
      ctx.fillStyle = colBg;
      ctx.fillRect(0, 0, w, h);

      // Vertikales Raster (eine Linie pro Zyklus-Grenze)
      ctx.strokeStyle = colGrid;
      ctx.lineWidth = 1;
      for (let c = 1; c < CURVE_CYCLES; c++) {
        const x = (c / CURVE_CYCLES) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Null-Linie
      ctx.strokeStyle = colZero;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();

      // Kurve (immer auf voller Amplitude [-1,1] gemappt, depth skaliert sie)
      const shape: LfoShape = { waveform: p.waveform, rateHz: p.rateHz, phase: p.phase };
      const samples = sampleLfoCycle(shape, p.depth, CURVE_POINTS, CURVE_CYCLES);
      ctx.strokeStyle = colCurve;
      ctx.lineWidth = 2;
      ctx.globalAlpha = p.enabled ? 1 : 0.4;
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * w;
        const y = mid - samples[i] * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Mitlaufender Playhead — Phasenposition aus Wall-Clock.
      // rateHz frei laufend; bei rateHz<=0 steht der Kopf still.
      if (p.enabled && p.rateHz > 0) {
        const elapsed = (now - start) / 1000;
        // Position innerhalb der gezeigten Zyklen (0..CURVE_CYCLES).
        const cyclePos = ((elapsed * p.rateHz) % CURVE_CYCLES + CURVE_CYCLES) % CURVE_CYCLES;
        const headX = (cyclePos / CURVE_CYCLES) * w;
        const headVal = evaluateLfo(shape, elapsed) * p.depth;
        const headY = mid - headVal * amp;

        ctx.globalAlpha = 1;
        ctx.strokeStyle = colHead;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(headX, 0);
        ctx.lineTo(headX, h);
        ctx.stroke();

        ctx.fillStyle = colHead;
        ctx.beginPath();
        ctx.arc(headX, headY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []); // Params live via Ref → Schleife einmal aufsetzen, bei Unmount cancel.

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      data-testid="lfomod-curve-canvas"
      aria-label="LFO-Kurven-Vorschau"
      role="img"
      className="rounded border border-border-color bg-bg-base"
      style={{ width: CANVAS_W, height: CANVAS_H }}
    />
  );
}

interface LfoModPanelProps {
  /** Ziel-Parts — gleiche Quelle wie Mixer (dm.getActivePattern().parts). */
  parts: PartData[];
}

export function LfoModPanel({ parts }: LfoModPanelProps) {
  const { lfos, routes } = useLfoModStore();

  // ── LFO hinzufügen (hörbare Defaults: enabled, sine, 1 Hz, depth 1) ──
  const handleAddLfo = useCallback(() => {
    addLfo({
      name: `LFO ${lfos.length + 1}`,
      enabled: true,
      waveform: "sine",
      rateHz: 1,
      depth: 1,
      phase: 0,
    });
  }, [lfos.length]);

  // ── Route je Quelltyp hinzufügen (TASK-270, Mod-Matrix) ──
  // Jede neue Route bekommt hörbare Defaults (enabled, volume, amount 0.5) und
  // quelltyp-spezifische Sub-Felder. Ein Ziel-Part wird immer benötigt.
  const handleAddRouteForSource = useCallback(
    (source: ModSource) => {
      const part = parts[0];
      if (!part) return;
      const lfo = lfos[0];
      addModRoute({
        enabled: true,
        source,
        // lfoId nur für source==="lfo" relevant; ansonsten bewahrt als "".
        lfoId: source === "lfo" ? (lfo?.id ?? "") : "",
        macroIndex: source === "macro" ? 0 : undefined,
        env: source === "env" ? defaultEnvConfig() : undefined,
        targetPartId: part.id,
        targetPartName: part.name,
        param: "volume",
        amount: 0.5,
      });
    },
    [lfos, parts],
  );

  // Backward-compat: generischer "+ Route"-Button (Default lfo, fallback macro).
  const handleAddRoute = useCallback(() => {
    handleAddRouteForSource(lfos[0] ? "lfo" : "macro");
  }, [handleAddRouteForSource, lfos]);

  const canAddRoute = parts.length > 0;
  const grouped = groupRoutesBySource(routes);

  return (
    <div className="flex flex-col gap-5 max-w-3xl" data-testid="lfomod-panel">
      <div>
        <h2 className="text-sm font-bold text-text-primary uppercase tracking-widest">
          〰 LFO / Modulation
        </h2>
        <p className="text-[11px] text-text-dim mt-1">
          Frei laufende LFOs auf Channel-Parameter routen
          (volume / pan / filterFreq / reverbMix / delayMix).
        </p>
      </div>

      {/* ─── LFO-Liste ─────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-text-muted uppercase tracking-wide">
            LFOs
          </span>
          <span className="text-[10px] text-text-dim">{lfos.length}</span>
          <button
            type="button"
            onClick={handleAddLfo}
            data-testid="lfomod-add-lfo"
            className="ml-auto px-3 py-1 rounded bg-accent-primary text-text-primary text-[11px] font-bold hover:opacity-80 transition-opacity"
          >
            + LFO
          </button>
        </div>

        {lfos.length === 0 ? (
          <div className="text-[11px] text-text-dim border border-dashed border-border-color rounded p-3">
            Noch keine LFO — füge eine hinzu.
          </div>
        ) : (
          <div className="space-y-2">
            {lfos.map((lfo) => (
              <div
                key={lfo.id}
                data-testid="lfomod-lfo-row"
                className="border border-border-color rounded p-2 bg-bg-elevated space-y-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1 text-[10px] text-text-dim cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lfo.enabled}
                      onChange={(e) => updateLfo(lfo.id, { enabled: e.target.checked })}
                      className="accent-accent-primary"
                    />
                    An
                  </label>

                  <input
                    type="text"
                    value={lfo.name}
                    onChange={(e) => updateLfo(lfo.id, { name: e.target.value })}
                    className="bg-bg-panel border border-border-color rounded px-2 py-0.5 text-text-primary text-[11px] w-28"
                    aria-label="LFO-Name"
                  />

                  <label className="flex items-center gap-1 text-[10px] text-text-dim">
                    Wellenform:
                    <select
                      value={lfo.waveform}
                      onChange={(e) =>
                        updateLfo(lfo.id, { waveform: e.target.value as LfoWaveform })
                      }
                      className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
                    >
                      {WAVEFORMS.map((w) => (
                        <option key={w} value={w}>
                          {WAVEFORM_LABELS[w]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => removeLfo(lfo.id)}
                    aria-label="LFO entfernen"
                    className="ml-auto text-text-dim hover:text-accent-danger text-[12px]"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex gap-4 flex-wrap text-[10px]">
                  <label className="flex items-center gap-1 text-text-dim">
                    Rate Hz:
                    <input
                      type="range"
                      min={0.05}
                      max={20}
                      step={0.05}
                      value={lfo.rateHz}
                      onChange={(e) => updateLfo(lfo.id, { rateHz: Number(e.target.value) })}
                      className="w-24 accent-accent-primary"
                    />
                    <span className="font-mono w-10 text-text-primary">
                      {lfo.rateHz.toFixed(2)}
                    </span>
                  </label>

                  <label className="flex items-center gap-1 text-text-dim">
                    Depth:
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={lfo.depth}
                      onChange={(e) => updateLfo(lfo.id, { depth: Number(e.target.value) })}
                      className="w-24 accent-accent-primary"
                    />
                    <span className="font-mono w-8 text-text-primary">
                      {lfo.depth.toFixed(2)}
                    </span>
                  </label>

                  <label className="flex items-center gap-1 text-text-dim">
                    Phase:
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={lfo.phase}
                      onChange={(e) => updateLfo(lfo.id, { phase: Number(e.target.value) })}
                      className="w-24 accent-accent-primary"
                    />
                    <span className="font-mono w-8 text-text-primary">
                      {lfo.phase.toFixed(2)}
                    </span>
                  </label>
                </div>

                {/* Live-Kurven-Vorschau (reagiert auf Waveform/Rate/Depth/Phase) */}
                <LfoCurveCanvas
                  waveform={lfo.waveform}
                  rateHz={lfo.rateHz}
                  depth={lfo.depth}
                  phase={lfo.phase}
                  enabled={lfo.enabled}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Mod-Matrix (Routes, nach Quelltyp gruppiert) ──────────── */}
      <section className="space-y-3 border-t border-border-color pt-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-text-muted uppercase tracking-wide">
            Mod-Matrix
          </span>
          <span className="text-[10px] text-text-dim">{routes.length}</span>
          {/* Generischer "+ Route"-Button (Backward-Compat mit bestehendem
              Smoke; legt eine lfo-Route an, sonst macro). */}
          <button
            type="button"
            onClick={handleAddRoute}
            disabled={!canAddRoute}
            data-testid="lfomod-add-route"
            className="ml-auto px-3 py-1 rounded bg-accent-primary text-text-primary text-[11px] font-bold hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Route
          </button>
        </div>

        {!canAddRoute && (
          <div className="text-[10px] text-text-dim">
            Kein Pattern-Part vorhanden — Routes brauchen ein Ziel.
          </div>
        )}

        {/* Eine Gruppe pro Quelltyp: Header (Label + Count + "+ X"-Button) und
            die zugehörigen Routen-Zeilen. Gruppen werden immer gerendert
            (auch leer) → stabiler Überblick über die Matrix. */}
        {MOD_SOURCES.map((source) => {
          const groupRoutes = grouped[source];
          return (
            <div
              key={source}
              data-testid={`lfomod-group-${source}`}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-text-primary">
                  {SOURCE_LABELS[source]}
                </span>
                <span className="text-[10px] text-text-dim">
                  {groupRoutes.length}
                </span>
                <button
                  type="button"
                  onClick={() => handleAddRouteForSource(source)}
                  disabled={!canAddRoute}
                  data-testid={`lfomod-add-route-${source}`}
                  className="ml-auto px-2 py-0.5 rounded border border-border-color bg-bg-panel text-text-muted text-[10px] font-bold hover:text-text-primary hover:border-accent-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + {SOURCE_LABELS[source]}
                </button>
              </div>

              {groupRoutes.length === 0 ? (
                <div className="text-[10px] text-text-dim border border-dashed border-border-color rounded px-3 py-2">
                  Keine {SOURCE_LABELS[source]}-Route.
                </div>
              ) : (
                <div className="space-y-2">
                  {groupRoutes.map((route) => (
                    <ModRouteRow
                      key={route.id}
                      route={route}
                      lfos={lfos}
                      parts={parts}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ─── Eine Routen-Zeile der Mod-Matrix ───────────────────────────────────────

interface ModRouteRowProps {
  route: ModRoute;
  lfos: LfoConfig[];
  parts: PartData[];
}

/**
 * Kompakte Zeile für eine einzelne Mod-Route: enable-Toggle, Quellen-Picker
 * (+ quelltyp-spezifische Sub-Auswahl), Ziel-Part + Param und bipolare Amount,
 * plus Remove. Bewahrt die TASK-271-Verdrahtung (resolveLfoIdForSwitch beim
 * Wechsel auf source "lfo"). Nur semantische --ss-*-Token-Klassen.
 */
function ModRouteRow({ route, lfos, parts }: ModRouteRowProps) {
  const source = routeSource(route);
  return (
    <div
      data-testid="lfomod-route-row"
      className="border border-border-color rounded p-2 bg-bg-elevated flex items-center gap-2 flex-wrap"
    >
      <label className="flex items-center gap-1 text-[10px] text-text-dim cursor-pointer">
        <input
          type="checkbox"
          checked={route.enabled}
          onChange={(e) => updateModRoute(route.id, { enabled: e.target.checked })}
          className="accent-accent-primary"
        />
        An
      </label>

      {/* Quelle (lfo / macro / env) */}
      <label className="flex items-center gap-1 text-[10px] text-text-dim">
        Quelle:
        <select
          value={source}
          onChange={(e) => {
            const src = e.target.value as ModSource;
            // Bei Wechsel sinnvolle Sub-Defaults setzen, falls fehlend.
            const patch: Partial<ModRoute> = { source: src };
            if (src === "macro" && route.macroIndex === undefined) patch.macroIndex = 0;
            if (src === "env" && !route.env) patch.env = defaultEnvConfig();
            // Beim (Zurück-)Wechsel auf "lfo" einen gültigen lfoId
            // sicherstellen (TASK-271 Task B: leerer/verwaister lfoId
            // bei macro/env-Routes → definierter Default).
            if (src === "lfo") patch.lfoId = resolveLfoIdForSwitch(route.lfoId, lfos);
            updateModRoute(route.id, patch);
          }}
          className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
          aria-label="Modulationsquelle"
        >
          {MOD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      {/* Quellen-spezifische Sub-Auswahl */}
      {source === "lfo" && (
        <label className="flex items-center gap-1 text-[10px] text-text-dim">
          LFO:
          <select
            value={route.lfoId}
            onChange={(e) => updateModRoute(route.id, { lfoId: e.target.value })}
            className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
          >
            {lfos.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {source === "macro" && (
        <label className="flex items-center gap-1 text-[10px] text-text-dim">
          Macro:
          <select
            value={route.macroIndex ?? 0}
            onChange={(e) =>
              updateModRoute(route.id, { macroIndex: Number(e.target.value) })
            }
            className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
            aria-label="Macro-Index"
          >
            {Array.from({ length: MACRO_COUNT }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}

      {source === "env" && (
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-text-dim">
          {(["attack", "decay", "sustain", "release", "loopSec"] as const).map((f) => {
            const env = route.env ?? defaultEnvConfig();
            const isSustain = f === "sustain";
            const labels: Record<string, string> = {
              attack: "A",
              decay: "D",
              sustain: "S",
              release: "R",
              loopSec: "Loop s",
            };
            return (
              <label key={f} className="flex items-center gap-0.5">
                {labels[f]}:
                <input
                  type="range"
                  min={0}
                  max={isSustain ? 1 : 5}
                  step={isSustain ? 0.01 : 0.05}
                  value={env[f]}
                  onChange={(e) =>
                    updateModRoute(route.id, {
                      env: { ...env, [f]: Number(e.target.value) },
                    })
                  }
                  className="w-14 accent-accent-primary"
                  aria-label={`Hüllkurve ${f}`}
                />
                <span className="font-mono w-7 text-text-primary">
                  {env[f].toFixed(2)}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <span className="text-text-dim text-[10px]">→</span>

      {/* Ziel-Part (echte Mixer-Channel-ID) */}
      <label className="flex items-center gap-1 text-[10px] text-text-dim">
        Ziel:
        <select
          value={route.targetPartId}
          onChange={(e) => {
            const p = parts.find((pt) => pt.id === e.target.value);
            if (p) updateModRoute(route.id, { targetPartId: p.id, targetPartName: p.name });
          }}
          className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
        >
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {/* Ziel-Param */}
      <select
        value={route.param}
        onChange={(e) =>
          updateModRoute(route.id, { param: e.target.value as ModTargetParam })
        }
        className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
        aria-label="Ziel-Parameter"
      >
        {(Object.keys(PARAM_LABELS) as ModTargetParam[]).map((k) => (
          <option key={k} value={k}>
            {PARAM_LABELS[k]}
          </option>
        ))}
      </select>

      {/* Amount (bipolar -1..+1) */}
      <label className="flex items-center gap-1 text-[10px] text-text-dim">
        Amount:
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={route.amount}
          onChange={(e) => updateModRoute(route.id, { amount: Number(e.target.value) })}
          className="w-24 accent-accent-primary"
        />
        <span className="font-mono w-10 text-text-primary">
          {route.amount.toFixed(2)}
        </span>
      </label>

      <button
        type="button"
        onClick={() => removeModRoute(route.id)}
        aria-label="Route entfernen"
        className="ml-auto text-text-dim hover:text-accent-danger text-[12px]"
      >
        ✕
      </button>
    </div>
  );
}

export default LfoModPanel;
