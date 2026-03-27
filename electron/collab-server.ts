/**
 * Synthstudio – Collaboration Server (electron/collab-server.ts)
 *
 * WebSocket-basierter Raum-Server für Live-Kollaborationssessions.
 * Läuft im Electron-Main-Prozess auf einem konfigurierbaren lokalen Port.
 *
 * Protokoll (alle Nachrichten als JSON):
 *
 * Client → Server:
 *   { type: "create", roomCode?: string, userId: string, userName: string, snapshot?: RoomSnapshot }
 *   { type: "join",   roomCode: string, userId: string, userName: string }
 *   { type: "event",  roomCode: string, payload: CollabEvent }
 *   { type: "ping" }
 *
 * Server → Client:
 *   { type: "created",           roomCode: string, snapshot: RoomSnapshot }
 *   { type: "joined",            roomCode: string, participants: Participant[], snapshot: RoomSnapshot }
 *   { type: "participant_joined",participant: Participant }
 *   { type: "participant_left",  userId: string }
 *   { type: "event",             fromUserId: string, payload: CollabEvent }
 *   { type: "error",             message: string }
 *   { type: "pong" }
 */

import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { networkInterfaces } from "os";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface Participant {
  userId: string;
  userName: string;
  color: string;
  joinedAt: number;
}

/** Minimaler Snapshot des Raum-Zustands, den neue Teilnehmer beim Beitritt erhalten */
export interface RoomSnapshot {
  bpm: number;
  activePatternId?: string;
  isPlaying: boolean;
}

export type CollabEventType =
  | "step:toggle"
  | "bpm:change"
  | "pattern:switch"
  | "transport:play"
  | "transport:stop"
  | "part:mute"
  | "part:solo"
  | "part:volume"
  | "snapshot:full";

export interface CollabEvent {
  type: CollabEventType;
  [key: string]: unknown;
}

// ─── Interner Raum-Typ ────────────────────────────────────────────────────────

const PARTICIPANT_COLORS = [
  "#7c3aed", "#2563eb", "#059669", "#d97706",
  "#dc2626", "#db2777", "#0891b2", "#65a30d",
];

interface Room {
  code: string;
  participants: Map<string, Participant>;
  sockets: Map<string, WebSocket>;
  snapshot: RoomSnapshot;
  createdAt: number;
}

// ─── Server-State ─────────────────────────────────────────────────────────────

let _server: http.Server | null = null;
let _wss: WebSocketServer | null = null;
let _port = 0;
const _rooms = new Map<string, Room>();

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** Zufälliger 6-stelliger Raum-Code (Großbuchstaben + Ziffern, ohne I/O/0/1) */
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Lokale IPv4-Adresse des Hauptnetzwerk-Interfaces */
export function getLocalIp(): string {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room: Room, msg: object, excludeUserId?: string): void {
  for (const [uid, ws] of room.sockets) {
    if (uid !== excludeUserId) send(ws, msg);
  }
}

function nextColor(room: Room): string {
  return PARTICIPANT_COLORS[room.participants.size % PARTICIPANT_COLORS.length];
}

/** Entfernt abgelaufene leere Räume (> 30 min alt, keine Teilnehmer). */
function cleanupRooms(): void {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [code, room] of _rooms) {
    if (room.participants.size === 0 && room.createdAt < cutoff) {
      _rooms.delete(code);
    }
  }
}

// ─── Nachrichten-Handler ──────────────────────────────────────────────────────

function handleCreate(
  ws: WebSocket,
  data: { roomCode?: string; userId: string; userName: string; snapshot?: RoomSnapshot }
): void {
  // Sicherheitsvalidierung: userId und userName dürfen nicht leer sein
  if (!data.userId || !data.userName || data.userId.length > 64 || data.userName.length > 64) {
    send(ws, { type: "error", message: "Ungültige Benutzer-ID oder Name" });
    return;
  }

  let code = data.roomCode?.toUpperCase().trim() ?? "";
  // Neuen Code generieren wenn nicht angegeben oder bereits vergeben
  if (!code || _rooms.has(code)) {
    code = generateRoomCode();
    while (_rooms.has(code)) code = generateRoomCode();
  }

  const snapshot: RoomSnapshot = data.snapshot ?? { bpm: 120, isPlaying: false };
  const participant: Participant = {
    userId: data.userId,
    userName: data.userName,
    color: PARTICIPANT_COLORS[0],
    joinedAt: Date.now(),
  };

  const room: Room = {
    code,
    participants: new Map([[data.userId, participant]]),
    sockets: new Map([[data.userId, ws]]),
    snapshot,
    createdAt: Date.now(),
  };
  _rooms.set(code, room);

  (ws as WebSocket & { _roomCode?: string; _userId?: string })._roomCode = code;
  (ws as WebSocket & { _roomCode?: string; _userId?: string })._userId = data.userId;

  send(ws, { type: "created", roomCode: code, snapshot });
}

function handleJoin(
  ws: WebSocket,
  data: { roomCode: string; userId: string; userName: string }
): void {
  if (!data.userId || !data.userName || data.userId.length > 64 || data.userName.length > 64) {
    send(ws, { type: "error", message: "Ungültige Benutzer-ID oder Name" });
    return;
  }

  const code = data.roomCode?.toUpperCase().trim();
  const room = _rooms.get(code);
  if (!room) {
    send(ws, { type: "error", message: `Raum "${code}" nicht gefunden` });
    return;
  }
  if (room.participants.size >= 8) {
    send(ws, { type: "error", message: "Raum ist voll (max. 8 Teilnehmer)" });
    return;
  }

  const participant: Participant = {
    userId: data.userId,
    userName: data.userName,
    color: nextColor(room),
    joinedAt: Date.now(),
  };
  room.participants.set(data.userId, participant);
  room.sockets.set(data.userId, ws);

  (ws as WebSocket & { _roomCode?: string; _userId?: string })._roomCode = code;
  (ws as WebSocket & { _roomCode?: string; _userId?: string })._userId = data.userId;

  // Neuen Teilnehmer über Raum-Zustand informieren
  send(ws, {
    type: "joined",
    roomCode: code,
    participants: [...room.participants.values()],
    snapshot: room.snapshot,
  });

  // Anderen Teilnehmern mitteilen
  broadcast(room, { type: "participant_joined", participant }, data.userId);
}

function handleEvent(
  ws: WebSocket,
  data: { roomCode: string; payload: CollabEvent }
): void {
  const code = data.roomCode?.toUpperCase().trim();
  const room = _rooms.get(code);
  if (!room) return;

  const wsTagged = ws as WebSocket & { _userId?: string };
  const fromUserId = wsTagged._userId ?? "unknown";

  // Snapshot bei relevanten Events aktualisieren
  const p = data.payload;
  if (p.type === "bpm:change" && typeof p.bpm === "number") {
    room.snapshot.bpm = p.bpm;
  } else if (p.type === "pattern:switch" && typeof p.patternId === "string") {
    room.snapshot.activePatternId = p.patternId;
  } else if (p.type === "transport:play") {
    room.snapshot.isPlaying = true;
  } else if (p.type === "transport:stop") {
    room.snapshot.isPlaying = false;
  }

  // An alle anderen Teilnehmer weiterleiten
  broadcast(room, { type: "event", fromUserId, payload: data.payload }, fromUserId);
}

function handleDisconnect(ws: WebSocket): void {
  const tagged = ws as WebSocket & { _roomCode?: string; _userId?: string };
  const { _roomCode: code, _userId: userId } = tagged;
  if (!code || !userId) return;

  const room = _rooms.get(code);
  if (!room) return;

  room.participants.delete(userId);
  room.sockets.delete(userId);

  broadcast(room, { type: "participant_left", userId });
}

// ─── Server-Lifecycle ─────────────────────────────────────────────────────────

/**
 * Startet den WebSocket-Kollaborationsserver.
 * @param port Gewünschter Port (0 = Betriebssystem wählt freien Port)
 * @returns Tatsächlich verwendeter Port
 */
export function startCollabServer(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    if (_wss) {
      resolve(_port);
      return;
    }

    _server = http.createServer();
    _wss = new WebSocketServer({ server: _server });

    _wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const data = JSON.parse(String(raw));
          if (!data || typeof data.type !== "string") return;

          switch (data.type) {
            case "create": handleCreate(ws, data); break;
            case "join":   handleJoin(ws, data);   break;
            case "event":  handleEvent(ws, data);  break;
            case "ping":   send(ws, { type: "pong" }); break;
          }
        } catch {
          // Ungültige JSON-Nachricht ignorieren
        }
      });

      ws.on("close", () => handleDisconnect(ws));
      ws.on("error", () => { /* Verbindungsfehler still behandeln */ });
    });

    _server.listen(port, "0.0.0.0", () => {
      const addr = _server!.address();
      _port = typeof addr === "object" && addr ? addr.port : port;
      // Aufräum-Timer: alle 10 Minuten verwaiste Räume entfernen
      setInterval(cleanupRooms, 10 * 60 * 1000);
      resolve(_port);
    });

    _server.on("error", reject);
  });
}

/** Beendet den WebSocket-Server und räumt alle Räume auf. */
export function stopCollabServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!_wss) { resolve(); return; }

    // Alle Verbindungen schließen
    _wss.clients.forEach((ws) => ws.terminate());
    _rooms.clear();

    _wss.close(() => {
      _server?.close(() => {
        _wss = null;
        _server = null;
        _port = 0;
        resolve();
      });
    });
  });
}

/** Gibt an, ob der Server läuft. */
export function isCollabServerRunning(): boolean {
  return _wss !== null;
}

/** Gibt den aktuellen Port zurück (0 wenn nicht gestartet). */
export function getCollabServerPort(): number {
  return _port;
}
