/**
 * Synthstudio – useCollabChatStore
 *
 * In-Session Text-Chat für Kollaborations-Sessions.
 * Nachrichten leben nur im Arbeitsspeicher (keine Persistenz).
 * Senden/Empfangen über den bestehenden WebSocket-Kanal (collab-server).
 */
import { useEffect, useReducer } from "react";

export interface ChatMessage {
  id: string;
  senderName: string;
  text: string;
  timestamp: number;
  isOwn: boolean;
}

type Listener = () => void;

let _messages: ChatMessage[] = [];
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

function makeId() { return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

export function addChatMessage(msg: Omit<ChatMessage, "id">): void {
  _messages = [..._messages, { ...msg, id: makeId() }].slice(-200); // max 200 Nachrichten
  notify();
}

export function clearChat(): void {
  _messages = [];
  notify();
}

export function getChatMessages(): ChatMessage[] { return _messages; }

export function useCollabChatStore(): { messages: ChatMessage[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { messages: _messages };
}
