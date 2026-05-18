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

/**
 * v3.44.0 (TASK-239 Phase 1): Plugin-Slot pro Channel.
 * v3.45.0: Multi-Slot Plugin-Chain (max 4 pro Channel, seriell).
 *
 * Foundation für VST-Host-Architektur. Phase-1 unterstützt AudioWorklet-
 * basierte Plugins (siehe `audio/PluginRegistry.ts`). Phase-2 (v4.0+) wird
 * native VST3/CLAP via IPC laden, das Slot-Schema bleibt strukturell gleich.
 *
 * Schema:
 *  - `pluginId`: Plugin-ID aus der Registry (z.B. "synthstudio.tape-sat")
 *  - `params`: aktuelle Werte für die Plugin-Params (clamped auf Schema)
 *  - `bypassed`: optionaler Bypass-State (Default false)
 *
 * Optional pro Channel — wenn kein Plugin geladen ist, ist die Slot-Liste leer.
 */
export interface MixerPluginSlot {
  pluginId: string;
  params: Record<string, number>;
  bypassed?: boolean;
}

/**
 * Maximalanzahl Plugin-Slots pro Channel. Begründung: CPU-Budget eines
 * AudioWorklet-Plugins liegt bei ~3–8% pro Channel (RBJ-Biquad/Saturation).
 * Bei 8 Channels und 4 Slots ergibt das im Worst-Case ~256% CPU — Audio-
 * Underrun-Schwelle. 4 ist außerdem ein klares "ich hab eine Plugin-Chain"-
 * Signal in der UI ohne Scroll. Höhere Counts sind eher VST3-Host-Territorium.
 */
export const MAX_PLUGIN_SLOTS_PER_CHANNEL = 4;

export interface MixerState {
  channels: Record<string, MixerChannelState>;
  masterVolume: number; // 0–1
  selectedChannelId: string | null;
  returnTracks: Record<"reverb" | "delay", MixerReturnTrackState>;
  insertChains: Record<string, MixerFxSlot[]>;
  eq16: Record<string, EqBand[]>;
  sidechains: Record<string, SidechainSettings>;
  transientShapers: Record<string, TransientShaperSettings>;
  /**
   * v3.44.0 (TASK-239 Phase 1): Plugin-Slot pro Channel.
   * v3.45.0: Multi-Slot — Schlüssel ist `partId`, Wert ist eine Liste mit
   * max `MAX_PLUGIN_SLOTS_PER_CHANNEL` Slots. Leere Liste / undefined heißt
   * "keine Plugins geladen".
   */
  pluginSlots: Record<string, MixerPluginSlot[]>;
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
  /**
   * v3.44.0 / v3.45.0: Plugin-Slot-Operationen.
   *
   * Multi-Slot-API (v3.45):
   *  - `addPluginSlot(partId, slot)` hängt einen Slot an die Chain an. NO-OP
   *    falls bereits MAX_PLUGIN_SLOTS_PER_CHANNEL erreicht (returnt false).
   *  - `removePluginSlot(partId, index)` entfernt Slot an Position. Bei
   *    out-of-range NO-OP.
   *  - `movePluginSlot(partId, from, to)` reordert die Chain (Up/Down).
   *  - `setPluginSlotParam(partId, index, paramId, value)` Param-Update am
   *    Slot mit Position `index`.
   *  - `setPluginSlotBypassed(partId, index, bypassed)`
   *  - `setPluginSlotPlugin(partId, index, slot)` ersetzt einen kompletten
   *    Slot (z.B. Plugin-Wechsel via Dropdown).
   *
   * Legacy-API (v3.44, single-slot):
   *  - `setPluginSlot(partId, slot|null)` ist ein Convenience-Wrapper:
   *    null → leert die Chain, sonst setzt die Chain auf [slot]. Bleibt
   *    erhalten damit bestehender Code (MixerView-useEffect, ChannelInspector-
   *    Legacy-Pfade) ohne Breaking-Change weiterläuft.
   *  - `setPluginParam(partId, paramId, value)` operiert auf Slot 0.
   *  - `setPluginBypassed(partId, bypassed)` operiert auf Slot 0.
   */
  addPluginSlot: (partId: string, slot: MixerPluginSlot) => boolean;
  removePluginSlot: (partId: string, index: number) => void;
  movePluginSlot: (partId: string, from: number, to: number) => void;
  setPluginSlotParam: (partId: string, index: number, paramId: string, value: number) => void;
  setPluginSlotBypassed: (partId: string, index: number, bypassed: boolean) => void;
  setPluginSlotPlugin: (partId: string, index: number, slot: MixerPluginSlot) => void;

  setPluginSlot: (partId: string, slot: MixerPluginSlot | null) => void;
  setPluginParam: (partId: string, paramId: string, value: number) => void;
  setPluginBypassed: (partId: string, bypassed: boolean) => void;
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
    pluginSlots: {},
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

/**
 * Sanitizer für einen einzelnen MixerPluginSlot aus unbekannter Quelle
 * (User-localStorage, .synth-File). Liefert null wenn unbrauchbar.
 */
function sanitizePluginSlot(raw: unknown): MixerPluginSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<MixerPluginSlot>;
  if (typeof s.pluginId !== "string" || s.pluginId.length === 0) return null;
  return {
    pluginId: s.pluginId,
    params: typeof s.params === "object" && s.params !== null
      ? { ...(s.params as Record<string, number>) }
      : {},
    bypassed: s.bypassed === true,
  };
}

/**
 * Migriert pluginSlots aus v3.44 (single-slot) und v3.45 (multi-slot) Format
 * auf das aktuelle v3.45 Schema `Record<partId, MixerPluginSlot[]>`.
 *
 * v3.44 hatte `Record<partId, MixerPluginSlot | undefined>` (Single-Slot pro
 * Channel). Diese Werte werden in `[slot]` gewrappt damit der bestehende
 * Channel-State erhalten bleibt (keine Daten verloren).
 *
 * Empty-/Invalid-Channels → []. Excess-Slots (>MAX) → trimmed silent.
 */
export function migratePluginSlots(raw: unknown): Record<string, MixerPluginSlot[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, MixerPluginSlot[]> = {};
  for (const [partId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      // v3.45 multi-slot format
      const cleaned = value
        .map(sanitizePluginSlot)
        .filter((s): s is MixerPluginSlot => s !== null)
        .slice(0, MAX_PLUGIN_SLOTS_PER_CHANNEL);
      out[partId] = cleaned;
    } else if (value && typeof value === "object") {
      // v3.44 single-slot format — wrap in array
      const single = sanitizePluginSlot(value);
      out[partId] = single ? [single] : [];
    } else {
      out[partId] = [];
    }
  }
  return out;
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
      // v3.44.0 / v3.45.0: Plugin-Slots. Defensive Re-Load.
      //  - v3.45 schema: Record<partId, MixerPluginSlot[]> — Liste pro Channel.
      //  - v3.44 schema (Migration): Record<partId, MixerPluginSlot | undefined>
      //    — Single-Slot pro Channel. Wir mappen das automatisch auf [slot].
      // Defensive: ungültige Slots (fehlende pluginId etc.) werden silent
      // gefiltert, das Plugin-Registry-Lookup im AudioEngine entscheidet
      // dann nochmal über Validität.
      pluginSlots: migratePluginSlots(parsed.pluginSlots),
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

  // ─── v3.44.0 / v3.45.0: Plugin-Slot Actions ─────────────────────────────
  // Multi-Slot Chain pro Channel (max MAX_PLUGIN_SLOTS_PER_CHANNEL = 4).
  // Reihenfolge wirkt seriell: chain[0] → chain[1] → ... → chain[N-1].
  const addPluginSlot = useCallback((partId: string, slot: MixerPluginSlot): boolean => {
    let appended = false;
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (current.length >= MAX_PLUGIN_SLOTS_PER_CHANNEL) {
        return prev; // ignore — chain full
      }
      appended = true;
      return {
        ...prev,
        pluginSlots: {
          ...prev.pluginSlots,
          [partId]: [...current, { ...slot, params: { ...slot.params } }],
        },
      };
    });
    return appended;
  }, [commit]);

  const removePluginSlot = useCallback((partId: string, index: number) => {
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (index < 0 || index >= current.length) return prev;
      const next = [...current.slice(0, index), ...current.slice(index + 1)];
      return {
        ...prev,
        pluginSlots: { ...prev.pluginSlots, [partId]: next },
      };
    });
  }, [commit]);

  const movePluginSlot = useCallback((partId: string, from: number, to: number) => {
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (from === to) return prev;
      if (from < 0 || from >= current.length) return prev;
      if (to < 0 || to >= current.length) return prev;
      const reordered = [...current];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      return {
        ...prev,
        pluginSlots: { ...prev.pluginSlots, [partId]: reordered },
      };
    });
  }, [commit]);

  const setPluginSlotParam = useCallback((partId: string, index: number, paramId: string, value: number) => {
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (index < 0 || index >= current.length) return prev;
      const next = current.map((s, i) =>
        i === index ? { ...s, params: { ...s.params, [paramId]: value } } : s,
      );
      return {
        ...prev,
        pluginSlots: { ...prev.pluginSlots, [partId]: next },
      };
    });
  }, [commit]);

  const setPluginSlotBypassed = useCallback((partId: string, index: number, bypassed: boolean) => {
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (index < 0 || index >= current.length) return prev;
      const next = current.map((s, i) => i === index ? { ...s, bypassed } : s);
      return {
        ...prev,
        pluginSlots: { ...prev.pluginSlots, [partId]: next },
      };
    });
  }, [commit]);

  const setPluginSlotPlugin = useCallback((partId: string, index: number, slot: MixerPluginSlot) => {
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (index < 0 || index >= current.length) return prev;
      const next = current.map((s, i) =>
        i === index ? { ...slot, params: { ...slot.params } } : s,
      );
      return {
        ...prev,
        pluginSlots: { ...prev.pluginSlots, [partId]: next },
      };
    });
  }, [commit]);

  // ─── Legacy single-slot API (v3.44) — Wrapper auf Multi-Slot ──────────
  const setPluginSlot = useCallback((partId: string, slot: MixerPluginSlot | null) => {
    commit(prev => {
      const next = { ...prev.pluginSlots };
      if (slot === null) {
        next[partId] = [];
      } else {
        next[partId] = [{ ...slot, params: { ...slot.params } }];
      }
      return { ...prev, pluginSlots: next };
    });
  }, [commit]);

  const setPluginParam = useCallback((partId: string, paramId: string, value: number) => {
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (current.length === 0) return prev;
      const next = current.map((s, i) =>
        i === 0 ? { ...s, params: { ...s.params, [paramId]: value } } : s,
      );
      return {
        ...prev,
        pluginSlots: { ...prev.pluginSlots, [partId]: next },
      };
    });
  }, [commit]);

  const setPluginBypassed = useCallback((partId: string, bypassed: boolean) => {
    commit(prev => {
      const current = prev.pluginSlots[partId] ?? [];
      if (current.length === 0) return prev;
      const next = current.map((s, i) => i === 0 ? { ...s, bypassed } : s);
      return {
        ...prev,
        pluginSlots: { ...prev.pluginSlots, [partId]: next },
      };
    });
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
    addPluginSlot,
    removePluginSlot,
    movePluginSlot,
    setPluginSlotParam,
    setPluginSlotBypassed,
    setPluginSlotPlugin,
    setPluginSlot,
    setPluginParam,
    setPluginBypassed,
    resetMixer,
  };
}
