/**
 * Synthstudio – CollabChat
 *
 * Echtzeit Text-Chat für LAN-Kollaborations-Sessions.
 * Nachrichten werden über den WebSocket-Kanal als JSON-Events übertragen:
 *   { type: "chat", sender: "...", text: "..." }
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useCollabChatStore, addChatMessage } from "@/store/useCollabChatStore";

interface CollabChatProps {
  /** Broadcast-Funktion aus useCollabSession */
  broadcast: (msg: import("../../../../electron/collab-server").CollabEvent) => void;
  /** Eigener Anzeigename */
  ownName?: string;
  /** Session ist aktiv */
  inSession: boolean;
}

export function CollabChat({ broadcast, ownName = "Ich", inSession }: CollabChatProps) {
  const { messages } = useCollabChatStore();
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(messages.length);

  // Unread-Counter wenn Chat geschlossen
  useEffect(() => {
    const newCount = messages.length - prevLenRef.current;
    if (newCount > 0 && !isOpen) setUnread(prev => prev + newCount);
    prevLenRef.current = messages.length;
  }, [messages.length, isOpen]);

  // Auto-Scroll
  useEffect(() => {
    if (isOpen && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // Chat öffnen → unread zurücksetzen
  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setUnread(0);
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !inSession) return;
    // Eigene Nachricht lokal hinzufügen
    addChatMessage({ senderName: ownName, text, timestamp: Date.now(), isOwn: true });
    // An Partner senden
    broadcast({ type: "chat" as const, sender: ownName, text });
    setInput("");
  }, [input, ownName, broadcast, inSession]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape") setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Toggle Button */}
      <button
        onClick={isOpen ? () => setIsOpen(false) : handleOpen}
        className={[
          "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
          isOpen
            ? "bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/40"
            : "bg-bg-elevated text-text-muted hover:text-accent-secondary border border-border-color",
        ].join(" ")}
        title="Chat öffnen"
      >
        💬 Chat
        {unread > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-accent-danger text-white">
            {unread}
          </span>
        )}
      </button>

      {/* Chat-Panel */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 right-0 w-72 rounded-xl border border-border-color bg-bg-panel shadow-2xl flex flex-col overflow-hidden z-50" style={{ height: 320 }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-color bg-bg-elevated flex-shrink-0">
            <span className="text-xs font-bold text-text-primary">Chat</span>
            {!inSession && <span className="text-[10px] text-accent-danger">Keine aktive Session</span>}
            <button
              onClick={() => setIsOpen(false)}
              className="text-text-muted hover:text-text-primary p-1 rounded flex items-center justify-center transition-colors"
              aria-label="Close"
              title="Schließen"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Nachrichten */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {messages.length === 0 ? (
              <p className="text-[10px] text-text-dim text-center mt-4">
                Noch keine Nachrichten.{inSession ? " Schreib etwas!" : " Session starten um zu chatten."}
              </p>
            ) : messages.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.isOwn ? "items-end" : "items-start"}`}>
                <div className={[
                  "max-w-[85%] px-2 py-1.5 rounded-lg text-xs leading-snug",
                  msg.isOwn
                    ? "bg-accent-primary/20 text-text-primary rounded-br-sm"
                    : "bg-bg-elevated text-text-primary rounded-bl-sm",
                ].join(" ")}>
                  {!msg.isOwn && (
                    <div className="text-[9px] text-accent-secondary font-semibold mb-0.5">{msg.senderName}</div>
                  )}
                  {msg.text}
                </div>
                <span className="text-[9px] text-text-dim mt-0.5">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-1.5 px-2 py-2 border-t border-border-color flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inSession ? "Nachricht schreiben…" : "Keine Session aktiv"}
              disabled={!inSession}
              className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary placeholder:text-text-dim disabled:opacity-40"
              maxLength={500}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !inSession}
              className="px-2 py-1 text-xs rounded bg-accent-secondary text-white hover:opacity-80 disabled:opacity-30 transition-opacity"
            >
              ↑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
