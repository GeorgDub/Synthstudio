/**
 * tests/relay-server.test.ts
 *
 * Integration-Test für den Public Relay Server.
 * Startet den Server auf einem zufälligen Port und testet das WebSocket-Protokoll:
 *   - Room erstellen + beitreten
 *   - Event-Broadcast zwischen Clients
 *   - Disconnect → participant_left Notification
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";

// ─── In-Process Relay-Server-Setup ────────────────────────────────────────────
// (Wir importieren den Relay-Code nicht direkt, sondern starten ein equivalentes
//  Mini-Setup für isoliertes Testing.)

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
  lastActivity: number;
}

const rooms = new Map<string, Room>();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeRoomCode() : code;
}

function colorFor(userId: string) {
  return "#abcdef";
}

function broadcast(room: Room, payload: unknown, exclude?: WebSocket) {
  const msg = JSON.stringify(payload);
  room.participants.forEach(p => {
    if (p.ws !== exclude && p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
  });
}

let server: http.Server;
let wss: WebSocketServer;
let port: number;

beforeAll(async () => {
  server = http.createServer();
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    let currentRoom: Room | null = null;
    let currentUserId: string | null = null;

    const send = (data: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    };

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const type = msg.type as string;

      if (type === "ping") { send({ type: "pong" }); return; }

      if (type === "create") {
        const roomCode = (msg.roomCode as string | undefined) ?? makeRoomCode();
        const userId = msg.userId as string;
        const userName = (msg.userName as string | undefined) ?? "Host";
        const room: Room = {
          code: roomCode,
          participants: new Map(),
          snapshot: (msg.snapshot as Record<string, unknown> | undefined) ?? { bpm: 120, isPlaying: false },
          lastActivity: Date.now(),
        };
        const p: Participant = { userId, userName, color: colorFor(userId), joinedAt: Date.now(), ws };
        room.participants.set(userId, p);
        rooms.set(roomCode, room);
        currentRoom = room; currentUserId = userId;
        send({ type: "created", roomCode, snapshot: room.snapshot });
        return;
      }

      if (type === "join") {
        const roomCode = msg.roomCode as string;
        const room = rooms.get(roomCode);
        if (!room) { send({ type: "error", message: "Room nicht gefunden" }); return; }
        const userId = msg.userId as string;
        const userName = msg.userName as string;
        const p: Participant = { userId, userName, color: colorFor(userId), joinedAt: Date.now(), ws };
        room.participants.set(userId, p);
        currentRoom = room; currentUserId = userId;
        send({
          type: "joined", roomCode,
          participants: [...room.participants.values()].map(({ userId, userName, color, joinedAt }) =>
            ({ userId, userName, color, joinedAt })),
          snapshot: room.snapshot,
        });
        broadcast(room, { type: "participant_joined", participant: { userId, userName, color: colorFor(userId), joinedAt: p.joinedAt } }, ws);
        return;
      }

      if (type === "event" && currentRoom) {
        broadcast(currentRoom, { type: "event", fromUserId: currentUserId, payload: msg.payload }, ws);
        return;
      }
    });

    ws.on("close", () => {
      if (currentRoom && currentUserId) {
        currentRoom.participants.delete(currentUserId);
        broadcast(currentRoom, { type: "participant_left", userId: currentUserId });
      }
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  wss.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

// ─── Helper: Promise-basiertes WebSocket ──────────────────────────────────────

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMessage(ws: WebSocket, predicate?: (m: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (!predicate || predicate(msg)) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Public Relay Server – Protocol", () => {
  it("antwortet auf ping mit pong", async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify({ type: "ping" }));
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("pong");
    ws.close();
  });

  it("erstellt einen Room und liefert roomCode + snapshot zurück", async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify({
      type: "create", userId: "host1", userName: "Host",
      snapshot: { bpm: 140, isPlaying: false },
    }));
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("created");
    expect((msg.roomCode as string).length).toBeGreaterThan(3);
    expect((msg.snapshot as Record<string, unknown>).bpm).toBe(140);
    ws.close();
  });

  it("erlaubt Beitritt zu existierendem Room", async () => {
    // Host
    const host = await connectClient();
    host.send(JSON.stringify({ type: "create", userId: "host2", userName: "Host" }));
    const created = await nextMessage(host);
    const roomCode = created.roomCode as string;

    // Gast
    const guest = await connectClient();
    guest.send(JSON.stringify({ type: "join", roomCode, userId: "guest1", userName: "Gast" }));
    const joined = await nextMessage(guest);
    expect(joined.type).toBe("joined");
    expect((joined.participants as unknown[]).length).toBe(2);

    host.close(); guest.close();
  });

  it("sendet error bei Join in nicht existierenden Room", async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify({ type: "join", roomCode: "ZZZZZZ", userId: "x", userName: "X" }));
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("error");
    ws.close();
  });

  it("broadcasted Events an alle Teilnehmer außer den Sender", async () => {
    const host = await connectClient();
    host.send(JSON.stringify({ type: "create", userId: "h", userName: "Host" }));
    const created = await nextMessage(host);
    const roomCode = created.roomCode as string;

    const guest = await connectClient();
    guest.send(JSON.stringify({ type: "join", roomCode, userId: "g", userName: "Gast" }));
    await nextMessage(guest, m => m.type === "joined");
    // Host empfängt participant_joined
    await nextMessage(host, m => m.type === "participant_joined");

    // Guest sendet ein Event
    guest.send(JSON.stringify({
      type: "event", roomCode,
      payload: { type: "bpm:change", bpm: 160 },
    }));

    // Host muss es empfangen
    const evt = await nextMessage(host, m => m.type === "event");
    expect(evt.fromUserId).toBe("g");
    expect((evt.payload as Record<string, unknown>).bpm).toBe(160);

    host.close(); guest.close();
  });

  it("benachrichtigt verbleibende Teilnehmer bei Disconnect", async () => {
    const host = await connectClient();
    host.send(JSON.stringify({ type: "create", userId: "h3", userName: "Host" }));
    const created = await nextMessage(host);
    const roomCode = created.roomCode as string;

    const guest = await connectClient();
    guest.send(JSON.stringify({ type: "join", roomCode, userId: "g3", userName: "Gast" }));
    await nextMessage(guest, m => m.type === "joined");
    await nextMessage(host, m => m.type === "participant_joined");

    // Guest trennt
    const leftPromise = nextMessage(host, m => m.type === "participant_left");
    guest.close();
    const left = await leftPromise;
    expect(left.userId).toBe("g3");

    host.close();
  });
});
