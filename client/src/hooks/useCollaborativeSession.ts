/**
 * useCollaborativeSession.ts – React-Hook für Collaborative Session
 * Phase 7: Collaborative Live Session
 */
import { useState, useCallback, useRef } from "react";
import { createSession, joinSession } from "../utils/collabSession";
import type { CollabSessionHandle, Participant } from "../utils/collabSession";

export type { Participant };

export interface CollabSessionState {
  session: CollabSessionHandle | null;
  participants: Participant[];
  isConnecting: boolean;
  error: string | null;
}

export interface CollabSessionActions {
  createSession: (hostName: string, onSync?: (delta: Record<string, unknown>) => void) => Promise<string>;
  joinSession: (code: string, userName: string, onSync?: (delta: Record<string, unknown>) => void) => Promise<void>;
  disconnect: () => void;
  syncState: (delta: Record<string, unknown>) => void;
}

export function useCollaborativeSession(): CollabSessionState & CollabSessionActions {
  const [session, setSession] = useState<CollabSessionHandle | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<CollabSessionHandle | null>(null);

  const handleCreate = useCallback(async (
    hostName: string,
    onSync?: (delta: Record<string, unknown>) => void
  ): Promise<string> => {
    setIsConnecting(true);
    setError(null);
    try {
      const { sessionCode, handle } = createSession(hostName, {
        onStateSync: onSync,
        onParticipantJoin: p => setParticipants(prev => [...prev, p]),
        onParticipantLeave: id => setParticipants(prev => prev.filter(p => p.id !== id)),
        onSessionEnd: () => { setSession(null); handleRef.current = null; },
      });
      handleRef.current = handle;
      setSession(handle);
      setParticipants(handle.participants);
      return sessionCode;
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleJoin = useCallback(async (
    code: string,
    userName: string,
    onSync?: (delta: Record<string, unknown>) => void
  ): Promise<void> => {
    setIsConnecting(true);
    setError(null);
    try {
      const handle = await joinSession(code, userName, {
        onStateSync: onSync,
        onParticipantJoin: p => setParticipants(prev => [...prev, p]),
        onParticipantLeave: id => setParticipants(prev => prev.filter(p => p.id !== id)),
        onSessionEnd: () => { setSession(null); handleRef.current = null; },
      });
      handleRef.current = handle;
      setSession(handle);
      setParticipants(handle.participants);
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    handleRef.current?.disconnect();
    handleRef.current = null;
    setSession(null);
    setParticipants([]);
  }, []);

  const syncState = useCallback((delta: Record<string, unknown>) => {
    handleRef.current?.syncState(delta);
  }, []);

  return {
    session,
    participants,
    isConnecting,
    error,
    createSession: handleCreate,
    joinSession: handleJoin,
    disconnect,
    syncState,
  };
}
