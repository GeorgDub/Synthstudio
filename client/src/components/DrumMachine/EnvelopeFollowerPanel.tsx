/**
 * Synthstudio – EnvelopeFollowerPanel
 *
 * Zeigt alle konfigurierten Envelope-Follower.
 * Jede Konfiguration: Source-Part → Target-Part → Parameter → Menge.
 * Live-Pegel-Anzeige per requestAnimationFrame.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useEnvelopeFollowerStore,
  addEnvelopeFollower,
  removeEnvelopeFollower,
  updateEnvelopeFollower,
  type EnvelopeTarget,
} from "@/store/useEnvelopeFollowerStore";
import { AudioEngine } from "@/audio/AudioEngine";
import type { PartData } from "@/audio/AudioEngine";

const TARGET_LABELS: Record<EnvelopeTarget, string> = {
  volume:    "Lautstärke",
  pan:       "Pan",
  filterFreq:"Filter Freq",
  reverbMix: "Reverb Mix",
  delayMix:  "Delay Mix",
};

interface LevelMeterProps {
  partId: string;
}

function LevelMeter({ partId }: LevelMeterProps) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    AudioEngine.startEnvelopeFollower(partId);
    const tick = () => {
      setLevel(AudioEngine.getChannelEnvelopeLevel(partId));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      AudioEngine.stopEnvelopeFollower(partId);
    };
  }, [partId]);

  return (
    <div className="flex items-center gap-0.5 h-2 w-16">
      {Array.from({ length: 8 }, (_, i) => {
        const threshold = (i + 1) / 8;
        const active = level >= threshold;
        const color = i >= 7 ? "#ef4444" : i >= 5 ? "#f59e0b" : "var(--ss-accent-success)";
        return (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: "100%",
              background: active ? color : "var(--ss-bg-elevated)",
              transition: "background 80ms",
            }}
          />
        );
      })}
    </div>
  );
}

interface EnvelopeFollowerPanelProps {
  parts: PartData[];
}

export function EnvelopeFollowerPanel({ parts }: EnvelopeFollowerPanelProps) {
  const state = useEnvelopeFollowerStore();
  const [newSrc, setNewSrc] = useState(parts[0]?.id ?? "");
  const [newTgt, setNewTgt] = useState(parts[0]?.id ?? "");
  const [newParam, setNewParam] = useState<EnvelopeTarget>("volume");

  const handleAdd = useCallback(() => {
    const srcPart = parts.find(p => p.id === newSrc);
    const tgtPart = parts.find(p => p.id === newTgt);
    if (!srcPart || !tgtPart) return;
    addEnvelopeFollower({
      enabled: true,
      sourcePartId: newSrc,
      sourcePartName: srcPart.name,
      targetPartId: newTgt,
      targetPartName: tgtPart.name,
      target: newParam,
      amount: 0.5,
      attackMs: 10,
      releaseMs: 100,
    });
  }, [newSrc, newTgt, newParam, parts]);

  if (parts.length === 0) {
    return (
      <div className="text-[10px] text-text-dim p-2">
        Kein Pattern aktiv.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Envelope Follower</span>
        <span className="text-[10px] text-text-dim">{state.configs.length} aktiv</span>
      </div>

      {/* Bestehende Follower */}
      {state.configs.map(cfg => (
        <div key={cfg.id} className="border border-border-color rounded p-2 space-y-2 bg-bg-elevated">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Enable Toggle */}
            <label className="flex items-center gap-1 text-[10px] text-text-dim cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={e => updateEnvelopeFollower(cfg.id, { enabled: e.target.checked })}
                className="accent-accent-primary"
              />
              An
            </label>

            {/* Source */}
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-text-dim">Quelle:</span>
              <select
                value={cfg.sourcePartId}
                onChange={e => {
                  const p = parts.find(p => p.id === e.target.value);
                  if (p) updateEnvelopeFollower(cfg.id, { sourcePartId: p.id, sourcePartName: p.name });
                }}
                className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
              >
                {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Level Meter */}
            {cfg.enabled && <LevelMeter partId={cfg.sourcePartId} />}

            {/* Arrow */}
            <span className="text-text-dim text-[10px]">→</span>

            {/* Target Part */}
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-text-dim">Ziel:</span>
              <select
                value={cfg.targetPartId}
                onChange={e => {
                  const p = parts.find(p => p.id === e.target.value);
                  if (p) updateEnvelopeFollower(cfg.id, { targetPartId: p.id, targetPartName: p.name });
                }}
                className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
              >
                {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Target Param */}
            <select
              value={cfg.target}
              onChange={e => updateEnvelopeFollower(cfg.id, { target: e.target.value as EnvelopeTarget })}
              className="bg-bg-panel border border-border-color rounded px-1 py-0.5 text-text-primary text-[10px]"
            >
              {(Object.keys(TARGET_LABELS) as EnvelopeTarget[]).map(k => (
                <option key={k} value={k}>{TARGET_LABELS[k]}</option>
              ))}
            </select>

            <button
              onClick={() => removeEnvelopeFollower(cfg.id)}
              className="ml-auto text-text-dim hover:text-accent-danger text-[10px]"
            >
              ✕
            </button>
          </div>

          {/* Amount + Attack + Release */}
          <div className="flex gap-3 flex-wrap text-[10px]">
            {[
              ["Menge", "amount", 0, 1, 0.01, cfg.amount],
              ["Attack ms", "attackMs", 1, 500, 1, cfg.attackMs],
              ["Release ms", "releaseMs", 10, 2000, 10, cfg.releaseMs],
            ].map(([label, key, min, max, step, val]) => (
              <label key={String(key)} className="flex items-center gap-1 text-text-dim">
                {String(label)}:
                <input
                  type="range"
                  min={Number(min)}
                  max={Number(max)}
                  step={Number(step)}
                  value={Number(val)}
                  onChange={e => updateEnvelopeFollower(cfg.id, { [key as string]: Number(e.target.value) })}
                  className="w-20 accent-accent-primary"
                />
                <span className="font-mono w-8 text-text-primary">{Number(val).toFixed(key === "amount" ? 2 : 0)}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* Neuen Follower hinzufügen */}
      <div className="border-t border-border-color pt-2 space-y-2">
        <div className="text-[10px] text-text-muted font-semibold">Neuen Follower</div>
        <div className="flex gap-2 flex-wrap text-[10px] items-center">
          <select
            value={newSrc}
            onChange={e => setNewSrc(e.target.value)}
            className="bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-text-primary"
          >
            {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="text-text-dim">→</span>
          <select
            value={newTgt}
            onChange={e => setNewTgt(e.target.value)}
            className="bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-text-primary"
          >
            {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={newParam}
            onChange={e => setNewParam(e.target.value as EnvelopeTarget)}
            className="bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-text-primary"
          >
            {(Object.keys(TARGET_LABELS) as EnvelopeTarget[]).map(k => (
              <option key={k} value={k}>{TARGET_LABELS[k]}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!newSrc || !newTgt}
            className="px-3 py-0.5 rounded bg-accent-primary text-white text-[10px] hover:opacity-80 disabled:opacity-40 font-bold"
          >
            + Follower
          </button>
        </div>
      </div>
    </div>
  );
}
