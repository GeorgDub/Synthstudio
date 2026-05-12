/**
 * Synthstudio – RelayPanel
 *
 * UI für WAN-Kollaboration über einen öffentlichen Relay-Server.
 * Zeigt Server-URL, Verbindungsstatus, Room-Code, Teilnehmer.
 */
import React, { useState } from "react";
import { useRelayConnection } from "@/hooks/useRelayConnection";

const STATUS_COLOR: Record<string, string> = {
  disconnected: "var(--ss-text-dim)",
  connecting:   "var(--ss-accent-secondary)",
  connected:    "var(--ss-accent-success)",
  error:        "var(--ss-accent-danger)",
};

const STATUS_LABEL: Record<string, string> = {
  disconnected: "Getrennt",
  connecting:   "Verbinde…",
  connected:    "Verbunden",
  error:        "Fehler",
};

interface RelayPanelProps {
  onEvent?: (fromUserId: string, payload: Record<string, unknown>) => void;
  onBroadcast?: (handler: (payload: Record<string, unknown>) => void) => void;
}

export function RelayPanel({ onEvent }: RelayPanelProps) {
  const relay = useRelayConnection(onEvent);
  const [userName, setUserName] = useState(() =>
    localStorage.getItem("ss-relay-username") ?? "Musiker"
  );
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  const saveUserName = (v: string) => {
    setUserName(v);
    try { localStorage.setItem("ss-relay-username", v); } catch { /* ignore */ }
  };

  const handleCopyCode = () => {
    if (!relay.roomCode) return;
    navigator.clipboard.writeText(relay.roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-3 p-3 border border-border-color rounded-lg bg-bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[relay.status] }} />
          <span className="text-xs font-bold text-text-primary">WAN Relay</span>
          <span className="text-[10px] text-text-dim">{STATUS_LABEL[relay.status]}</span>
        </div>
        {relay.status === "connected" && (
          <button
            onClick={relay.disconnect}
            className="text-[10px] text-accent-danger hover:opacity-70"
          >
            Trennen
          </button>
        )}
      </div>

      {relay.error && (
        <div className="text-[10px] text-accent-danger bg-accent-danger/10 rounded px-2 py-1">
          {relay.error}
        </div>
      )}

      {relay.status === "disconnected" || relay.status === "error" ? (
        /* ── Verbindungs-Setup ─────────────────────────────────── */
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-[10px] text-text-dim">Relay-Server URL</label>
            <input
              value={relay.relayUrl}
              onChange={e => relay.setRelayUrl(e.target.value)}
              placeholder="ws://relay.example.com:8080"
              className="w-full bg-bg-elevated border border-border-color rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-text-dim">Dein Name</label>
            <input
              value={userName}
              onChange={e => saveUserName(e.target.value)}
              placeholder="Name…"
              className="w-full bg-bg-elevated border border-border-color rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-primary"
            />
          </div>
          <button
            onClick={() => relay.connect(relay.relayUrl)}
            disabled={!relay.relayUrl}
            className="w-full py-2 rounded bg-accent-primary text-white text-xs font-bold hover:opacity-90 disabled:opacity-40"
          >
            Verbinden
          </button>
        </div>
      ) : relay.status === "connecting" ? (
        <div className="text-[10px] text-text-dim text-center py-2">Verbinde mit Relay…</div>
      ) : !relay.roomCode ? (
        /* ── Session erstellen oder beitreten ──────────────────── */
        <div className="space-y-3">
          <button
            onClick={() => relay.create(userName)}
            className="w-full py-2 rounded bg-accent-success/20 border border-accent-success/40 text-accent-success text-xs font-bold hover:opacity-90"
          >
            + Neuen Room erstellen
          </button>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Room-Code (z.B. ABC123)"
              maxLength={6}
              className="flex-1 bg-bg-elevated border border-border-color rounded px-2 py-1.5 text-xs font-mono text-text-primary outline-none focus:border-accent-primary"
            />
            <button
              onClick={() => relay.join(joinCode, userName)}
              disabled={joinCode.length < 4}
              className="px-3 py-1.5 rounded bg-accent-primary text-white text-xs font-bold hover:opacity-90 disabled:opacity-40"
            >
              Beitreten
            </button>
          </div>
        </div>
      ) : (
        /* ── Aktive Session ────────────────────────────────────── */
        <div className="space-y-3">
          {/* Room-Code */}
          <div className="flex items-center gap-2 bg-bg-elevated rounded px-3 py-2">
            <span className="text-[10px] text-text-dim">Room:</span>
            <span className="font-mono text-sm text-text-primary font-bold tracking-wider flex-1">
              {relay.roomCode}
            </span>
            <button
              onClick={handleCopyCode}
              className="text-[10px] text-accent-secondary hover:opacity-70"
            >
              {copied ? "✓ Kopiert" : "Kopieren"}
            </button>
          </div>

          {/* Teilnehmer */}
          <div className="space-y-1">
            <div className="text-[10px] text-text-dim">{relay.participants.length} Teilnehmer</div>
            {relay.participants.map(p => (
              <div key={p.userId} className="flex items-center gap-2 text-[11px]">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="text-text-primary">{p.userName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[9px] text-text-dim border-t border-border-color pt-2">
        Eigener Relay-Server: <code className="font-mono">npx ts-node server/relay.ts</code>
      </div>
    </div>
  );
}
