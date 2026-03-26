/**
 * collabSession.ts – Browser-seitige Collaborative Session Logik
 * Phase 7: Collaborative Live Session
 *
 * Nutzt BroadcastChannel für Tab-zu-Tab-Synchronisierung (ohne Server).
 * Für echte Netzwerk-Synchronisierung kann dieser Service gegen eine
 * WebSocket-Verbindung (tRPC / Socket.io) ausgetauscht werden.
 */

const MAX_PARTICIPANTS = 8;
const SESSION_CODE_LENGTH = 6;

export interface Participant {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
}

export interface CollabSessionOptions {
  onStateSync?: (delta: Record<string, unknown>) => void;
  onParticipantJoin?: (participant: Participant) => void;
  onParticipantLeave?: (participantId: string) => void;
  onSessionEnd?: () => void;
}

export interface CollabSessionHandle {
  sessionCode: string;
  participants: Participant[];
  isHost: boolean;
  syncState: (delta: Record<string, unknown>) => void;
  disconnect: () => void;
}

function generateSessionCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: SESSION_CODE_LENGTH },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function makeParticipantId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

type SessionMessage =
  | { type: "join"; participant: Participant }
  | { type: "leave"; participantId: string }
  | { type: "state-sync"; delta: Record<string, unknown>; senderId: string }
  | { type: "session-end" }
  | { type: "pong"; participants: Participant[] };

/**
 * Erstellt eine neue Collaborative Session.
 * @returns { sessionCode, handle }
 */
export function createSession(
  hostName: string,
  options: CollabSessionOptions = {}
): { sessionCode: string; handle: CollabSessionHandle } {
  const sessionCode = generateSessionCode();
  const hostId = makeParticipantId();
  const host: Participant = { id: hostId, name: hostName, isHost: true, joinedAt: Date.now() };
  let participants: Participant[] = [host];

  const channel = new BroadcastChannel(`synth-collab-${sessionCode}`);

  channel.onmessage = (event: MessageEvent<SessionMessage>) => {
    const msg = event.data;
    if (msg.type === "join") {
      if (participants.length >= MAX_PARTICIPANTS) return;
      participants = [...participants, msg.participant];
      options.onParticipantJoin?.(msg.participant);
      // Send current participant list to new joiner
      channel.postMessage({ type: "pong", participants } satisfies SessionMessage);
    } else if (msg.type === "leave") {
      participants = participants.filter(p => p.id !== msg.participantId);
      options.onParticipantLeave?.(msg.participantId);
    } else if (msg.type === "state-sync" && msg.senderId !== hostId) {
      options.onStateSync?.(msg.delta);
    }
  };

  const handle: CollabSessionHandle = {
    sessionCode,
    get participants() { return participants; },
    isHost: true,
    syncState(delta) {
      channel.postMessage({ type: "state-sync", delta, senderId: hostId } satisfies SessionMessage);
    },
    disconnect() {
      channel.postMessage({ type: "session-end" } satisfies SessionMessage);
      options.onSessionEnd?.();
      channel.close();
    },
  };

  return { sessionCode, handle };
}

/**
 * Tritt einer bestehenden Session bei.
 * @throws Error wenn Session nicht gefunden oder voll
 */
export async function joinSession(
  code: string,
  userName: string,
  options: CollabSessionOptions = {},
  timeoutMs = 3000
): Promise<CollabSessionHandle> {
  if (!code || code.length !== SESSION_CODE_LENGTH) {
    throw new Error(`Ungültiger Session-Code: ${code}`);
  }

  const participantId = makeParticipantId();
  const me: Participant = { id: participantId, name: userName, isHost: false, joinedAt: Date.now() };
  let participants: Participant[] = [];

  const channel = new BroadcastChannel(`synth-collab-${code}`);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.close();
      reject(new Error(`Session ${code} nicht gefunden (Timeout)`));
    }, timeoutMs);

    channel.onmessage = (event: MessageEvent<SessionMessage>) => {
      const msg = event.data;
      if (msg.type === "pong") {
        clearTimeout(timer);
        participants = msg.participants;
        const handle: CollabSessionHandle = {
          sessionCode: code,
          get participants() { return participants; },
          isHost: false,
          syncState(delta) {
            channel.postMessage({ type: "state-sync", delta, senderId: participantId } satisfies SessionMessage);
          },
          disconnect() {
            channel.postMessage({ type: "leave", participantId } satisfies SessionMessage);
            options.onSessionEnd?.();
            channel.close();
          },
        };
        resolve(handle);
      } else if (msg.type === "state-sync" && msg.senderId !== participantId) {
        options.onStateSync?.(msg.delta);
      } else if (msg.type === "session-end") {
        options.onSessionEnd?.();
        channel.close();
      } else if (msg.type === "leave") {
        participants = participants.filter(p => p.id !== msg.participantId);
        options.onParticipantLeave?.(msg.participantId);
      }
    };

    channel.postMessage({ type: "join", participant: me } satisfies SessionMessage);
  });
}
