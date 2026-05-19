/**
 * Synthstudio – AudioSidechainPanel (v3.119.0)
 *
 * DAW-grade Audio-Triggered Sidechain (klassisches Kick-ducks-Bass-Pumping).
 *
 * Unterschied zum step-triggered Sidechain (useMixerStore.sidechains):
 *   - Step-Sidechain: deterministisch, Pattern-Step-getriggert
 *   - Audio-Sidechain: peak-detect auf source-Channel-Audio mit
 *     Attack/Release-Hüllkurve — wie ein echter SSL/UAD Comp-Sidechain.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  useAudioSidechainStore,
  type AudioSidechainChain,
} from "@/store/useAudioSidechainStore";
import { AudioEngine } from "@/audio/AudioEngine";
import {
  DEFAULT_AUDIO_SIDECHAIN_CONFIG,
  type AudioSidechainConfig,
} from "@/audio/AudioSidechainNode";

interface ChannelOption {
  id: string;
  name: string;
}

interface AudioSidechainPanelProps {
  channels: ChannelOption[];
}

function formatDb(db: number): string {
  if (!Number.isFinite(db)) return "-∞";
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

function formatMs(ms: number): string {
  if (ms < 1) return ms.toFixed(2) + " ms";
  if (ms < 10) return ms.toFixed(1) + " ms";
  return Math.round(ms) + " ms";
}

function formatRatio(r: number): string {
  return r.toFixed(1) + ":1";
}

// ─── Live-Meter ──────────────────────────────────────────────────────────────

function ReductionMeter({ chainId }: { chainId: string }) {
  const [reductionDb, setReductionDb] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    function tick() {
      if (!mounted) return;
      const db = AudioEngine.getAudioSidechainReductionDb?.(chainId) ?? 0;
      setReductionDb(db);
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => {
      mounted = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [chainId]);

  // Map 0..24 dB → 0..100% width.
  const widthPct = Math.max(0, Math.min(100, (reductionDb / 24) * 100));

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-32 rounded bg-bg-base overflow-hidden border border-border-color">
        <div
          className="absolute left-0 top-0 h-full bg-accent-danger transition-[width] duration-75 ease-linear"
          style={{ width: widthPct + "%" }}
        />
      </div>
      <span className="text-text-muted font-mono text-[10px] tabular-nums w-12 text-right">
        -{reductionDb.toFixed(1)} dB
      </span>
    </div>
  );
}

// ─── Slider Row ──────────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, format, onChange }: SliderRowProps) {
  return (
    <label className="grid grid-cols-[60px_1fr_70px] items-center gap-2 text-[11px]">
      <span className="text-text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent-primary"
      />
      <span className="text-text-primary font-mono tabular-nums text-right">{format(value)}</span>
    </label>
  );
}

// ─── Per-Chain-Row ───────────────────────────────────────────────────────────

interface ChainRowProps {
  chain: AudioSidechainChain;
  channels: ChannelOption[];
  onUpdate: (id: string, update: Parameters<typeof useAudioSidechainStore.prototype>[0] extends never ? unknown : unknown) => void;
  onRemove: (id: string) => void;
}

function ChainRow({ chain, channels }: { chain: AudioSidechainChain; channels: ChannelOption[] }) {
  const { updateChain, removeChain } = useAudioSidechainStore();

  function setConfig(update: Partial<AudioSidechainConfig>) {
    updateChain(chain.id, { config: update });
  }

  const sourceName =
    channels.find((c) => c.id === chain.sourceChannelId)?.name ?? chain.sourceChannelId;
  const targetName =
    channels.find((c) => c.id === chain.targetChannelId)?.name ?? chain.targetChannelId;

  return (
    <div className="rounded-lg border border-border-color bg-bg-panel p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span
            className="px-2 py-0.5 rounded font-mono"
            style={{ background: "rgba(167,139,250,0.18)", color: "#a78bfa" }}
            title="Source-Channel (peak-detect)"
          >
            {sourceName}
          </span>
          <span className="text-text-dim">ducks</span>
          <span
            className="px-2 py-0.5 rounded font-mono"
            style={{ background: "rgba(251,146,60,0.18)", color: "#fb923c" }}
            title="Target-Channel (gain-reduced)"
          >
            {targetName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={chain.enabled}
              onChange={(e) => updateChain(chain.id, { enabled: e.target.checked })}
              className="accent-accent-primary"
            />
            Enabled
          </label>
          <button
            type="button"
            onClick={() => removeChain(chain.id)}
            className="px-2 py-0.5 rounded text-[11px] bg-bg-base text-accent-danger hover:bg-accent-danger hover:text-text-primary border border-border-color"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <SliderRow
          label="Threshold"
          value={chain.config.threshold}
          min={-60}
          max={0}
          step={0.5}
          format={formatDb}
          onChange={(v) => setConfig({ threshold: v })}
        />
        <SliderRow
          label="Ratio"
          value={chain.config.ratio}
          min={1}
          max={20}
          step={0.1}
          format={formatRatio}
          onChange={(v) => setConfig({ ratio: v })}
        />
        <SliderRow
          label="Attack"
          value={chain.config.attackMs}
          min={0.1}
          max={100}
          step={0.1}
          format={formatMs}
          onChange={(v) => setConfig({ attackMs: v })}
        />
        <SliderRow
          label="Release"
          value={chain.config.releaseMs}
          min={10}
          max={1000}
          step={1}
          format={formatMs}
          onChange={(v) => setConfig({ releaseMs: v })}
        />
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border-subtle">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">Reduction</span>
        <ReductionMeter chainId={chain.id} />
      </div>
    </div>
  );
}

// ─── Add-Form ────────────────────────────────────────────────────────────────

function AddChainForm({ channels, onClose }: { channels: ChannelOption[]; onClose: () => void }) {
  const { addChain } = useAudioSidechainStore();
  const [sourceId, setSourceId] = useState<string>(channels[0]?.id ?? "");
  const [targetId, setTargetId] = useState<string>(channels[1]?.id ?? channels[0]?.id ?? "");
  const [config, setConfig] = useState<AudioSidechainConfig>({
    ...DEFAULT_AUDIO_SIDECHAIN_CONFIG,
  });

  function patchConfig(p: Partial<AudioSidechainConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  const disabled = !sourceId || !targetId || sourceId === targetId;

  function handleAdd() {
    if (disabled) return;
    addChain({ sourceChannelId: sourceId, targetChannelId: targetId, config, enabled: true });
    onClose();
  }

  return (
    <div className="rounded-lg border border-accent-primary bg-bg-panel p-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-accent-primary font-medium">
        New Audio-Sidechain
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <label className="flex flex-col gap-1">
          <span className="text-text-muted">Source (ducker)</span>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="bg-bg-base border border-border-color rounded px-2 py-1 text-text-primary"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-muted">Target (ducked)</span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="bg-bg-base border border-border-color rounded px-2 py-1 text-text-primary"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sourceId === targetId && (
        <div className="text-[10px] text-accent-danger">Source and target must differ.</div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <SliderRow
          label="Threshold"
          value={config.threshold}
          min={-60}
          max={0}
          step={0.5}
          format={formatDb}
          onChange={(v) => patchConfig({ threshold: v })}
        />
        <SliderRow
          label="Ratio"
          value={config.ratio}
          min={1}
          max={20}
          step={0.1}
          format={formatRatio}
          onChange={(v) => patchConfig({ ratio: v })}
        />
        <SliderRow
          label="Attack"
          value={config.attackMs}
          min={0.1}
          max={100}
          step={0.1}
          format={formatMs}
          onChange={(v) => patchConfig({ attackMs: v })}
        />
        <SliderRow
          label="Release"
          value={config.releaseMs}
          min={10}
          max={1000}
          step={1}
          format={formatMs}
          onChange={(v) => patchConfig({ releaseMs: v })}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 rounded text-[11px] bg-bg-base border border-border-color text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={handleAdd}
          className="px-3 py-1 rounded text-[11px] bg-accent-primary text-bg-base font-medium disabled:opacity-40"
        >
          Add Sidechain
        </button>
      </div>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function AudioSidechainPanel({ channels }: AudioSidechainPanelProps) {
  const store = useAudioSidechainStore();
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-text-primary font-medium">
            Audio-Sidechain (v2)
          </h3>
          <p className="text-[10px] text-text-dim">
            DAW-grade peak-detect ducking — Kick ducks Bass.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="px-2 py-1 rounded text-[11px] bg-accent-primary text-bg-base font-medium"
            disabled={channels.length < 2}
            title={channels.length < 2 ? "Need at least 2 channels" : "Add a new sidechain"}
          >
            + Add
          </button>
        )}
      </header>

      {showForm && <AddChainForm channels={channels} onClose={() => setShowForm(false)} />}

      {store.chains.length === 0 && !showForm && (
        <div className="rounded border border-dashed border-border-color px-3 py-4 text-center text-[11px] text-text-dim">
          No audio-sidechains yet. Add one to start pumping.
        </div>
      )}

      <div className="space-y-2">
        {store.chains.map((chain) => (
          <ChainRow key={chain.id} chain={chain} channels={channels} />
        ))}
      </div>
    </section>
  );
}
