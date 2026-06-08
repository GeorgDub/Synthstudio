/**
 * Synthstudio – AutoMixPanel.tsx  (v3.122.0)
 *
 * UI fuer "Smart Auto-Mix": LUFS-driven Gain-Staging-Suggestions.
 *
 *  - Pro Channel: Target-LUFS-Input + Live-Measured-LUFS + Suggested-Gain
 *  - User-Toggle pro Channel (apply oder skip)
 *  - "Apply Selected" button → modifiziert Mixer-Volumes
 *  - "Reset Measurement" → resetAutoMixAnalysis + Mess-Lauf von vorn
 *  - "Measurement Duration" slider (5s..60s typisch)
 *
 * Isomorph: ohne AudioEngine.getAutoMixSnapshot zeigt UI -Inf / "no data".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAutoMixStore,
  type DrumCategoryLike,
  MEASUREMENT_DURATION_MIN_MS,
  MEASUREMENT_DURATION_MAX_MS,
} from "@/store/useAutoMixStore";
import {
  computeSuggestion,
  applySuggestions,
  volumeLinearToDb,
  volumeDbToLinear,
  type MixSuggestion,
} from "@/utils/autoMixSuggestions";
import { AudioEngine } from "@/audio/AudioEngine";

/**
 * v3.122.0: Channel-Descriptor wie das Panel ihn vom Parent erwartet.
 *
 *  - id        : Part-/Channel-ID (Map-Key, AudioEngine-ID)
 *  - name      : Anzeigename (z.B. "Kick", "Snare 808")
 *  - category  : Drum-Kategorie fuer Default-Target-Lookup
 *  - volumeLin : aktuelle Mixer-Volume (linear 0..1, useDrumMachineStore-Quelle)
 */
export interface AutoMixChannelDescriptor {
  id:        string;
  name:      string;
  category:  DrumCategoryLike;
  volumeLin: number;
}

export interface AutoMixPanelProps {
  /** Liste der aktuellen Channels (vom Parent via DrumMachine-State geliefert). */
  channels: AutoMixChannelDescriptor[];
  /** Callback wenn der User eine neue lineare Volume fuer einen Channel applizieren will. */
  onApplyVolume?: (channelId: string, newVolumeLin: number) => void;
  /** Optional: ob gerade Playback laeuft — UI zeigt "measuring..." Hint. */
  isPlaying?: boolean;
}

const POLL_MS = 250;

export function AutoMixPanel(props: AutoMixPanelProps) {
  const { channels, onApplyVolume, isPlaying = false } = props;

  const store = useAutoMixStore();

  // Aktive Channels in der Engine taggen (enable on mount, disable on unmount).
  useEffect(() => {
    const ids = channels.map(c => c.id);
    AudioEngine.enableAutoMixAnalysis(ids);
    return () => {
      AudioEngine.disableAutoMixAnalysis();
    };
    // Channel-Membership-Aenderungen sollen den Tap neu aufbauen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.map(c => c.id).join(",")]);

  // Polling-Loop fuer Live-Measured-LUFS pro Channel.
  const [snapshot, setSnapshot] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const tick = () => {
      const snap = AudioEngine.getAutoMixSnapshot();
      const next = new Map<string, number>();
      for (const [id, res] of snap.entries()) next.set(id, res.integrated);
      setSnapshot(next);
    };
    tick(); // erster Pull sofort
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Apply-Selection-Map (per Default off — User opted-in explizit).
  const [applyMap, setApplyMap] = useState<Map<string, boolean>>(new Map());

  // Suggestions berechnen — react auf Snapshot, Channel-State, Store-State.
  const suggestions: MixSuggestion[] = useMemo(() => {
    return channels.map(ch => {
      const measured  = snapshot.get(ch.id);
      const target    = store.getChannelTarget(ch.id, ch.category);
      const currentDb = volumeLinearToDb(ch.volumeLin);
      return computeSuggestion(
        ch.id,
        Number.isFinite(currentDb) ? currentDb : -60,
        typeof measured === "number" ? measured : -Infinity,
        target,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, snapshot, store.channelTargets, store.defaultTargetByCategory]);

  const toggleApply = useCallback((channelId: string) => {
    setApplyMap(prev => {
      const next = new Map(prev);
      next.set(channelId, !prev.get(channelId));
      return next;
    });
  }, []);

  const applySelected = useCallback(() => {
    const newVols = applySuggestions(suggestions, applyMap);
    for (const { channelId, newVolDb } of newVols) {
      const newLin = Math.max(0, Math.min(1, volumeDbToLinear(newVolDb)));
      onApplyVolume?.(channelId, newLin);
    }
    setApplyMap(new Map()); // reset selection
  }, [suggestions, applyMap, onApplyVolume]);

  const handleTargetChange = useCallback((channelId: string, value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    store.setChannelTarget(channelId, num);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.setChannelTarget]);

  const handleDurationChange = useCallback((ms: number) => {
    store.setMeasurementDuration(ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.setMeasurementDuration]);

  const handleResetMeasurement = useCallback(() => {
    AudioEngine.resetAutoMixAnalysis();
    setSnapshot(new Map());
  }, []);

  const handleResetTargets = useCallback(() => {
    store.resetAutoMix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.resetAutoMix]);

  const anySelected = useMemo(() => {
    for (const v of applyMap.values()) if (v) return true;
    return false;
  }, [applyMap]);

  return (
    <div className="flex flex-col gap-3 p-3 bg-bg-panel border border-border-color rounded" data-testid="automix-panel">
      <header className="flex items-center justify-between">
        <h2 className="text-text-primary text-sm font-semibold">
          Smart Auto-Mix
        </h2>
        <div className="text-xs text-text-muted">
          {isPlaying ? "Measuring…" : "Idle (start playback to measure)"}
        </div>
      </header>

      {/* Settings-Bar */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
        <label className="flex items-center gap-2">
          Measurement Duration
          <input
            type="range"
            min={MEASUREMENT_DURATION_MIN_MS}
            max={MEASUREMENT_DURATION_MAX_MS}
            step={1000}
            value={store.measurementDurationMs}
            onChange={e => handleDurationChange(Number(e.target.value))}
            className="w-32 accent-accent-primary"
          />
          <span className="text-text-primary tabular-nums">
            {(store.measurementDurationMs / 1000).toFixed(0)}s
          </span>
        </label>
        <button
          onClick={handleResetMeasurement}
          className="px-2 py-1 bg-bg-elevated hover:bg-accent-secondary text-text-primary border border-border-color rounded"
        >
          Reset Measurement
        </button>
        <button
          onClick={handleResetTargets}
          className="px-2 py-1 bg-bg-elevated hover:bg-accent-secondary text-text-primary border border-border-color rounded"
        >
          Reset Targets
        </button>
      </div>

      {/* Channel-Liste */}
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-[8rem_5rem_5rem_5rem_5rem_3rem] gap-2 text-xs text-text-dim px-1">
          <span>Channel</span>
          <span>Target LUFS</span>
          <span>Measured</span>
          <span>Suggest dB</span>
          <span>Current dB</span>
          <span>Apply</span>
        </div>
        {channels.length === 0 && (
          <div className="text-xs text-text-dim italic px-1 py-3">
            No channels available.
          </div>
        )}
        {channels.map((ch, i) => {
          const s = suggestions[i];
          const measured = snapshot.get(ch.id);
          const measuredDisplay =
            typeof measured === "number" && Number.isFinite(measured)
              ? measured.toFixed(1)
              : "–";
          const currentDbDisplay = Number.isFinite(s.currentVolumeDb)
            ? s.currentVolumeDb.toFixed(1)
            : "-∞";
          const isSelected = applyMap.get(ch.id) === true;
          const sign = s.suggestedGainDb > 0 ? "+" : "";

          return (
            <div
              key={ch.id}
              className="grid grid-cols-[8rem_5rem_5rem_5rem_5rem_3rem] gap-2 items-center text-xs px-1 py-1 hover:bg-bg-elevated rounded"
            >
              <span className="text-text-primary truncate" title={ch.name}>
                {ch.name}
              </span>
              <input
                type="number"
                step={0.5}
                min={-60}
                max={0}
                value={store.getChannelTarget(ch.id, ch.category)}
                onChange={e => handleTargetChange(ch.id, e.target.value)}
                className="bg-bg-base text-text-primary border border-border-color rounded px-1 py-0.5 w-full tabular-nums"
              />
              <span className="text-text-muted tabular-nums" data-testid={`automix-measured-${ch.id}`}>{measuredDisplay}</span>
              <span
                className={
                  s.suggestedGainDb === 0
                    ? "text-text-dim tabular-nums"
                    : s.suggestedGainDb > 0
                      ? "text-accent-success tabular-nums"
                      : "text-accent-danger tabular-nums"
                }
              >
                {sign}{s.suggestedGainDb.toFixed(1)}
              </span>
              <span className="text-text-muted tabular-nums">{currentDbDisplay}</span>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleApply(ch.id)}
                disabled={s.suggestedGainDb === 0}
                className="accent-accent-primary"
              />
            </div>
          );
        })}
      </div>

      <footer className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <span className="text-xs text-text-dim">
          Defaults: Kick −10, Snare −12, Hat −15, Bass −10, Synth −14
        </span>
        <button
          onClick={applySelected}
          disabled={!anySelected}
          data-testid="automix-apply"
          className="px-3 py-1 bg-accent-primary hover:bg-accent-secondary text-bg-base font-medium rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Apply Selected
        </button>
      </footer>
    </div>
  );
}

export default AutoMixPanel;
