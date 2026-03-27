/**
 * Synthstudio – useCollabSession.ts (v1.10)
 *
 * React-Hook für die WebSocket-Kollaborationssession.
 * Verwaltet den Verbindungslebenszyklus und dispatched eingehende Events
 * an die entsprechenden Stores (DrumMachine usw.).
 *
 * Verwendung:
 *   const collab = useCollabSession();
 *   collab.createSession("MeinName");   // als Host
 *   collab.joinSession("A3F7KL", "192.168.1.100", 4242, "MeinName");
 *   collab.broadcast({ type: "step:toggle", partId, stepIndex });
 *   collab.leaveSession();
 */

import { useCallback, useEffect, useRef } from "react";
import type { CollabEvent } from "../../../electron/collab-server";
import {
  setSessionStatus,
  setSessionCode,
  setWsUrl,
  setParticipants,
  addParticipant,
  removeParticipant,
  setSessionError,
  setRemoteBpm,
  resetSession,
  getSessionState,
} from "../store/useSessionStore";

// ─── Singleton-WebSocket-Referenz ─────────────────────────────────────────────

let _ws: WebSocket | null = null;

function closeSocket(): void {
  if (_ws) {
    _ws.onclose = null;
    _ws.onerror = null;
    _ws.onmessage = null;
    _ws.close();
    _ws = null;
  }
}

// ─── Externe Event-Handler (für DrumMachine-Integration) ─────────────────────

type CollabEventHandler = (event: CollabEvent, fromUserId: string) => void;
const _eventHandlers = new Set<CollabEventHandler>();

/** Registriert einen globalen Handler für eingehende Collab-Events. */
export function addCollabEventHandler(handler: CollabEventHandler): () => void {
  _eventHandlers.add(handler);
  return () => _eventHandlers.delete(handler);
}

function dispatchEvent(event: CollabEvent, fromUserId: string): void {
  _eventHandlers.forEach((h) => h(event, fromUserId));
}

// ─── Verbindungs-Helfer ────────────────────────────────────────────────────────

function openSocket(
  url: string,
  roomCode: string,
  userId: string,
  userName: string,
  mode: "create" | "join",
  snapshot?: { bpm: number; isPlaying: boolean }
): void {
  closeSocket();
  setSessionStatus("connecting");
  setWsUrl(url);

  const ws = new WebSocket(url);
  _ws = ws;

  ws.onopen = () => {
    const msg =
      mode === "create"
        ? { type: "create", roomCode, userId, userName, snapshot: snapshot ?? { bpm: 120, isPlaying: false } }
        : { type: "join", roomCode, userId, userName };
    ws.send(JSON.stringify(msg));
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string);
      handleServerMessage(data, mode);
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onerror = () => {
    setSessionError("Verbindungsfehler zum Kollaborationsserver");
  };

  ws.onclose = () => {
    const s = getSessionState();
    if (s.status === "hosting" || s.status === "joined") {
      setSessionError("Verbindung getrennt");
    }
  };
}

function handleServerMessage(data: Record<string, unknown>, _mode: "create" | "join"): void {
  switch (data.type) {
    case "created":
      setSessionCode(data.roomCode as string);
      setSessionStatus("hosting");
      setSessionError(null);
      break;

    case "joined":
      setSessionCode(data.roomCode as string);
      setParticipants((data.participants as typeof import("../store/useSessionStore").SessionParticipant[]) ?? []);
      setSessionStatus("joined");
      setSessionError(null);
      if ((data.snapshot as Record<string, unknown>)?.bpm) {
        setRemoteBpm((data.snapshot as Record<string, unknown>).bpm as number);
      }
      break;

    case "participant_joined":
      if (data.participant) {
        addParticipant(data.participant as import("../store/useSessionStore").SessionParticipant);
      }
      break;

    case "participant_left":
      if (typeof data.userId === "string") {
        removeParticipant(data.userId);
      }
      break;

    case "event":
      dispatchEvent(
        data.payload as CollabEvent,
        (data.fromUserId as string) ?? "unknown"
      );
      break;

    case "error":
      setSessionError((data.message as string) ?? "Unbekannter Fehler");
      break;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCollabSession() {
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ping-Keepalive alle 20 Sekunden
  useEffect(() => {
    pingIntervalRef.current = setInterval(() => {
      if (_ws?.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20_000);

    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, []);

  /** Session als Host starten (Electron: Server intern starten, dann verbinden) */
  const createSession = useCallback(async (userName?: string) => {
    const state = getSessionState();
    const resolvedName = userName ?? state.myUserName;
    const { myUserId } = state;

    try {
      // In Electron: Server starten und Port ermitteln
      const api = (window as Window & { electronAPI?: { startCollabServer?: () => Promise<{ success: boolean; port?: number; error?: string }>; getCollabAddress?: () => Promise<{ ip: string; port: number; running: boolean }> } }).electronAPI;
      if (api?.startCollabServer) {
        const result = await api.startCollabServer();
        if (!result.success) {
          setSessionError(result.error ?? "Server konnte nicht gestartet werden");
          return;
        }
        const addr = await api.getCollabAddress!();
        const wsUrl = `ws://127.0.0.1:${addr.port}`;
        openSocket(wsUrl, "", myUserId, resolvedName, "create");
      } else {
        // Browser-Fallback: öffentlicher Relay (nicht in dieser Version verfügbar)
        setSessionError("Kollaboration ist nur in der Desktop-App verfügbar");
      }
    } catch (err) {
      setSessionError(String(err));
    }
  }, []);

  /** Session als Gast beitreten */
  const joinSession = useCallback((
    roomCode: string,
    hostIp: string,
    port: number,
    userName?: string
  ) => {
    const state = getSessionState();
    const resolvedName = userName ?? state.myUserName;
    const { myUserId } = state;

    const sanitizedCode = roomCode.toUpperCase().trim();
    if (sanitizedCode.length < 4) {
      setSessionError("Ungültiger Session-Code");
      return;
    }

    const wsUrl = `ws://${hostIp}:${port}`;
    openSocket(wsUrl, sanitizedCode, myUserId, resolvedName, "join");
  }, []);

  /** Sendet ein Collab-Event an alle anderen Teilnehmer */
  const broadcast = useCallback((event: CollabEvent) => {
    const state = getSessionState();
    if (!_ws || _ws.readyState !== WebSocket.OPEN || !state.sessionCode) return;
    _ws.send(JSON.stringify({ type: "event", roomCode: state.sessionCode, payload: event }));
  }, []);

  /** Session verlassen und Server stoppen (falls Host) */
  const leaveSession = useCallback(async () => {
    closeSocket();
    const api = (window as Window & { electronAPI?: { stopCollabServer?: () => Promise<{ success: boolean }> } }).electronAPI;
    if (api?.stopCollabServer) {
      await api.stopCollabServer();
    }
    resetSession();
  }, []);

  return { createSession, joinSession, broadcast, leaveSession };
}
