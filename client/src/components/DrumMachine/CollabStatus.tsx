/**
 * CollabStatus.tsx – Session-Status-Badge in der Transport-Bar
 * Phase 7: Collaborative Live Session
 */
import React, { useState } from "react";
import type { Participant } from "@/hooks/useCollaborativeSession";

interface CollabStatusProps {
  sessionCode?: string;
  participants: Participant[];
  isConnecting: boolean;
  onCreateSession: () => void;
  onJoinSession: (code: string, name: string) => void;
  onDisconnect: () => void;
}

export function CollabStatus({
  sessionCode,
  participants,
  isConnecting,
  onCreateSession,
  onJoinSession,
  onDisconnect,
}: CollabStatusProps) {
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const isActive = !!sessionCode;

  return (
    <div className="relative">
      {/* Badge */}
      <button
        onClick={() => !isActive && setShowJoin(prev => !prev)}
        title={isActive ? `Session: ${sessionCode} – ${participants.length} Teilnehmer` : "Collaborative Session starten"}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
          isActive
            ? "bg-green-900 hover:bg-green-800 text-green-300"
            : "bg-slate-800 hover:bg-slate-700 text-slate-400"
        }`}
      >
        <div className={`w-2 h-2 rounded-full ${isActive ? "bg-green-400 animate-pulse" : "bg-slate-600"}`} />
        {isActive ? (
          <span className="font-mono">{sessionCode} ({participants.length})</span>
        ) : (
          <span>Collab</span>
        )}
      </button>

      {/* Session-Aktionen wenn aktiv */}
      {isActive && (
        <button
          onClick={onDisconnect}
          className="ml-1 text-slate-500 hover:text-red-400 text-xs px-1"
          title="Session beenden"
        >
          ×
        </button>
      )}

      {/* Join/Create Popup */}
      {showJoin && !isActive && (
        <div className="absolute bottom-8 left-0 bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl w-56 z-40 text-xs text-white">
          <div className="font-semibold text-cyan-400 mb-2">Collaborative Session</div>
          <button
            onClick={() => { onCreateSession(); setShowJoin(false); }}
            disabled={isConnecting}
            className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 rounded py-1.5 mb-2 font-semibold"
          >
            Neue Session erstellen
          </button>
          <div className="text-slate-500 text-center mb-2">oder</div>
          <input
            type="text"
            placeholder="Code (z.B. AB1234)"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            className="w-full bg-slate-800 rounded px-2 py-1 mb-1 font-mono uppercase text-center tracking-widest"
          />
          <input
            type="text"
            placeholder="Dein Name"
            value={joinName}
            onChange={e => setJoinName(e.target.value)}
            className="w-full bg-slate-800 rounded px-2 py-1 mb-2"
          />
          <button
            onClick={() => {
              if (joinCode.length === 6 && joinName.trim()) {
                onJoinSession(joinCode, joinName.trim());
                setShowJoin(false);
              }
            }}
            disabled={isConnecting || joinCode.length !== 6 || !joinName.trim()}
            className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded py-1.5"
          >
            Beitreten
          </button>
        </div>
      )}
    </div>
  );
}
