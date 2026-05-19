/**
 * Synthstudio – useAudioSidechainStore (v3.119.0)
 *
 * Audio-triggered Sidechain-Chains (DAW-grade, peak-detect-driven).
 * Unterscheidet sich vom step-triggered Sidechain im useMixerStore:
 *   - useMixerStore.sidechains:   deterministisch, an Pattern-Steps gebunden
 *   - useAudioSidechainStore:     analog zur DAW, peak-detect auf source-audio
 *
 * Pattern: Custom-Observer-Store (siehe useProjectDiffStore / useSceneStore).
 * Persistenz: localStorage `ss-audio-sidechain:v1` — nur die Chain-Defs.
 * Runtime-Instances (AudioSidechainNode) liegen in der AudioEngine.
 */

import { useEffect, useReducer } from "react";
import {
  DEFAULT_AUDIO_SIDECHAIN_CONFIG,
  sanitizeAudioSidechainConfig,
  type AudioSidechainConfig,
} from "@/audio/AudioSidechainNode";

const STORAGE_KEY = "ss-audio-sidechain:v1";

export interface AudioSidechainChain {
  /** Stable Chain-ID (UUID-ähnlich, im Store generiert). */
  id: string;
  /** Source-Channel (Part-ID) — peak-detect auf dessen Output. */
  sourceChannelId: string;
  /** Target-Channel (Part-ID) — der dynamisch geduckt wird. */
  targetChannelId: string;
  enabled: boolean;
  config: AudioSidechainConfig;
}

interface AudioSidechainStoreState {
  chains: AudioSidechainChain[];
}

type Listener = () => void;
const _listeners = new Set<Listener>();
function _notify(): void {
  _listeners.forEach((l) => l());
}

function _loadFromStorage(): AudioSidechainStoreState {
  if (typeof localStorage === "undefined") return { chains: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chains: [] };
    const parsed = JSON.parse(raw) as Partial<AudioSidechainStoreState>;
    if (!parsed || !Array.isArray(parsed.chains)) return { chains: [] };
    const chains: AudioSidechainChain[] = [];
    const seenIds = new Set<string>();
    for (const c of parsed.chains) {
      if (!c || typeof c !== "object") continue;
      const id = typeof c.id === "string" && c.id ? c.id : _generateChainId();
      if (seenIds.has(id)) continue;
      const sourceChannelId = typeof c.sourceChannelId === "string" ? c.sourceChannelId : "";
      const targetChannelId = typeof c.targetChannelId === "string" ? c.targetChannelId : "";
      if (!sourceChannelId || !targetChannelId) continue;
      seenIds.add(id);
      chains.push({
        id,
        sourceChannelId,
        targetChannelId,
        enabled: c.enabled !== false,
        config: sanitizeAudioSidechainConfig(c.config ?? {}),
      });
    }
    return { chains };
  } catch {
    return { chains: [] };
  }
}

function _persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* quota / disabled — ignore */
  }
}

let _idCounter = 0;
function _generateChainId(): string {
  _idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `asc-${time}-${rand}-${_idCounter}`;
}

let _state: AudioSidechainStoreState = _loadFromStorage();

// ─── Public Getters / Actions ────────────────────────────────────────────────

export function getAudioSidechainState(): AudioSidechainStoreState {
  return _state;
}

export interface AddChainInput {
  sourceChannelId: string;
  targetChannelId: string;
  config?: Partial<AudioSidechainConfig>;
  enabled?: boolean;
}

export function addChain(input: AddChainInput): AudioSidechainChain {
  const chain: AudioSidechainChain = {
    id: _generateChainId(),
    sourceChannelId: input.sourceChannelId,
    targetChannelId: input.targetChannelId,
    enabled: input.enabled !== false,
    config: sanitizeAudioSidechainConfig({
      ...DEFAULT_AUDIO_SIDECHAIN_CONFIG,
      ...(input.config ?? {}),
    }),
  };
  _state = { ..._state, chains: [..._state.chains, chain] };
  _persist();
  _notify();
  return chain;
}

export function removeChain(id: string): void {
  const next = _state.chains.filter((c) => c.id !== id);
  if (next.length === _state.chains.length) return;
  _state = { ..._state, chains: next };
  _persist();
  _notify();
}

export interface UpdateChainInput {
  sourceChannelId?: string;
  targetChannelId?: string;
  enabled?: boolean;
  config?: Partial<AudioSidechainConfig>;
}

export function updateChain(id: string, update: UpdateChainInput): void {
  let changed = false;
  const next = _state.chains.map((c) => {
    if (c.id !== id) return c;
    const merged: AudioSidechainChain = {
      ...c,
      sourceChannelId: update.sourceChannelId ?? c.sourceChannelId,
      targetChannelId: update.targetChannelId ?? c.targetChannelId,
      enabled: update.enabled ?? c.enabled,
      config: update.config
        ? sanitizeAudioSidechainConfig({ ...c.config, ...update.config })
        : c.config,
    };
    changed = true;
    return merged;
  });
  if (!changed) return;
  _state = { ..._state, chains: next };
  _persist();
  _notify();
}

/**
 * Entfernt alle Chains, die einen bestimmten Channel als source ODER target
 * referenzieren — z.B. wenn ein Channel gelöscht wird.
 */
export function removeChainsForChannel(channelId: string): void {
  const next = _state.chains.filter(
    (c) => c.sourceChannelId !== channelId && c.targetChannelId !== channelId,
  );
  if (next.length === _state.chains.length) return;
  _state = { ..._state, chains: next };
  _persist();
  _notify();
}

/** Test-Helper. */
export function __resetAudioSidechainStoreForTests(): void {
  _state = { chains: [] };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  _notify();
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useAudioSidechainStore(): AudioSidechainStoreState & {
  addChain: typeof addChain;
  removeChain: typeof removeChain;
  updateChain: typeof updateChain;
  removeChainsForChannel: typeof removeChainsForChannel;
} {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    ..._state,
    addChain,
    removeChain,
    updateChain,
    removeChainsForChannel,
  };
}
