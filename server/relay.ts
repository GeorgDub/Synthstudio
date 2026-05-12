/**
 * Synthstudio – Public Relay Server
 *
 * Eigenständiger WebSocket-Relay für WAN-Kollaboration (kein LAN erforderlich).
 * Verwendet dasselbe Protokoll wie electron/collab-server.ts.
 *
 * Deployment:
 *   PORT=8080 npx ts-node server/relay.ts
 *   oder via Docker / Railway / Fly.io
 *
 * Protokoll: identisch mit collab-server.ts
 *
 * Zusätzlich:
 *   { type: "relay:list" } → { type: "relay:rooms", rooms: string[] }
 */

import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const PING_INTERVAL = 20_000;
const ROOM_TIMEOUT_MS = 3_600_000; // 1 Stunde

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Participant {
  userId: string;
  userName: string;
  color: string;
  joinedAt: number;
  ws: WebSocket;
}

interface Room {
  code: string;
  participants: Map<string, Participant>;
  snapshot: Record<string, unknown>;
  createdAt: number;
  lastActivity: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const rooms = new Map<string, Room>();

function makeRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? makeRoomCode() : code;
}

function color(userId: string) {
  const colors = ["#f59e0b", "#06b6d4", "#10b981", "#f43f5e", "#a855f7", "#ff6b35", "#0ea5e9", "#84cc16"];
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % colors.length;
  return colors[h];
}

function broadcast(room: Room, payload: unknown, exclude?: WebSocket) {
  const msg = JSON.stringify(payload);
  room.participants.forEach(p => {
    if (p.ws !== exclude && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

function participantList(room: Room) {
  return [...room.participants.values()].map(({ userId, userName, color, joinedAt }) => ({
    userId, userName, color, joinedAt,
  }));
}

// ─── Cleanup abgelaufener Rooms ───────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    if (room.participants.size === 0 && now - room.lastActivity > ROOM_TIMEOUT_MS) {
      rooms.delete(code);
    }
  });
}, 60_000);

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`Synthstudio Relay Server – ${rooms.size} aktive Rooms\n`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  let currentRoom: Room | null = null;
  let currentUserId: string | null = null;

  const send = (data: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  // Ping-Pong zum Alive-Halten der Verbindung
  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, PING_INTERVAL);

  ws.on("message", (raw: Buffer) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const type = msg.type as string;

    if (type === "ping") {
      send({ type: "pong" });
      return;
    }

    if (type === "relay:list") {
      send({ type: "relay:rooms", rooms: [...rooms.keys()] });
      return;
    }

    if (type === "create") {
      const roomCode = (msg.roomCode as string | undefined) ?? makeRoomCode();
      const userId = msg.userId as string;
      const userName = (msg.userName as string | undefined) ?? "Host";

      const room: Room = {
        code: roomCode,
        participants: new Map(),
        snapshot: (msg.snapshot as Record<string, unknown> | undefined) ?? { bpm: 120, isPlaying: false },
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      const participant: Participant = {
        userId, userName,
        color: color(userId),
        joinedAt: Date.now(),
        ws,
      };

      room.participants.set(userId, participant);
      rooms.set(roomCode, room);
      currentRoom = room;
      currentUserId = userId;

      send({ type: "created", roomCode, snapshot: room.snapshot });
      console.log(`[Relay] Room ${roomCode} erstellt von ${userName}`);
      return;
    }

    if (type === "join") {
      const roomCode = msg.roomCode as string;
      const userId = msg.userId as string;
      const userName = (msg.userName as string | undefined) ?? "Gast";

      const room = rooms.get(roomCode);
      if (!room) {
        send({ type: "error", message: `Room '${roomCode}' nicht gefunden.` });
        return;
      }

      const participant: Participant = {
        userId, userName,
        color: color(userId),
        joinedAt: Date.now(),
        ws,
      };

      room.participants.set(userId, participant);
      room.lastActivity = Date.now();
      currentRoom = room;
      currentUserId = userId;

      send({ type: "joined", roomCode, participants: participantList(room), snapshot: room.snapshot });
      broadcast(room, { type: "participant_joined", participant: { userId, userName, color: color(userId), joinedAt: participant.joinedAt } }, ws);
      console.log(`[Relay] ${userName} joined ${roomCode}`);
      return;
    }

    if (type === "event" && currentRoom) {
      const payload = msg.payload;
      currentRoom.lastActivity = Date.now();
      // Snapshot aktualisieren
      if (payload && typeof payload === "object") {
        const p = payload as Record<string, unknown>;
        if (p.type === "bpm:change" && p.bpm) currentRoom.snapshot.bpm = p.bpm;
        if (p.type === "transport:play") currentRoom.snapshot.isPlaying = true;
        if (p.type === "transport:stop") currentRoom.snapshot.isPlaying = false;
      }
      broadcast(currentRoom, { type: "event", fromUserId: currentUserId, payload }, ws);
      return;
    }
  });

  ws.on("close", () => {
    clearInterval(ping);
    if (currentRoom && currentUserId) {
      currentRoom.participants.delete(currentUserId);
      currentRoom.lastActivity = Date.now();
      broadcast(currentRoom, { type: "participant_left", userId: currentUserId });
      console.log(`[Relay] ${currentUserId} left ${currentRoom.code}`);
    }
  });

  ws.on("error", () => ws.terminate());
});

server.listen(PORT, () => {
  console.log(`[Relay] Synthstudio Relay Server läuft auf Port ${PORT}`);
});
