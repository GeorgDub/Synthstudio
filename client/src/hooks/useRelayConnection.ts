/**
 * Synthstudio – useRelayConnection
 *
 * Verbindet sich mit einem öffentlichen Relay-Server für WAN-Kollaboration.
 * Dasselbe Protokoll wie der LAN-Server (useCollabSession), aber remote.
 *
 * Verwendet CustomEvents um mit dem bestehenden CollabSession-System
 * kompatibel zu bleiben.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type RelayStatus = "disconnected" | "connecting" | "connected" | "error";

export interface RelayParticipant {
  userId: string;
  userName: string;
  color: string;
  joinedAt: number;
}

export interface RelayState {
  status: RelayStatus;
  roomCode: string | null;
  participants: RelayParticipant[];
  relayUrl: string;
  error: string | null;
}

export interface RelayActions {
  connect: (url: string) => void;
  create: (userName: string, snapshot?: Record<string, unknown>) => void;
  join: (roomCode: string, userName: string) => void;
  broadcast: (payload: Record<string, unknown>) => void;
  disconnect: () => void;
  setRelayUrl: (url: string) => void;
}

const STORAGE_KEY = "ss-relay-url";

const DEFAULT_URL = "ws://localhost:8080";

function loadUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL;
  } catch { return DEFAULT_URL; }
}

function makeUserId() {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

export function useRelayConnection(
  onEvent?: (fromUserId: string, payload: Record<string, unknown>) => void,
): RelayState & RelayActions {
  const [status, setStatus] = useState<RelayStatus>("disconnected");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RelayParticipant[]>([]);
  const [relayUrl, setRelayUrlState] = useState<string>(() => loadUrl());
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const userIdRef = useRef<string>(makeUserId());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
    setRoomCode(null);
    setParticipants([]);
    setError(null);
  }, []);

  const connect = useCallback((url: string) => {
    disconnect();
    setStatus("connecting");
    setError(null);
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connected");

      ws.onmessage = (e) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(e.data as string); } catch { return; }
        const type = msg.type as string;

        if (type === "created" || type === "joined") {
          setRoomCode(msg.roomCode as string);
          if (msg.participants) setParticipants(msg.participants as RelayParticipant[]);
        }
        if (type === "participant_joined") {
          setParticipants(prev => {
            const p = msg.participant as RelayParticipant;
            return [...prev.filter(x => x.userId !== p.userId), p];
          });
        }
        if (type === "participant_left") {
          setParticipants(prev => prev.filter(p => p.userId !== (msg.userId as string)));
        }
        if (type === "event") {
          onEventRef.current?.(msg.fromUserId as string, msg.payload as Record<string, unknown>);
          // Kompatibilität mit dem bestehenden Collab-System via CustomEvent
          window.dispatchEvent(new CustomEvent("collab:event", { detail: msg.payload }));
        }
        if (type === "error") {
          setError(msg.message as string);
          setStatus("error");
        }
        if (type === "pong") { /* alive */ }
      };

      ws.onerror = () => {
        setStatus("error");
        setError("Verbindung zum Relay-Server fehlgeschlagen.");
      };

      ws.onclose = () => {
        if (status !== "error") setStatus("disconnected");
        setRoomCode(null);
        setParticipants([]);
      };
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }, [disconnect, status]);

  const create = useCallback((userName: string, snapshot?: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "create",
      userId: userIdRef.current,
      userName,
      snapshot: snapshot ?? { bpm: 120, isPlaying: false },
    }));
  }, []);

  const join = useCallback((code: string, userName: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "join",
      roomCode: code.toUpperCase(),
      userId: userIdRef.current,
      userName,
    }));
  }, []);

  const broadcast = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !roomCode) return;
    ws.send(JSON.stringify({ type: "event", roomCode, payload }));
  }, [roomCode]);

  const setRelayUrl = useCallback((url: string) => {
    setRelayUrlState(url);
    try { localStorage.setItem(STORAGE_KEY, url); } catch { /* ignore */ }
  }, []);

  // Ping alle 15s um Verbindung zu halten
  useEffect(() => {
    const id = setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  // Cleanup
  useEffect(() => () => { wsRef.current?.close(); }, []);

  return {
    status, roomCode, participants, relayUrl, error,
    connect, create, join, broadcast, disconnect, setRelayUrl,
  };
}
