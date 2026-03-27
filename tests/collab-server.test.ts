/**
 * tests/collab-server.test.ts
 *
 * Unit-Tests für den CollabServer (electron/collab-server.ts) – Phase 1 v1.10.
 * Testet: generateRoomCode, getLocalIp, Server-Start/Stop, Raum-Protokoll.
 * Umgebung: Node (Vitest), echter WebSocket-Client über natives `WebSocket` (Node ≥ 22).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  generateRoomCode,
  getLocalIp,
  startCollabServer,
  stopCollabServer,
  isCollabServerRunning,
  getCollabServerPort,
} from "../electron/collab-server";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.onmessage = null;
      reject(new Error("WebSocket-Nachricht Timeout"));
    }, timeoutMs);

    ws.onmessage = (ev) => {
      clearTimeout(t);
      ws.onmessage = null;
      resolve(JSON.parse(ev.data as string));
    };
  });
}

function openClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("WebSocket connect failed"));
  });
}

// ─── generateRoomCode ─────────────────────────────────────────────────────────

describe("generateRoomCode()", () => {
  it("hat genau 6 Zeichen", () => {
    expect(generateRoomCode()).toHaveLength(6);
  });

  it("enthält nur erlaubte Zeichen (keine I, O, 0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it("zwei aufeinanderfolgende Codes sind (fast immer) unterschiedlich", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(90);
  });
});

// ─── getLocalIp ───────────────────────────────────────────────────────────────

describe("getLocalIp()", () => {
  it("gibt einen gültigen IPv4-String zurück", () => {
    const ip = getLocalIp();
    expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });
});

// ─── Server-Lifecycle ─────────────────────────────────────────────────────────

describe("CollabServer – Lifecycle", () => {
  it("isCollabServerRunning() ist false vor dem Start", async () => {
    await stopCollabServer(); // sicherstellen dass nicht läuft
    expect(isCollabServerRunning()).toBe(false);
  });

  it("startCollabServer() gibt einen Port > 0 zurück", async () => {
    const port = await startCollabServer(0);
    expect(port).toBeGreaterThan(0);
    await stopCollabServer();
  });

  it("isCollabServerRunning() ist true nach Start", async () => {
    await startCollabServer(0);
    expect(isCollabServerRunning()).toBe(true);
    await stopCollabServer();
  });

  it("stopCollabServer() setzt isRunning auf false", async () => {
    await startCollabServer(0);
    await stopCollabServer();
    expect(isCollabServerRunning()).toBe(false);
    expect(getCollabServerPort()).toBe(0);
  });
});

// ─── Raum-Protokoll ───────────────────────────────────────────────────────────

describe("CollabServer – Raum-Protokoll", () => {
  let port: number;

  beforeAll(async () => {
    port = await startCollabServer(0);
  });

  afterAll(async () => {
    await stopCollabServer();
  });

  afterEach(() => {
    // keine globale Bereinigung nötig
  });

  it("'create' erstellt einen Raum und gibt 'created' zurück", async () => {
    const ws = await openClient(port);
    ws.send(JSON.stringify({ type: "create", userId: "u1", userName: "Alice", snapshot: { bpm: 128, isPlaying: false } }));
    const resp = await waitForMessage(ws);
    expect(resp.type).toBe("created");
    expect(typeof resp.roomCode).toBe("string");
    expect((resp.roomCode as string).length).toBe(6);
    ws.close();
  });

  it("'join' mit ungültigem Code gibt 'error' zurück", async () => {
    const ws = await openClient(port);
    ws.send(JSON.stringify({ type: "join", roomCode: "XXXXXX", userId: "u2", userName: "Bob" }));
    const resp = await waitForMessage(ws);
    expect(resp.type).toBe("error");
    ws.close();
  });

  it("zweiter Client kann dem Raum beitreten und erhält Snapshot", async () => {
    // Host erstellt Raum
    const ws1 = await openClient(port);
    ws1.send(JSON.stringify({ type: "create", userId: "h1", userName: "Host", snapshot: { bpm: 140, isPlaying: false } }));
    const created = await waitForMessage(ws1) as { roomCode: string };

    // Gast tritt bei
    const ws2 = await openClient(port);
    ws2.send(JSON.stringify({ type: "join", roomCode: created.roomCode, userId: "g1", userName: "Gast" }));
    const joined = await waitForMessage(ws2) as { type: string; snapshot: { bpm: number } };
    expect(joined.type).toBe("joined");
    expect(joined.snapshot.bpm).toBe(140);

    ws1.close();
    ws2.close();
  });

  it("Events werden an andere Teilnehmer weitergeleitet", async () => {
    const ws1 = await openClient(port);
    ws1.send(JSON.stringify({ type: "create", userId: "h2", userName: "Host2", snapshot: { bpm: 120, isPlaying: false } }));
    const created = await waitForMessage(ws1) as { roomCode: string };

    const ws2 = await openClient(port);
    ws2.send(JSON.stringify({ type: "join", roomCode: created.roomCode, userId: "g2", userName: "Gast2" }));
    // joined-Nachricht des Gastes abwarten
    await waitForMessage(ws2);
    // participant_joined-Nachricht des Hosts abwarten
    const pjMsg = await waitForMessage(ws1);
    expect(pjMsg.type).toBe("participant_joined");

    // Gast sendet Event, Host empfängt es
    ws2.send(JSON.stringify({
      type: "event",
      roomCode: created.roomCode,
      payload: { type: "step:toggle", partId: "kick", stepIndex: 0 },
    }));
    const evMsg = await waitForMessage(ws1) as { type: string; payload: { type: string } };
    expect(evMsg.type).toBe("event");
    expect(evMsg.payload.type).toBe("step:toggle");

    ws1.close();
    ws2.close();
  });

  it("'ping' antwortet mit 'pong'", async () => {
    const ws = await openClient(port);
    ws.send(JSON.stringify({ type: "ping" }));
    const resp = await waitForMessage(ws);
    expect(resp.type).toBe("pong");
    ws.close();
  });
});
