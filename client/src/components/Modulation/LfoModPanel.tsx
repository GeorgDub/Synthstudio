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
import React, { useCallback } from "react";
import type { PartData } from "@/audio/AudioEngine";
import type { LfoWaveform } from "@/utils/lfo";
import {
  useLfoModStore,
  addLfo,
  removeLfo,
  updateLfo,
  addModRoute,
  removeModRoute,
  updateModRoute,
  type ModTargetParam,
} from "@/store/useLfoModStore";

const WAVEFORMS: LfoWaveform[] = ["sine", "triangle", "square", "saw"];

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

  // ── Route hinzufügen (hörbare Defaults: enabled, volume, amount 0.5) ──
  const handleAddRoute = useCallback(() => {
    const lfo = lfos[0];
    const part = parts[0];
    if (!lfo || !part) return;
    addModRoute({
      enabled: true,
      lfoId: lfo.id,
      targetPartId: part.id,
      targetPartName: part.name,
      param: "volume",
      amount: 0.5,
    });
  }, [lfos, parts]);

  const canAddRoute = lfos.length > 0 && parts.length > 0;

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
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Route-Editor ──────────────────────────────────────── */}
      <section className="space-y-2 border-t border-border-color pt-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-text-muted uppercase tracking-wide">
            Routes
          </span>
          <span className="text-[10px] text-text-dim">{routes.length}</span>
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
            {lfos.length === 0
              ? "Lege zuerst eine LFO an, um eine Route zu erstellen."
              : "Kein Pattern-Part vorhanden — Routes brauchen ein Ziel."}
          </div>
        )}

        {routes.length === 0 ? (
          <div className="text-[11px] text-text-dim border border-dashed border-border-color rounded p-3">
            Noch keine Route — verknüpfe eine LFO mit einem Ziel-Parameter.
          </div>
        ) : (
          <div className="space-y-2">
            {routes.map((route) => (
              <div
                key={route.id}
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

                {/* LFO-Auswahl */}
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default LfoModPanel;
