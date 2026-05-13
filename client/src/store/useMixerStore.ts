/**
 * Synthstudio – useMixerStore.ts
 *
 * State für den Mixer-View:
 * - Send-Level pro Kanal zu globalem Reverb-Bus und Delay-Bus
 * - VU-Meter-Daten (Peak-Level pro Kanal, wird von AudioEngine geliefert)
 *
 * Volume, Pan, Mute, Solo leben weiterhin im useDrumMachineStore (single source of truth).
 */

import { useState, useCallback } from "react";
import {
  DEFAULT_SIDECHAIN,
  DEFAULT_TRANSIENT_SHAPER,
  createDefaultEqBands,
  makeMixerFxSlot,
  moveFxSlot,
  normalizeSidechain,
  normalizeTransientShaper,
  removeFxSlot,
  sanitizeEqBands,
  toggleFxSlot,
  type EqBand,
  type MixerFxSlot,
  type MixerFxType,
  type SidechainSettings,
  type TransientShaperSettings,
} from "@/utils/mixerFx";

export interface ChannelSends {
  reverb: number; // 0–1
  delay: number;  // 0–1
}

export interface MixerChannelState {
  partId: string;
  sends: ChannelSends;
  peakLevel: number; // 0–1, für VU-Meter (wird extern gesetzt)
}

export interface MixerReturnTrackState {
  id: "reverb" | "delay";
  name: string;
  volume: number;
  muted: boolean;
}

export interface MixerState {
  channels: Record<string, MixerChannelState>;
  masterVolume: number; // 0–1
  selectedChannelId: string | null;
  returnTracks: Record<"reverb" | "delay", MixerReturnTrackState>;
  insertChains: Record<string, MixerFxSlot[]>;
  eq16: Record<string, EqBand[]>;
  sidechains: Record<string, SidechainSettings>;
  transientShapers: Record<string, TransientShaperSettings>;
}

export interface MixerActions {
  setChannelSend: (partId: string, bus: "reverb" | "delay", level: number) => void;
  setChannelPeakLevel: (partId: string, level: number) => void;
  ensureChannel: (partId: string) => void;
  setMasterVolume: (vol: number) => void;
  setSelectedChannel: (partId: string | null) => void;
  setReturnTrackVolume: (id: "reverb" | "delay", volume: number) => void;
  setReturnTrackMuted: (id: "reverb" | "delay", muted: boolean) => void;
  addInsertFx: (partId: string, type: MixerFxType) => void;
  removeInsertFx: (partId: string, slotId: string) => void;
  toggleInsertFx: (partId: string, slotId: string) => void;
  moveInsertFx: (partId: string, fromIndex: number, toIndex: number) => void;
  updateInsertFxParam: (partId: string, slotId: string, param: string, value: number | string | boolean) => void;
  setEqBandGain: (partId: string, bandIndex: number, gain: number) => void;
  resetEqBands: (partId: string) => void;
  setSidechain: (partId: string, update: Partial<SidechainSettings>) => void;
  setTransientShaper: (partId: string, update: Partial<TransientShaperSettings>) => void;
  /** Resettet alle Mixer-Daten (Channels, Sends, EQ, FX-Chains) + entfernt localStorage-Persistenz (BUG-013 fix). */
  resetMixer: () => void;
}

const MIXER_STORAGE_KEY = "synthstudio:mixer:v1";

const DEFAULT_RETURN_TRACKS: MixerState["returnTracks"] = {
  reverb: { id: "reverb", name: "Reverb Return", volume: 0.85, muted: false },
  delay: { id: "delay", name: "Delay Return", volume: 0.85, muted: false },
};

function defaultMixerState(): MixerState {
  return {
    channels: {},
    masterVolume: 0.85,
    selectedChannelId: null,
    returnTracks: DEFAULT_RETURN_TRACKS,
    insertChains: {},
    eq16: {},
    sidechains: {},
    transientShapers: {},
  };
}

function makeChannel(partId: string): MixerChannelState {
  return {
    partId,
    sends: { reverb: 0, delay: 0 },
    peakLevel: 0,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function loadMixerState(): MixerState {
  if (typeof window === "undefined") return defaultMixerState();

  try {
    const raw = window.localStorage.getItem(MIXER_STORAGE_KEY);
    if (!raw) return defaultMixerState();
    const parsed = JSON.parse(raw) as Partial<MixerState>;
    const base = defaultMixerState();

    return {
      ...base,
      ...parsed,
      channels: Object.fromEntries(
        Object.entries(parsed.channels ?? {}).map(([partId, channel]) => [
          partId,
          {
            ...makeChannel(partId),
            ...channel,
            peakLevel: 0,
            sends: {
              reverb: clamp01(channel.sends?.reverb ?? 0),
              delay: clamp01(channel.sends?.delay ?? 0),
            },
          },
        ]),
      ),
      masterVolume: clamp01(parsed.masterVolume ?? base.masterVolume),
      returnTracks: {
        reverb: { ...base.returnTracks.reverb, ...parsed.returnTracks?.reverb },
        delay: { ...base.returnTracks.delay, ...parsed.returnTracks?.delay },
      },
      insertChains: parsed.insertChains ?? {},
      eq16: Object.fromEntries(
        Object.entries(parsed.eq16 ?? {}).map(([partId, bands]) => [partId, sanitizeEqBands(bands)]),
      ),
      sidechains: Object.fromEntries(
        Object.entries(parsed.sidechains ?? {}).map(([partId, settings]) => [partId, normalizeSidechain(settings)]),
      ),
      transientShapers: Object.fromEntries(
        Object.entries(parsed.transientShapers ?? {}).map(([partId, settings]) => [partId, normalizeTransientShaper(settings)]),
      ),
    };
  } catch {
    return defaultMixerState();
  }
}

function saveMixerState(state: MixerState): void {
  if (typeof window === "undefined") return;

  try {
    const channels = Object.fromEntries(
      Object.entries(state.channels).map(([partId, channel]) => [
        partId,
        { ...channel, peakLevel: 0 },
      ]),
    );
    window.localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify({ ...state, channels }));
  } catch {
    // localStorage is best-effort only; mixer editing must continue without it.
  }
}

export function useMixerStore(): MixerState & MixerActions {
  const [state, setState] = useState<MixerState>(() => loadMixerState());

  const commit = useCallback((updater: (prev: MixerState) => MixerState, persist = true) => {
    setState(prev => {
      const next = updater(prev);
      if (persist) saveMixerState(next);
      return next;
    });
  }, []);

  const ensureChannel = useCallback((partId: string) => {
    commit(prev => {
      const hasChannel = Boolean(prev.channels[partId]);
      const hasEq = Boolean(prev.eq16[partId]);
      const hasSidechain = Boolean(prev.sidechains[partId]);
      const hasTransient = Boolean(prev.transientShapers[partId]);
      if (hasChannel && hasEq && hasSidechain && hasTransient) return prev;

      return {
        ...prev,
        channels: {
          ...prev.channels,
          [partId]: prev.channels[partId] ?? makeChannel(partId),
        },
        eq16: {
          ...prev.eq16,
          [partId]: prev.eq16[partId] ?? createDefaultEqBands(),
        },
        sidechains: {
          ...prev.sidechains,
          [partId]: prev.sidechains[partId] ?? { ...DEFAULT_SIDECHAIN },
        },
        transientShapers: {
          ...prev.transientShapers,
          [partId]: prev.transientShapers[partId] ?? { ...DEFAULT_TRANSIENT_SHAPER },
        },
      };
    });
  }, [commit]);

  const setChannelSend = useCallback((partId: string, bus: "reverb" | "delay", level: number) => {
    commit(prev => {
      const existing = prev.channels[partId] ?? makeChannel(partId);
      return {
        ...prev,
        channels: {
          ...prev.channels,
          [partId]: {
            ...existing,
            sends: { ...existing.sends, [bus]: Math.max(0, Math.min(1, level)) },
          },
        },
      };
    });
  }, [commit]);

  const setChannelPeakLevel = useCallback((partId: string, level: number) => {
    commit(prev => {
      const existing = prev.channels[partId] ?? makeChannel(partId);
      return {
        ...prev,
        channels: {
          ...prev.channels,
          [partId]: { ...existing, peakLevel: Math.max(0, Math.min(1, level)) },
        },
      };
    }, false);
  }, [commit]);

  const setMasterVolume = useCallback((vol: number) => {
    commit(prev => ({ ...prev, masterVolume: clamp01(vol) }));
  }, [commit]);

  const setSelectedChannel = useCallback((partId: string | null) => {
    commit(prev => ({ ...prev, selectedChannelId: partId }));
  }, [commit]);

  const setReturnTrackVolume = useCallback((id: "reverb" | "delay", volume: number) => {
    commit(prev => ({
      ...prev,
      returnTracks: {
        ...prev.returnTracks,
        [id]: { ...prev.returnTracks[id], volume: clamp01(volume) },
      },
    }));
  }, [commit]);

  const setReturnTrackMuted = useCallback((id: "reverb" | "delay", muted: boolean) => {
    commit(prev => ({
      ...prev,
      returnTracks: {
        ...prev.returnTracks,
        [id]: { ...prev.returnTracks[id], muted },
      },
    }));
  }, [commit]);

  const addInsertFx = useCallback((partId: string, type: MixerFxType) => {
    commit(prev => ({
      ...prev,
      insertChains: {
        ...prev.insertChains,
        [partId]: [...(prev.insertChains[partId] ?? []), makeMixerFxSlot(type)],
      },
    }));
  }, [commit]);

  const removeInsertFx = useCallback((partId: string, slotId: string) => {
    commit(prev => ({
      ...prev,
      insertChains: {
        ...prev.insertChains,
        [partId]: removeFxSlot(prev.insertChains[partId] ?? [], slotId),
      },
    }));
  }, [commit]);

  const toggleInsertFx = useCallback((partId: string, slotId: string) => {
    commit(prev => ({
      ...prev,
      insertChains: {
        ...prev.insertChains,
        [partId]: toggleFxSlot(prev.insertChains[partId] ?? [], slotId),
      },
    }));
  }, [commit]);

  const moveInsertFx = useCallback((partId: string, fromIndex: number, toIndex: number) => {
    commit(prev => ({
      ...prev,
      insertChains: {
        ...prev.insertChains,
        [partId]: moveFxSlot(prev.insertChains[partId] ?? [], fromIndex, toIndex),
      },
    }));
  }, [commit]);

  const updateInsertFxParam = useCallback((partId: string, slotId: string, param: string, value: number | string | boolean) => {
    commit(prev => ({
      ...prev,
      insertChains: {
        ...prev.insertChains,
        [partId]: (prev.insertChains[partId] ?? []).map(slot =>
          slot.id === slotId
            ? { ...slot, params: { ...slot.params, [param]: value } }
            : slot,
        ),
      },
    }));
  }, [commit]);

  const setEqBandGain = useCallback((partId: string, bandIndex: number, gain: number) => {
    commit(prev => {
      const bands = sanitizeEqBands(prev.eq16[partId]);
      if (bandIndex < 0 || bandIndex >= bands.length) return prev;
      const nextBands = bands.map((band, index) =>
        index === bandIndex ? { ...band, gain: Math.max(-24, Math.min(24, gain)) } : band,
      );
      return { ...prev, eq16: { ...prev.eq16, [partId]: nextBands } };
    });
  }, [commit]);

  const resetEqBands = useCallback((partId: string) => {
    commit(prev => ({ ...prev, eq16: { ...prev.eq16, [partId]: createDefaultEqBands() } }));
  }, [commit]);

  /** Resettet alle Mixer-Daten + entfernt localStorage-Persistenz (BUG-013). */
  const resetMixer = useCallback(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(MIXER_STORAGE_KEY);
      }
    } catch { /* ignore */ }
    setState(defaultMixerState());
  }, []);

  const setSidechain = useCallback((partId: string, update: Partial<SidechainSettings>) => {
    commit(prev => ({
      ...prev,
      sidechains: {
        ...prev.sidechains,
        [partId]: normalizeSidechain({ ...(prev.sidechains[partId] ?? DEFAULT_SIDECHAIN), ...update }),
      },
    }));
  }, [commit]);

  const setTransientShaper = useCallback((partId: string, update: Partial<TransientShaperSettings>) => {
    commit(prev => ({
      ...prev,
      transientShapers: {
        ...prev.transientShapers,
        [partId]: normalizeTransientShaper({
          ...(prev.transientShapers[partId] ?? DEFAULT_TRANSIENT_SHAPER),
          ...update,
        }),
      },
    }));
  }, [commit]);

  return {
    ...state,
    ensureChannel,
    setChannelSend,
    setChannelPeakLevel,
    setMasterVolume,
    setSelectedChannel,
    setReturnTrackVolume,
    setReturnTrackMuted,
    addInsertFx,
    removeInsertFx,
    toggleInsertFx,
    moveInsertFx,
    updateInsertFxParam,
    setEqBandGain,
    resetEqBands,
    setSidechain,
    setTransientShaper,
    resetMixer,
  };
}
