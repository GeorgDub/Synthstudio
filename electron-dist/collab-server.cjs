"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRoomCode = generateRoomCode;
exports.getLocalIp = getLocalIp;
exports.startCollabServer = startCollabServer;
exports.stopCollabServer = stopCollabServer;
exports.isCollabServerRunning = isCollabServerRunning;
exports.getCollabServerPort = getCollabServerPort;
const http = __importStar(require("http"));
const ws_1 = require("ws");
const os_1 = require("os");
// ─── Interner Raum-Typ ────────────────────────────────────────────────────────
const PARTICIPANT_COLORS = [
    "#7c3aed", "#2563eb", "#059669", "#d97706",
    "#dc2626", "#db2777", "#0891b2", "#65a30d",
];
// ─── Server-State ─────────────────────────────────────────────────────────────
let _server = null;
let _wss = null;
let _port = 0;
const _rooms = new Map();
// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
/** Zufälliger 6-stelliger Raum-Code (Großbuchstaben + Ziffern, ohne I/O/0/1) */
function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}
/** Lokale IPv4-Adresse des Hauptnetzwerk-Interfaces */
function getLocalIp() {
    const ifaces = (0, os_1.networkInterfaces)();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] ?? []) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}
function send(ws, msg) {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}
function broadcast(room, msg, excludeUserId) {
    for (const [uid, ws] of room.sockets) {
        if (uid !== excludeUserId)
            send(ws, msg);
    }
}
function nextColor(room) {
    return PARTICIPANT_COLORS[room.participants.size % PARTICIPANT_COLORS.length];
}
/** Entfernt abgelaufene leere Räume (> 30 min alt, keine Teilnehmer). */
function cleanupRooms() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [code, room] of _rooms) {
        if (room.participants.size === 0 && room.createdAt < cutoff) {
            _rooms.delete(code);
        }
    }
}
// ─── Nachrichten-Handler ──────────────────────────────────────────────────────
function handleCreate(ws, data) {
    // Sicherheitsvalidierung: userId und userName dürfen nicht leer sein
    if (!data.userId || !data.userName || data.userId.length > 64 || data.userName.length > 64) {
        send(ws, { type: "error", message: "Ungültige Benutzer-ID oder Name" });
        return;
    }
    let code = data.roomCode?.toUpperCase().trim() ?? "";
    // Neuen Code generieren wenn nicht angegeben oder bereits vergeben
    if (!code || _rooms.has(code)) {
        code = generateRoomCode();
        while (_rooms.has(code))
            code = generateRoomCode();
    }
    const snapshot = data.snapshot ?? { bpm: 120, isPlaying: false };
    const participant = {
        userId: data.userId,
        userName: data.userName,
        color: PARTICIPANT_COLORS[0],
        joinedAt: Date.now(),
    };
    const room = {
        code,
        participants: new Map([[data.userId, participant]]),
        sockets: new Map([[data.userId, ws]]),
        snapshot,
        createdAt: Date.now(),
    };
    _rooms.set(code, room);
    ws._roomCode = code;
    ws._userId = data.userId;
    send(ws, { type: "created", roomCode: code, snapshot });
}
function handleJoin(ws, data) {
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
    const participant = {
        userId: data.userId,
        userName: data.userName,
        color: nextColor(room),
        joinedAt: Date.now(),
    };
    room.participants.set(data.userId, participant);
    room.sockets.set(data.userId, ws);
    ws._roomCode = code;
    ws._userId = data.userId;
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
function handleEvent(ws, data) {
    const code = data.roomCode?.toUpperCase().trim();
    const room = _rooms.get(code);
    if (!room)
        return;
    const wsTagged = ws;
    const fromUserId = wsTagged._userId ?? "unknown";
    // Snapshot bei relevanten Events aktualisieren
    const p = data.payload;
    if (p.type === "bpm:change" && typeof p.bpm === "number") {
        room.snapshot.bpm = p.bpm;
    }
    else if (p.type === "pattern:switch" && typeof p.patternId === "string") {
        room.snapshot.activePatternId = p.patternId;
    }
    else if (p.type === "transport:play") {
        room.snapshot.isPlaying = true;
    }
    else if (p.type === "transport:stop") {
        room.snapshot.isPlaying = false;
    }
    // An alle anderen Teilnehmer weiterleiten
    broadcast(room, { type: "event", fromUserId, payload: data.payload }, fromUserId);
}
function handleDisconnect(ws) {
    const tagged = ws;
    const { _roomCode: code, _userId: userId } = tagged;
    if (!code || !userId)
        return;
    const room = _rooms.get(code);
    if (!room)
        return;
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
function startCollabServer(port = 0) {
    return new Promise((resolve, reject) => {
        if (_wss) {
            resolve(_port);
            return;
        }
        _server = http.createServer();
        _wss = new ws_1.WebSocketServer({ server: _server });
        _wss.on("connection", (ws) => {
            ws.on("message", (raw) => {
                try {
                    const data = JSON.parse(String(raw));
                    if (!data || typeof data.type !== "string")
                        return;
                    switch (data.type) {
                        case "create":
                            handleCreate(ws, data);
                            break;
                        case "join":
                            handleJoin(ws, data);
                            break;
                        case "event":
                            handleEvent(ws, data);
                            break;
                        case "ping":
                            send(ws, { type: "pong" });
                            break;
                    }
                }
                catch {
                    // Ungültige JSON-Nachricht ignorieren
                }
            });
            ws.on("close", () => handleDisconnect(ws));
            ws.on("error", () => { });
        });
        _server.listen(port, "0.0.0.0", () => {
            const addr = _server.address();
            _port = typeof addr === "object" && addr ? addr.port : port;
            // Aufräum-Timer: alle 10 Minuten verwaiste Räume entfernen
            setInterval(cleanupRooms, 10 * 60 * 1000);
            resolve(_port);
        });
        _server.on("error", reject);
    });
}
/** Beendet den WebSocket-Server und räumt alle Räume auf. */
function stopCollabServer() {
    return new Promise((resolve) => {
        if (!_wss) {
            resolve();
            return;
        }
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
function isCollabServerRunning() {
    return _wss !== null;
}
/** Gibt den aktuellen Port zurück (0 wenn nicht gestartet). */
function getCollabServerPort() {
    return _port;
}
