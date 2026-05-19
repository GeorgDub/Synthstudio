/**
 * Synthstudio – useMidiEventBridge (v2.40)
 *
 * Hängt alle "midi:*" Window-CustomEvent-Listener auf einmal an und routet
 * sie an die übergebenen Refs auf die Stores/Engines. Wurde aus App.tsx
 * herausgezogen weil die Bridge-Logik dort ~120 Zeilen pure Event-Wiring
 * war und mit jeder OSC-/MIDI-Erweiterung weiter gewachsen ist.
 *
 * Architektur: die Handler sind als Pure Functions (makeMidiBridgeHandlers)
 * implementiert damit sie ohne React-Renderer testbar bleiben. Der Hook
 * selbst ist nur noch das useEffect-Wiring.
 *
 * Empfangene Events (Auslöser → Wirkung):
 *
 *   midi:partVolume     {partId, value:0..1}         → dm.setPartVolume
 *   midi:partPan        {partId, value:-1..1}        → dm.setPartPan
 *   midi:partSolo       partId:string (toggle)       → dm.setPartSoloed
 *   midi:fxParam        {partId, param, value}        → dm.setPartFx
 *   midi:partMute       partId:string (toggle)       → dm.setPartMuted
 *   midi:partMuteSet    {partId, value:boolean}      → dm.setPartMuted (explicit)
 *   midi:bpm            {value:number} | number      → project.setBpm
 *   midi:playStop       {toggle?:boolean}            → project.togglePlayStop
 *   midi:stop           ∅                            → project.togglePlayStop wenn isPlaying
 *   midi:masterVolume   {value:number} | number      → AudioEngine.setMasterVolume
 *   midi:pattern        number | {index|patternId}    → dm.setActivePattern
 *   midi:subMixBusVolume {busId, value:0..2}          → store.setBusVolume
 *   midi:subMixBusPan    {busId, value:-1..1}         → store.setBusPan
 *   midi:subMixBusMute   busId:string (toggle)        → store.setBusMute
 *   midi:subMixBusSolo   busId:string (toggle)        → store.setBusSolo
 *   midi:subMixBusEqLowGain    {busId, value:-24..24}   → store.setBusEq3
 *   midi:subMixBusEqMidGain    {busId, value:-24..24}   → store.setBusEq3
 *   midi:subMixBusEqHighGain   {busId, value:-24..24}   → store.setBusEq3
 *   midi:subMixBusCompThreshold{busId, value:-60..0}    → store.setBusCompressor
 *   midi:subMixBusCompRatio    {busId, value:1..20}     → store.setBusCompressor
 *   midi:subMixBusReverbSend   {busId, value:0..1}      → store.setBusReverbSend
 *   midi:subMixBusDelaySend    {busId, value:0..1}      → store.setBusDelaySend
 *
 * Quellen: v1.76 (Volume/Pan/Solo/Fx), v1.92 (Pattern), v2.34 (BPM/PlayStop/
 * Stop/MasterVolume/MuteSet/Pattern-as-String), v3.81.0 (Sub-Mix-Bus-Controls),
 * v3.87.0 (Sub-Mix-Bus-FX-Params: EQ-3 + Compressor + Sends).
 */
import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { AudioEngine } from "@/audio/AudioEngine";
import type { ChannelFx } from "@/audio/AudioEngine";
import {
  getBusById,
  setBusVolume,
  setBusPan,
  setBusMute,
  setBusSolo,
  setBusEq3,
  setBusCompressor,
  setBusReverbSend,
  setBusDelaySend,
} from "@/store/useSubMixStore";
import {
  muteGroup as muteGroupStoreAction,
  soloGroup as soloGroupStoreAction,
  clearSoloGroup as clearSoloGroupStoreAction,
  isGroupSoloed,
} from "@/store/useMuteSoloGroupStore";

/**
 * Minimal-Interface der DrumMachine-Store-Methoden die diese Bridge braucht.
 * Vermeidet eine harte Abhängigkeit zum vollen useDrumMachineStore-Typ —
 * macht den Hook in Tests trivial mit Mocks aufrufbar.
 */
export interface MidiBridgeDmActions {
  setPartVolume: (partId: string, value: number) => void;
  setPartPan: (partId: string, value: number) => void;
  setPartSoloed: (partId: string, soloed: boolean, exclusive?: boolean) => void;
  setPartMuted: (partId: string, muted: boolean) => void;
  setPartFx: (partId: string, fx: Partial<ChannelFx>) => void;
  setActivePattern: (id: string) => void;
  getActivePattern: () => { parts: Array<{ id: string; muted: boolean; soloed: boolean }> } | undefined;
  patterns: Array<{ id: string }>;
}

export interface MidiBridgeProjectActions {
  setBpm: (bpm: number) => void;
  togglePlayStop: () => void;
  isPlaying: boolean;
}

export interface MidiBridgeRefs {
  dmRef: MutableRefObject<MidiBridgeDmActions>;
  projectRef: MutableRefObject<MidiBridgeProjectActions>;
  /** Optional override für Tests; produktiv ist es immer AudioEngine. */
  audioEngine?: { setMasterVolume: (v: number) => void };
}

export interface MidiBridgeHandlers {
  handleVolume: (e: Event) => void;
  handlePan: (e: Event) => void;
  handleSolo: (e: Event) => void;
  handleFxParam: (e: Event) => void;
  handleMute: (e: Event) => void;
  handleMuteSet: (e: Event) => void;
  handleBpm: (e: Event) => void;
  handlePlayStop: (e: Event) => void;
  handleStop: (e: Event) => void;
  handleMasterVolume: (e: Event) => void;
  handlePattern: (e: Event) => void;
  // v3.81.0: Sub-Mix-Bus-Controls
  handleSubMixBusVolume: (e: Event) => void;
  handleSubMixBusPan: (e: Event) => void;
  handleSubMixBusMute: (e: Event) => void;
  handleSubMixBusSolo: (e: Event) => void;
  // v3.87.0: Sub-Mix-Bus-FX-Params
  handleSubMixBusEqLowGain: (e: Event) => void;
  handleSubMixBusEqMidGain: (e: Event) => void;
  handleSubMixBusEqHighGain: (e: Event) => void;
  handleSubMixBusCompThreshold: (e: Event) => void;
  handleSubMixBusCompRatio: (e: Event) => void;
  handleSubMixBusReverbSend: (e: Event) => void;
  handleSubMixBusDelaySend: (e: Event) => void;
  // v3.126.0: Mute-Solo Bus Groups
  handleMuteGroup: (e: Event) => void;
  handleSoloGroup: (e: Event) => void;
  handleGroupApplyMute: (e: Event) => void;
  handleGroupApplySolo: (e: Event) => void;
  handleGroupApplyClearSolo: (e: Event) => void;
}

/**
 * Pure Factory: erzeugt alle Event-Handler ohne sie zu attachen.
 * Wird vom Hook für das tatsächliche window-Wiring genutzt — und von
 * Tests direkt aufgerufen.
 */
export function makeMidiBridgeHandlers(refs: MidiBridgeRefs): MidiBridgeHandlers {
  const { dmRef, projectRef } = refs;
  const audio = refs.audioEngine ?? AudioEngine;

  const handleVolume = (e: Event) => {
    const detail = (e as CustomEvent<{ partId: string; value: number }>).detail;
    if (detail && typeof detail.partId === "string" && typeof detail.value === "number") {
      dmRef.current.setPartVolume(detail.partId, Math.max(0, Math.min(1, detail.value)));
    }
  };
  const handlePan = (e: Event) => {
    const detail = (e as CustomEvent<{ partId: string; value: number }>).detail;
    if (detail && typeof detail.partId === "string" && typeof detail.value === "number") {
      dmRef.current.setPartPan(detail.partId, Math.max(-1, Math.min(1, detail.value)));
    }
  };
  const handleSolo = (e: Event) => {
    const partId = (e as CustomEvent<string>).detail;
    if (typeof partId !== "string") return;
    const pattern = dmRef.current.getActivePattern();
    const part = pattern?.parts.find((p) => p.id === partId);
    dmRef.current.setPartSoloed(partId, !(part?.soloed ?? false));
  };
  const handleFxParam = (e: Event) => {
    const detail = (e as CustomEvent<{ partId: string; param: string; value: number }>).detail;
    if (!detail || typeof detail.partId !== "string" || typeof detail.param !== "string") return;
    dmRef.current.setPartFx(detail.partId, {
      [detail.param]: detail.value,
    } as Partial<ChannelFx>);
  };
  const handleMute = (e: Event) => {
    const partId = (e as CustomEvent<string>).detail;
    if (typeof partId !== "string") return;
    const pattern = dmRef.current.getActivePattern();
    const part = pattern?.parts.find((p) => p.id === partId);
    dmRef.current.setPartMuted(partId, !(part?.muted ?? false));
  };
  const handleMuteSet = (e: Event) => {
    const detail = (e as CustomEvent<{ partId: string; value: boolean }>).detail;
    if (!detail || typeof detail.partId !== "string" || typeof detail.value !== "boolean") return;
    dmRef.current.setPartMuted(detail.partId, detail.value);
  };
  const handleBpm = (e: Event) => {
    const detail = (e as CustomEvent<{ value: number } | number>).detail;
    const value = typeof detail === "number" ? detail : detail?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    projectRef.current.setBpm(Math.max(20, Math.min(300, Math.round(value))));
  };
  const handlePlayStop = (e: Event) => {
    const detail = (e as CustomEvent<{ toggle?: boolean }>).detail;
    if (detail?.toggle === false) return;
    projectRef.current.togglePlayStop();
  };
  const handleStop = () => {
    if (projectRef.current.isPlaying) projectRef.current.togglePlayStop();
  };
  const handleMasterVolume = (e: Event) => {
    const detail = (e as CustomEvent<{ value: number } | number>).detail;
    const value = typeof detail === "number" ? detail : detail?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    audio.setMasterVolume(Math.max(0, Math.min(1, value)));
  };
  const handlePattern = (e: Event) => {
    const detail = (e as CustomEvent<unknown>).detail;
    const patterns = dmRef.current.patterns;

    if (typeof detail === "number") {
      const idx = Math.max(0, Math.floor(detail));
      if (idx >= 0 && idx < patterns.length) {
        dmRef.current.setActivePattern(patterns[idx].id);
      }
      return;
    }
    if (detail && typeof detail === "object") {
      const obj = detail as { index?: number; patternId?: string };
      if (typeof obj.index === "number") {
        const idx = Math.max(0, Math.floor(obj.index));
        if (idx >= 0 && idx < patterns.length) {
          dmRef.current.setActivePattern(patterns[idx].id);
        }
        return;
      }
      if (typeof obj.patternId === "string" && patterns.some((p) => p.id === obj.patternId)) {
        dmRef.current.setActivePattern(obj.patternId);
        return;
      }
    }
  };

  // v3.81.0: Sub-Mix-Bus-Controls — feuern via useMidi.applyMapping
  // CustomEvents, hier landen sie auf den useSubMixStore-Settern.
  const handleSubMixBusVolume = (e: Event) => {
    const detail = (e as CustomEvent<{ busId: string; value: number }>).detail;
    if (!detail || typeof detail.busId !== "string" || typeof detail.value !== "number") return;
    if (!Number.isFinite(detail.value)) return;
    setBusVolume(detail.busId, detail.value);
  };
  const handleSubMixBusPan = (e: Event) => {
    const detail = (e as CustomEvent<{ busId: string; value: number }>).detail;
    if (!detail || typeof detail.busId !== "string" || typeof detail.value !== "number") return;
    if (!Number.isFinite(detail.value)) return;
    setBusPan(detail.busId, detail.value);
  };
  const handleSubMixBusMute = (e: Event) => {
    const busId = (e as CustomEvent<string>).detail;
    if (typeof busId !== "string") return;
    const bus = getBusById(busId);
    if (!bus) return;
    setBusMute(busId, !bus.mute);
  };
  const handleSubMixBusSolo = (e: Event) => {
    const busId = (e as CustomEvent<string>).detail;
    if (typeof busId !== "string") return;
    const bus = getBusById(busId);
    if (!bus) return;
    setBusSolo(busId, !bus.solo);
  };

  // v3.126.0: Mute-Solo Bus Groups — Right-Click MIDI-Learn dispatcht
  // midi:muteGroup / midi:soloGroup mit groupId. Hier routen wir das auf
  // den useMuteSoloGroupStore (DOM-frei) der seinerseits "mute-solo-group:*"
  // events feuert die wir UNTEN handlen (apply to dm.setPartMuted).
  const handleMuteGroup = (e: Event) => {
    const groupId = (e as CustomEvent<string>).detail;
    if (typeof groupId !== "string" || !groupId) return;
    muteGroupStoreAction(groupId);
  };
  const handleSoloGroup = (e: Event) => {
    const groupId = (e as CustomEvent<string>).detail;
    if (typeof groupId !== "string" || !groupId) return;
    // Toggle-Verhalten: wenn group bereits soloed → clear, sonst solo.
    if (isGroupSoloed(groupId)) {
      clearSoloGroupStoreAction(groupId);
      return;
    }
    const pattern = dmRef.current.getActivePattern();
    if (!pattern) return;
    const allChannelIds = pattern.parts.map((p) => p.id);
    const currentMutes: Record<string, boolean> = {};
    for (const p of pattern.parts) currentMutes[p.id] = p.muted;
    soloGroupStoreAction(groupId, allChannelIds, currentMutes);
  };

  // Apply-Handlers: Store-Dispatch → DM.setPartMuted
  const handleGroupApplyMute = (e: Event) => {
    const detail = (e as CustomEvent<{ groupId: string; channelIds: string[] }>).detail;
    if (!detail || !Array.isArray(detail.channelIds)) return;
    for (const cid of detail.channelIds) {
      if (typeof cid === "string") dmRef.current.setPartMuted(cid, true);
    }
  };
  const handleGroupApplySolo = (e: Event) => {
    const detail = (e as CustomEvent<{ groupId: string; target: Array<{ channelId: string; muted: boolean }> }>).detail;
    if (!detail || !Array.isArray(detail.target)) return;
    for (const { channelId, muted } of detail.target) {
      if (typeof channelId === "string") dmRef.current.setPartMuted(channelId, muted);
    }
  };
  const handleGroupApplyClearSolo = (e: Event) => {
    const detail = (e as CustomEvent<{ groupId: string; target: Array<{ channelId: string; muted: boolean }> }>).detail;
    if (!detail || !Array.isArray(detail.target)) return;
    for (const { channelId, muted } of detail.target) {
      if (typeof channelId === "string") dmRef.current.setPartMuted(channelId, muted);
    }
  };

  // v3.87.0: Sub-Mix-Bus FX-Params — feuern via useMidi.applyMapping
  // CustomEvents, hier landen sie auf den useSubMixStore-FX-Settern.
  // Generic helper für (busId, value) → Setter mit numerischer Value.
  const dispatchBusFxValue = (
    e: Event,
    apply: (busId: string, value: number) => void,
  ): void => {
    const detail = (e as CustomEvent<{ busId: string; value: number }>).detail;
    if (!detail || typeof detail.busId !== "string" || typeof detail.value !== "number") return;
    if (!Number.isFinite(detail.value)) return;
    apply(detail.busId, detail.value);
  };
  const handleSubMixBusEqLowGain = (e: Event) =>
    dispatchBusFxValue(e, (id, v) => setBusEq3(id, { lowGain: v }));
  const handleSubMixBusEqMidGain = (e: Event) =>
    dispatchBusFxValue(e, (id, v) => setBusEq3(id, { midGain: v }));
  const handleSubMixBusEqHighGain = (e: Event) =>
    dispatchBusFxValue(e, (id, v) => setBusEq3(id, { highGain: v }));
  const handleSubMixBusCompThreshold = (e: Event) =>
    dispatchBusFxValue(e, (id, v) => setBusCompressor(id, { threshold: v }));
  const handleSubMixBusCompRatio = (e: Event) =>
    dispatchBusFxValue(e, (id, v) => setBusCompressor(id, { ratio: v }));
  const handleSubMixBusReverbSend = (e: Event) =>
    dispatchBusFxValue(e, (id, v) => setBusReverbSend(id, v));
  const handleSubMixBusDelaySend = (e: Event) =>
    dispatchBusFxValue(e, (id, v) => setBusDelaySend(id, v));

  return {
    handleVolume, handlePan, handleSolo, handleFxParam,
    handleMute, handleMuteSet,
    handleBpm, handlePlayStop, handleStop, handleMasterVolume,
    handlePattern,
    handleSubMixBusVolume, handleSubMixBusPan,
    handleSubMixBusMute, handleSubMixBusSolo,
    handleSubMixBusEqLowGain, handleSubMixBusEqMidGain, handleSubMixBusEqHighGain,
    handleSubMixBusCompThreshold, handleSubMixBusCompRatio,
    handleSubMixBusReverbSend, handleSubMixBusDelaySend,
    handleMuteGroup, handleSoloGroup,
    handleGroupApplyMute, handleGroupApplySolo, handleGroupApplyClearSolo,
  };
}

/**
 * Hängt alle MIDI-Event-Listener auf window an. Cleanup beim Unmount.
 * Refs werden absichtlich übergeben damit Re-Renders der Store-Werte
 * den Effect NICHT neu mounten (Effekt-deps leer).
 */
export function useMidiEventBridge(refs: MidiBridgeRefs): void {
  useEffect(() => {
    const h = makeMidiBridgeHandlers(refs);
    window.addEventListener("midi:partVolume", h.handleVolume);
    window.addEventListener("midi:partPan", h.handlePan);
    window.addEventListener("midi:partSolo", h.handleSolo);
    window.addEventListener("midi:fxParam", h.handleFxParam);
    window.addEventListener("midi:partMute", h.handleMute);
    window.addEventListener("midi:partMuteSet", h.handleMuteSet);
    window.addEventListener("midi:bpm", h.handleBpm);
    window.addEventListener("midi:playStop", h.handlePlayStop);
    window.addEventListener("midi:stop", h.handleStop);
    window.addEventListener("midi:masterVolume", h.handleMasterVolume);
    window.addEventListener("midi:pattern", h.handlePattern);
    window.addEventListener("midi:subMixBusVolume", h.handleSubMixBusVolume);
    window.addEventListener("midi:subMixBusPan", h.handleSubMixBusPan);
    window.addEventListener("midi:subMixBusMute", h.handleSubMixBusMute);
    window.addEventListener("midi:subMixBusSolo", h.handleSubMixBusSolo);
    window.addEventListener("midi:subMixBusEqLowGain", h.handleSubMixBusEqLowGain);
    window.addEventListener("midi:subMixBusEqMidGain", h.handleSubMixBusEqMidGain);
    window.addEventListener("midi:subMixBusEqHighGain", h.handleSubMixBusEqHighGain);
    window.addEventListener("midi:subMixBusCompThreshold", h.handleSubMixBusCompThreshold);
    window.addEventListener("midi:subMixBusCompRatio", h.handleSubMixBusCompRatio);
    window.addEventListener("midi:subMixBusReverbSend", h.handleSubMixBusReverbSend);
    window.addEventListener("midi:subMixBusDelaySend", h.handleSubMixBusDelaySend);
    window.addEventListener("midi:muteGroup", h.handleMuteGroup);
    window.addEventListener("midi:soloGroup", h.handleSoloGroup);
    window.addEventListener("mute-solo-group:muteChannels", h.handleGroupApplyMute);
    window.addEventListener("mute-solo-group:soloChannels", h.handleGroupApplySolo);
    window.addEventListener("mute-solo-group:clearSolo", h.handleGroupApplyClearSolo);
    return () => {
      window.removeEventListener("midi:partVolume", h.handleVolume);
      window.removeEventListener("midi:partPan", h.handlePan);
      window.removeEventListener("midi:partSolo", h.handleSolo);
      window.removeEventListener("midi:fxParam", h.handleFxParam);
      window.removeEventListener("midi:partMute", h.handleMute);
      window.removeEventListener("midi:partMuteSet", h.handleMuteSet);
      window.removeEventListener("midi:bpm", h.handleBpm);
      window.removeEventListener("midi:playStop", h.handlePlayStop);
      window.removeEventListener("midi:stop", h.handleStop);
      window.removeEventListener("midi:masterVolume", h.handleMasterVolume);
      window.removeEventListener("midi:pattern", h.handlePattern);
      window.removeEventListener("midi:subMixBusVolume", h.handleSubMixBusVolume);
      window.removeEventListener("midi:subMixBusPan", h.handleSubMixBusPan);
      window.removeEventListener("midi:subMixBusMute", h.handleSubMixBusMute);
      window.removeEventListener("midi:subMixBusSolo", h.handleSubMixBusSolo);
      window.removeEventListener("midi:subMixBusEqLowGain", h.handleSubMixBusEqLowGain);
      window.removeEventListener("midi:subMixBusEqMidGain", h.handleSubMixBusEqMidGain);
      window.removeEventListener("midi:subMixBusEqHighGain", h.handleSubMixBusEqHighGain);
      window.removeEventListener("midi:subMixBusCompThreshold", h.handleSubMixBusCompThreshold);
      window.removeEventListener("midi:subMixBusCompRatio", h.handleSubMixBusCompRatio);
      window.removeEventListener("midi:subMixBusReverbSend", h.handleSubMixBusReverbSend);
      window.removeEventListener("midi:subMixBusDelaySend", h.handleSubMixBusDelaySend);
      window.removeEventListener("midi:muteGroup", h.handleMuteGroup);
      window.removeEventListener("midi:soloGroup", h.handleSoloGroup);
      window.removeEventListener("mute-solo-group:muteChannels", h.handleGroupApplyMute);
      window.removeEventListener("mute-solo-group:soloChannels", h.handleGroupApplySolo);
      window.removeEventListener("mute-solo-group:clearSolo", h.handleGroupApplyClearSolo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
