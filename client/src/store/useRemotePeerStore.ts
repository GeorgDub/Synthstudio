/**
 * Synthstudio – useRemotePeerStore.ts (v1.11)
 *
 * Singleton-Store für den Zustand des Kollaborations-Partners.
 * Wird aktualisiert durch snapshot:full-Events aus useCollabSync.
 *
 * Enthält:
 *   - Kompletten PatternData-Zustand des Partners
 *   - Aktive Pattern-ID, BPM, Wiedergabe-Status
 *   - Partner-Metadaten (userId, userName, color)
 *
 * Mutations:
 *   setRemotePeer()        – Vollständiges Update (beim Empfang von snapshot:full)
 *   toggleRemoteStep()     – Einzelnen Schritt umschalten (beim eigenen Klick auf Partner-DM)
 *   setRemoteActivePattern() – Aktives Pattern setzen
 *   setRemoteBpmPeer()     – BPM setzen
 *   setRemoteIsPlaying()   – Wiedergabe-Status
 *   resetRemotePeer()      – Zurücksetzen (beim Session-Ende)
 */

import { useEffect, useReducer } from "react";
import type { PatternData } from "@/audio/AudioEngine";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface RemotePeerState {
  /** WebSocket-userId des Partners */
  userId: string | null;
  /** Anzeigename des Partners */
  userName: string | null;
  /** Zugewiesene Akzentfarbe des Partners */
  color: string | null;
  /** Vollständige Pattern-Liste des Partners */
  patterns: PatternData[];
  /** ID des aktuell aktiven Patterns beim Partner */
  activePatternId: string | null;
  /** BPM des Partners */
  bpm: number;
  /** Ob der Partner gerade abspielt */
  isPlaying: boolean;
  /** Sample-Bibliothek des Partners (für Sample-Browser-Anzeige) */
  samples: Array<{ id: string; name: string; path: string; category: string }>;
}

// ─── Singleton-State ──────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();

let _state: RemotePeerState = {
  userId: null,
  userName: null,
  color: null,
  patterns: [],
  activePatternId: null,
  bpm: 120,
  isPlaying: false,
  samples: [],
};

function _notify(): void {
  _listeners.forEach(l => l());
}

function _setState(next: Partial<RemotePeerState>): void {
  _state = { ..._state, ...next };
  _notify();
}

// ─── Öffentliche Mutation-Funktionen ──────────────────────────────────────────

/** Vollständiges State-Update (typischerweise nach snapshot:full). */
export function setRemotePeer(state: Partial<RemotePeerState>): void {
  _setState(state);
}

/** Aktives Pattern des Partners setzen. */
export function setRemoteActivePattern(id: string): void {
  _setState({ activePatternId: id });
}

/** BPM des Partners setzen. */
export function setRemoteBpmPeer(bpm: number): void {
  _setState({ bpm });
}

/** Wiedergabe-Status des Partners setzen. */
export function setRemoteIsPlaying(isPlaying: boolean): void {
  _setState({ isPlaying });
}

/**
 * Einzelnen Step im aktiven Pattern des Partners umschalten.
 * Wird lokal angewendet für sofortiges UI-Feedback, bevor der Partner
 * den neuen Zustand per snapshot:full bestätigt.
 */
export function toggleRemoteStep(partId: string, stepIndex: number): void {
  const pat = _state.patterns.find(p => p.id === _state.activePatternId);
  if (!pat) return;

  const updatedParts = pat.parts.map(part => {
    if (part.id !== partId) return part;
    const newSteps = part.steps.map((s, i) =>
      i === stepIndex ? { ...s, active: !s.active } : s
    );
    return { ...part, steps: newSteps };
  });

  const newPatterns = _state.patterns.map(p =>
    p.id === _state.activePatternId ? { ...p, parts: updatedParts } : p
  );

  _setState({ patterns: newPatterns });
}

/** Mute-Status eines Parts beim Partner setzen. */
export function setRemotePartMuted(partId: string, muted: boolean): void {
  if (!_state.activePatternId) return;
  const newPatterns = _state.patterns.map(p => {
    if (p.id !== _state.activePatternId) return p;
    return {
      ...p,
      parts: p.parts.map(part =>
        part.id === partId ? { ...part, muted } : part
      ),
    };
  });
  _setState({ patterns: newPatterns });
}

/** Volume eines Parts beim Partner setzen. */
export function setRemotePartVolume(partId: string, volume: number): void {
  if (!_state.activePatternId) return;
  const newPatterns = _state.patterns.map(p => {
    if (p.id !== _state.activePatternId) return p;
    return {
      ...p,
      parts: p.parts.map(part =>
        part.id === partId ? { ...part, volume } : part
      ),
    };
  });
  _setState({ patterns: newPatterns });
}

/** Session-Ende: Remote-State vollständig zurücksetzen. */
export function resetRemotePeer(): void {
  _setState({
    userId: null,
    userName: null,
    color: null,
    patterns: [],
    activePatternId: null,
    bpm: 120,
    isPlaying: false,
    samples: [],
  });
}

/** Direkter Lesezugriff ohne React-Subscription (für IPC-Callbacks). */
export function getRemotePeerState(): RemotePeerState {
  return _state;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React-Hook – abonniert den Remote-Peer-Store und löst Re-Renders aus. */
export function useRemotePeerStore(): RemotePeerState {
  const [, forceRender] = useReducer((v: number) => v + 1, 0);

  useEffect(() => {
    _listeners.add(forceRender);
    return () => { _listeners.delete(forceRender); };
  }, []);

  return _state;
}
