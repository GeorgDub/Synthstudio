/**
 * Synthstudio – useSessionStore.ts (v1.10)
 *
 * Singleton-Store für den Kollaborations-Session-Zustand.
 * Verwaltet: Verbindungsstatus, Teilnehmer-Liste, eigene Identität,
 * WebSocket-Referenz und die zuletzt empfangenen Events.
 *
 * Muster: Modul-Singleton (kein Zustand-Manager, identisch mit v1.9-Stores).
 */

import { useEffect, useReducer } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface SessionParticipant {
  userId: string;
  userName: string;
  color: string;
  joinedAt: number;
}

export type SessionStatus = "idle" | "connecting" | "hosting" | "joined" | "error";

export interface SessionState {
  status: SessionStatus;
  sessionCode: string | null;
  wsUrl: string | null;
  participants: SessionParticipant[];
  myUserId: string;
  myUserName: string;
  errorMessage: string | null;
  /** BPM wie vom Server kommuniziert (für Sync) */
  remoteBpm: number | null;
}

// ─── Singleton-State ──────────────────────────────────────────────────────────

type Listener = () => void;

/** Generiert eine stabile Benutzer-ID für diese Sitzung (in sessionStorage) */
function getOrCreateUserId(): string {
  const key = "ss-collab-userId";
  const stored = sessionStorage.getItem(key);
  if (stored) return stored;
  const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  sessionStorage.setItem(key, id);
  return id;
}

function getOrCreateUserName(): string {
  const key = "ss-collab-userName";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const names = ["Kick", "Snare", "Hat", "Clap", "Bass", "Synth", "Perc", "FX"];
  const name = `Beat${names[Math.floor(Math.random() * names.length)]}${Math.floor(Math.random() * 99) + 1}`;
  localStorage.setItem(key, name);
  return name;
}

const _defaultState: SessionState = {
  status: "idle",
  sessionCode: null,
  wsUrl: null,
  participants: [],
  myUserId: typeof window !== "undefined" ? getOrCreateUserId() : "test-user",
  myUserName: typeof window !== "undefined" ? getOrCreateUserName() : "TestUser",
  errorMessage: null,
  remoteBpm: null,
};

let _state: SessionState = { ..._defaultState };
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach((l) => l());
}

// ─── Aktionen ─────────────────────────────────────────────────────────────────

export function setSessionStatus(status: SessionStatus): void {
  _state = { ..._state, status };
  notify();
}

export function setSessionCode(code: string | null): void {
  _state = { ..._state, sessionCode: code };
  notify();
}

export function setWsUrl(url: string | null): void {
  _state = { ..._state, wsUrl: url };
  notify();
}

export function setParticipants(participants: SessionParticipant[]): void {
  _state = { ..._state, participants };
  notify();
}

export function addParticipant(p: SessionParticipant): void {
  if (_state.participants.some((x) => x.userId === p.userId)) return;
  _state = { ..._state, participants: [..._state.participants, p] };
  notify();
}

export function removeParticipant(userId: string): void {
  _state = {
    ..._state,
    participants: _state.participants.filter((p) => p.userId !== userId),
  };
  notify();
}

export function setSessionError(msg: string | null): void {
  _state = { ..._state, errorMessage: msg, status: msg ? "error" : _state.status };
  notify();
}

export function setRemoteBpm(bpm: number): void {
  _state = { ..._state, remoteBpm: bpm };
  notify();
}

export function setMyUserName(name: string): void {
  const sanitized = name.trim().slice(0, 32) || "Beatmaker";
  localStorage.setItem("ss-collab-userName", sanitized);
  _state = { ..._state, myUserName: sanitized };
  notify();
}

export function resetSession(): void {
  _state = {
    ..._defaultState,
    myUserId: _state.myUserId,
    myUserName: _state.myUserName,
  };
  notify();
}

export function getSessionState(): SessionState {
  return _state;
}

/** Nur für Tests */
export function __resetSessionForTests(): void {
  _state = {
    ..._defaultState,
    myUserId: "test-user",
    myUserName: "TestUser",
  };
  _listeners.clear();
}

// ─── React-Hook ───────────────────────────────────────────────────────────────

export function useSessionStore(): SessionState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
