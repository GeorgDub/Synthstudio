"use strict";
/**
 * Synthstudio – collab-discovery.ts
 *
 * UDP-basierte Netzwerk-Discovery für Kollaborations-Sessions.
 * Nutzt Node.js `dgram` (kein externes Paket nötig).
 *
 * Protokoll (JSON, max. 512 Bytes):
 *   Announce (Host → Broadcast):
 *     { type: "SS_ANNOUNCE", roomCode: string, port: number, hostName: string, ts: number }
 *
 *   Die Listening-Seite (Client) sammelt empfangene Announcements
 *   und entnimmt die Absender-IP aus dem UDP-Paket.
 *
 * Ports:
 *   DISCOVERY_PORT 41235  (fest, für Sender und Empfänger identisch)
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
exports.startDiscoveryAnnounce = startDiscoveryAnnounce;
exports.stopDiscoveryAnnounce = stopDiscoveryAnnounce;
exports.startDiscoveryListen = startDiscoveryListen;
exports.stopDiscoveryListen = stopDiscoveryListen;
exports.getDiscoveredSessions = getDiscoveredSessions;
const dgram = __importStar(require("dgram"));
const os = __importStar(require("os"));
// ─── Konstanten ───────────────────────────────────────────────────────────────
const DISCOVERY_PORT = 41235;
const ANNOUNCE_INTERVAL_MS = 2000;
const SESSION_TTL_MS = 8000; // Session gilt als verschwunden nach 8 s ohne Announce
// ─── State ────────────────────────────────────────────────────────────────────
let _announceSocket = null;
let _announceTimer = null;
let _listenSocket = null;
let _sessions = new Map(); // key: `ip:roomCode`
// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
function getHostname() {
    try {
        return os.hostname().split(".")[0];
    }
    catch {
        return "Synthstudio";
    }
}
function buildAnnounce(roomCode, wsPort) {
    const msg = {
        type: "SS_ANNOUNCE",
        roomCode,
        port: wsPort,
        hostName: getHostname(),
        ts: Date.now(),
    };
    return Buffer.from(JSON.stringify(msg));
}
function getBroadcastAddresses() {
    const addrs = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] ?? []) {
            if (iface.family !== "IPv4" || iface.internal)
                continue;
            // Berechne Broadcast-Adresse aus IP + Subnetzmaske
            const ipParts = iface.address.split(".").map(Number);
            const maskParts = iface.netmask.split(".").map(Number);
            const bcast = ipParts.map((p, i) => (p | (~maskParts[i] & 0xff))).join(".");
            addrs.push(bcast);
        }
    }
    if (addrs.length === 0)
        addrs.push("255.255.255.255");
    return addrs;
}
// ─── Announce (Host-Seite) ────────────────────────────────────────────────────
/** Startet das regelmäßige UDP-Broadcast für eine aktive Session. */
function startDiscoveryAnnounce(roomCode, wsPort) {
    stopDiscoveryAnnounce();
    _announceSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    _announceSocket.on("error", (err) => {
        // Nicht-fatal: Discovery-Broadcast ist optional
        console.warn("[collab-discovery] announce error:", err.message);
        stopDiscoveryAnnounce();
    });
    _announceSocket.bind(0, () => {
        _announceSocket?.setBroadcast(true);
        sendAnnounce(roomCode, wsPort);
    });
    _announceTimer = setInterval(() => sendAnnounce(roomCode, wsPort), ANNOUNCE_INTERVAL_MS);
}
function sendAnnounce(roomCode, wsPort) {
    if (!_announceSocket)
        return;
    const payload = buildAnnounce(roomCode, wsPort);
    for (const bcast of getBroadcastAddresses()) {
        _announceSocket.send(payload, 0, payload.length, DISCOVERY_PORT, bcast, (err) => {
            if (err)
                console.warn("[collab-discovery] send error:", err.message);
        });
    }
}
/** Stoppt den Broadcast-Timer und schließt den Announce-Socket. */
function stopDiscoveryAnnounce() {
    if (_announceTimer) {
        clearInterval(_announceTimer);
        _announceTimer = null;
    }
    if (_announceSocket) {
        try {
            _announceSocket.close();
        }
        catch { /* ignore */ }
        _announceSocket = null;
    }
}
// ─── Listen (Client-Seite) ────────────────────────────────────────────────────
/** Startet den UDP-Listener der offene Sessions sammelt. */
function startDiscoveryListen() {
    if (_listenSocket)
        return; // Bereits aktiv
    _listenSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    _listenSocket.on("error", (err) => {
        console.warn("[collab-discovery] listen error:", err.message);
        stopDiscoveryListen();
    });
    _listenSocket.on("message", (buf, rinfo) => {
        try {
            const msg = JSON.parse(buf.toString());
            if (msg.type !== "SS_ANNOUNCE")
                return;
            const key = `${rinfo.address}:${msg.roomCode}`;
            _sessions.set(key, {
                roomCode: msg.roomCode,
                hostIp: rinfo.address,
                hostName: msg.hostName,
                port: msg.port,
                lastSeen: Date.now(),
            });
        }
        catch {
            // Unbekannte Pakete ignorieren
        }
    });
    _listenSocket.bind(DISCOVERY_PORT, () => {
        _listenSocket?.setBroadcast(true);
    });
}
/** Stoppt den UDP-Listener und leert die Session-Liste. */
function stopDiscoveryListen() {
    if (_listenSocket) {
        try {
            _listenSocket.close();
        }
        catch { /* ignore */ }
        _listenSocket = null;
    }
    _sessions.clear();
}
/** Gibt alle aktuell sichtbaren Sessions zurück (TTL-gefiltert). */
function getDiscoveredSessions() {
    const now = Date.now();
    // Abgelaufene Einträge bereinigen
    for (const [key, s] of _sessions) {
        if (now - s.lastSeen > SESSION_TTL_MS)
            _sessions.delete(key);
    }
    return Array.from(_sessions.values());
}
