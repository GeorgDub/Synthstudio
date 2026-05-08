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

export interface ChannelSends {
  reverb: number; // 0–1
  delay: number;  // 0–1
}

export interface MixerChannelState {
  partId: string;
  sends: ChannelSends;
  peakLevel: number; // 0–1, für VU-Meter (wird extern gesetzt)
}

export interface MixerState {
  channels: Record<string, MixerChannelState>;
  masterVolume: number; // 0–1
}

export interface MixerActions {
  setChannelSend: (partId: string, bus: "reverb" | "delay", level: number) => void;
  setChannelPeakLevel: (partId: string, level: number) => void;
  ensureChannel: (partId: string) => void;
  setMasterVolume: (vol: number) => void;
}

function makeChannel(partId: string): MixerChannelState {
  return {
    partId,
    sends: { reverb: 0, delay: 0 },
    peakLevel: 0,
  };
}

export function useMixerStore(): MixerState & MixerActions {
  const [state, setState] = useState<MixerState>({
    channels: {},
    masterVolume: 0.85,
  });

  const ensureChannel = useCallback((partId: string) => {
    setState(prev => {
      if (prev.channels[partId]) return prev;
      return {
        ...prev,
        channels: { ...prev.channels, [partId]: makeChannel(partId) },
      };
    });
  }, []);

  const setChannelSend = useCallback((partId: string, bus: "reverb" | "delay", level: number) => {
    setState(prev => {
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
  }, []);

  const setChannelPeakLevel = useCallback((partId: string, level: number) => {
    setState(prev => {
      const existing = prev.channels[partId] ?? makeChannel(partId);
      return {
        ...prev,
        channels: {
          ...prev.channels,
          [partId]: { ...existing, peakLevel: Math.max(0, Math.min(1, level)) },
        },
      };
    });
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    setState(prev => ({ ...prev, masterVolume: Math.max(0, Math.min(1, vol)) }));
  }, []);

  return {
    ...state,
    ensureChannel,
    setChannelSend,
    setChannelPeakLevel,
    setMasterVolume,
  };
}
