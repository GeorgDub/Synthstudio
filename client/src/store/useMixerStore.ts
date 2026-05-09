/**
 * Synthstudio – useMixerStore.ts
 *
 * State für den Mixer-View:
 * - Send-Level pro Kanal zu globalem Reverb-Bus und Delay-Bus
 * - VU-Meter-Daten (Peak-Level pro Kanal, wird von AudioEngine geliefert)
 * - Return-Bus-Parameter (Reverb Decay/Wet, Delay Time/Feedback/Wet)
 * - Sidechain-Routing (Quell-Kanal pro Kanal)
 * - Compressor Gain-Reduction pro Kanal
 * - FX-Panel-Auswahl im Mixer
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
  gainReduction: number; // dB (negative), für GR-Meter
  sidechainSource: string | null; // Part-ID der Sidechain-Quelle
}

export interface ReturnBusState {
  reverbDecay: number;   // 0.1–10 s
  reverbWet: number;     // 0–1
  delayTime: number;     // 0.01–2 s
  delayFeedback: number; // 0–0.95
  delayWet: number;      // 0–1
}

export interface MixerState {
  channels: Record<string, MixerChannelState>;
  masterVolume: number; // 0–1
  returnBus: ReturnBusState;
  fxPanelPartId: string | null; // Welcher Kanal hat das FX-Panel offen (im Mixer)
}

export interface MixerActions {
  setChannelSend: (partId: string, bus: "reverb" | "delay", level: number) => void;
  setChannelPeakLevel: (partId: string, level: number) => void;
  setChannelGainReduction: (partId: string, gr: number) => void;
  setChannelSidechainSource: (partId: string, sourceId: string | null) => void;
  ensureChannel: (partId: string) => void;
  setMasterVolume: (vol: number) => void;
  setReturnBusParam: (param: keyof ReturnBusState, value: number) => void;
  setMixerFxPanelPartId: (partId: string | null) => void;
}

function makeChannel(partId: string): MixerChannelState {
  return {
    partId,
    sends: { reverb: 0, delay: 0 },
    peakLevel: 0,
    gainReduction: 0,
    sidechainSource: null,
  };
}

export function useMixerStore(): MixerState & MixerActions {
  const [state, setState] = useState<MixerState>({
    channels: {},
    masterVolume: 0.85,
    returnBus: {
      reverbDecay: 2.0,
      reverbWet: 0.6,
      delayTime: 0.5,
      delayFeedback: 0.35,
      delayWet: 0.5,
    },
    fxPanelPartId: null,
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

  const setChannelGainReduction = useCallback((partId: string, gr: number) => {
    setState(prev => {
      const existing = prev.channels[partId] ?? makeChannel(partId);
      return {
        ...prev,
        channels: {
          ...prev.channels,
          [partId]: { ...existing, gainReduction: gr },
        },
      };
    });
  }, []);

  const setChannelSidechainSource = useCallback((partId: string, sourceId: string | null) => {
    setState(prev => {
      const existing = prev.channels[partId] ?? makeChannel(partId);
      return {
        ...prev,
        channels: {
          ...prev.channels,
          [partId]: { ...existing, sidechainSource: sourceId },
        },
      };
    });
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    setState(prev => ({ ...prev, masterVolume: Math.max(0, Math.min(1, vol)) }));
  }, []);

  const setReturnBusParam = useCallback((param: keyof ReturnBusState, value: number) => {
    setState(prev => ({
      ...prev,
      returnBus: { ...prev.returnBus, [param]: value },
    }));
  }, []);

  const setMixerFxPanelPartId = useCallback((partId: string | null) => {
    setState(prev => ({ ...prev, fxPanelPartId: partId }));
  }, []);

  return {
    ...state,
    ensureChannel,
    setChannelSend,
    setChannelPeakLevel,
    setChannelGainReduction,
    setChannelSidechainSource,
    setMasterVolume,
    setReturnBusParam,
    setMixerFxPanelPartId,
  };
}
