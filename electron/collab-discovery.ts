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

import * as dgram from "dgram";
import * as os from "os";

// ─── Konstanten ───────────────────────────────────────────────────────────────

const DISCOVERY_PORT = 41235;
const ANNOUNCE_INTERVAL_MS = 2_000;
const SESSION_TTL_MS = 8_000; // Session gilt als verschwunden nach 8 s ohne Announce

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface DiscoveredSession {
  roomCode: string;
  hostIp: string;
  hostName: string;
  port: number;
  lastSeen: number;
}

interface AnnounceMsg {
  type: "SS_ANNOUNCE";
  roomCode: string;
  port: number;
  hostName: string;
  ts: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _announceSocket: dgram.Socket | null = null;
let _announceTimer: NodeJS.Timeout | null = null;

let _listenSocket: dgram.Socket | null = null;
let _sessions: Map<string, DiscoveredSession> = new Map(); // key: `ip:roomCode`

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function getHostname(): string {
  try {
    return os.hostname().split(".")[0];
  } catch {
    return "Synthstudio";
  }
}

function buildAnnounce(roomCode: string, wsPort: number): Buffer {
  const msg: AnnounceMsg = {
    type: "SS_ANNOUNCE",
    roomCode,
    port: wsPort,
    hostName: getHostname(),
    ts: Date.now(),
  };
  return Buffer.from(JSON.stringify(msg));
}

function getBroadcastAddresses(): string[] {
  const addrs: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      // Berechne Broadcast-Adresse aus IP + Subnetzmaske
      const ipParts = iface.address.split(".").map(Number);
      const maskParts = iface.netmask.split(".").map(Number);
      const bcast = ipParts.map((p, i) => (p | (~maskParts[i] & 0xff))).join(".");
      addrs.push(bcast);
    }
  }
  if (addrs.length === 0) addrs.push("255.255.255.255");
  return addrs;
}

// ─── Announce (Host-Seite) ────────────────────────────────────────────────────

/** Startet das regelmäßige UDP-Broadcast für eine aktive Session. */
export function startDiscoveryAnnounce(roomCode: string, wsPort: number): void {
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

function sendAnnounce(roomCode: string, wsPort: number): void {
  if (!_announceSocket) return;
  const payload = buildAnnounce(roomCode, wsPort);
  for (const bcast of getBroadcastAddresses()) {
    _announceSocket.send(payload, 0, payload.length, DISCOVERY_PORT, bcast, (err) => {
      if (err) console.warn("[collab-discovery] send error:", err.message);
    });
  }
}

/** Stoppt den Broadcast-Timer und schließt den Announce-Socket. */
export function stopDiscoveryAnnounce(): void {
  if (_announceTimer) {
    clearInterval(_announceTimer);
    _announceTimer = null;
  }
  if (_announceSocket) {
    try { _announceSocket.close(); } catch { /* ignore */ }
    _announceSocket = null;
  }
}

// ─── Listen (Client-Seite) ────────────────────────────────────────────────────

/** Startet den UDP-Listener der offene Sessions sammelt. */
export function startDiscoveryListen(): void {
  if (_listenSocket) return; // Bereits aktiv

  _listenSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  _listenSocket.on("error", (err) => {
    console.warn("[collab-discovery] listen error:", err.message);
    stopDiscoveryListen();
  });

  _listenSocket.on("message", (buf, rinfo) => {
    try {
      const msg = JSON.parse(buf.toString()) as AnnounceMsg;
      if (msg.type !== "SS_ANNOUNCE") return;
      const key = `${rinfo.address}:${msg.roomCode}`;
      _sessions.set(key, {
        roomCode: msg.roomCode,
        hostIp: rinfo.address,
        hostName: msg.hostName,
        port: msg.port,
        lastSeen: Date.now(),
      });
    } catch {
      // Unbekannte Pakete ignorieren
    }
  });

  _listenSocket.bind(DISCOVERY_PORT, () => {
    _listenSocket?.setBroadcast(true);
  });
}

/** Stoppt den UDP-Listener und leert die Session-Liste. */
export function stopDiscoveryListen(): void {
  if (_listenSocket) {
    try { _listenSocket.close(); } catch { /* ignore */ }
    _listenSocket = null;
  }
  _sessions.clear();
}

/** Gibt alle aktuell sichtbaren Sessions zurück (TTL-gefiltert). */
export function getDiscoveredSessions(): DiscoveredSession[] {
  const now = Date.now();
  // Abgelaufene Einträge bereinigen
  for (const [key, s] of _sessions) {
    if (now - s.lastSeen > SESSION_TTL_MS) _sessions.delete(key);
  }
  return Array.from(_sessions.values());
}
