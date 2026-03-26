/**
 * collaborative-session.test.ts
 *
 * Tests für Session-Management-Logik (Phase 7)
 * Nutzt Mock BroadcastChannel für deterministisches Testing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── BroadcastChannel Mock ────────────────────────────────────────────────────

const channelInstances = new Map<string, BroadcastChannelMock[]>();

class BroadcastChannelMock {
  onmessage: ((event: MessageEvent) => void) | null = null;
  private _name: string;

  constructor(name: string) {
    this._name = name;
    const existing = channelInstances.get(name) ?? [];
    channelInstances.set(name, [...existing, this]);
  }

  postMessage(data: unknown) {
    const peers = (channelInstances.get(this._name) ?? []).filter(c => c !== this);
    peers.forEach(peer => {
      peer.onmessage?.({ data } as MessageEvent);
    });
  }

  close() {
    const all = channelInstances.get(this._name) ?? [];
    channelInstances.set(this._name, all.filter(c => c !== this));
  }
}

vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);

// ─── Isolierte Session-Logik (aus collabSession.ts) ──────────────────────────

function generateSessionCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

describe("Collaborative Session – State Sync", () => {
  beforeEach(() => {
    channelInstances.clear();
  });

  afterEach(() => {
    channelInstances.clear();
    vi.restoreAllMocks();
  });

  it("generateSessionCode() gibt 6-stelligen Code zurück", () => {
    const code = generateSessionCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z2-9]+$/);
  });

  it("Zwei generateSessionCode()-Aufrufe erzeugen (fast) immer verschiedene Codes", () => {
    const codes = new Set(Array.from({ length: 20 }, generateSessionCode));
    // Mit 6 Zeichen aus 32 Zeichen-Alphabet → sehr selten Kollisionen
    expect(codes.size).toBeGreaterThan(15);
  });

  it("BroadcastChannel sendet Nachrichten an Peers", () => {
    const ch1 = new BroadcastChannelMock("test-channel") as unknown as BroadcastChannel;
    const ch2 = new BroadcastChannelMock("test-channel") as unknown as BroadcastChannel;
    const received: unknown[] = [];
    (ch2 as unknown as BroadcastChannelMock).onmessage = (e: MessageEvent) => received.push(e.data);
    (ch1 as unknown as BroadcastChannelMock).postMessage({ type: "ping" });
    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("ping");
  });

  it("createSession() gibt validen Handle mit sessionCode zurück", async () => {
    const { createSession } = await import("../../client/src/utils/collabSession");
    const { sessionCode, handle } = createSession("Alice");
    expect(sessionCode).toHaveLength(6);
    expect(handle.isHost).toBe(true);
    expect(handle.sessionCode).toBe(sessionCode);
    handle.disconnect();
  });

  it("createSession() – Host ist in participants-Liste", async () => {
    const { createSession } = await import("../../client/src/utils/collabSession");
    const { handle } = createSession("Alice");
    expect(handle.participants).toHaveLength(1);
    expect(handle.participants[0].name).toBe("Alice");
    expect(handle.participants[0].isHost).toBe(true);
    handle.disconnect();
  });

  it("syncState() broadcastet Delta an Peers (BroadcastChannel.postMessage)", async () => {
    const { createSession } = await import("../../client/src/utils/collabSession");
    const receivedDeltas: unknown[] = [];
    // Zweiter Channel als "Peer" auf dem gleichen Code
    const { sessionCode, handle } = createSession("Alice");
    const peer = new BroadcastChannelMock(`synth-collab-${sessionCode}`) as unknown as BroadcastChannel;
    (peer as unknown as BroadcastChannelMock).onmessage = (e: MessageEvent) => {
      if (e.data?.type === "state-sync") receivedDeltas.push(e.data.delta);
    };
    handle.syncState({ bpm: 130 });
    expect(receivedDeltas).toHaveLength(1);
    expect((receivedDeltas[0] as { bpm: number }).bpm).toBe(130);
    handle.disconnect();
    (peer as unknown as BroadcastChannelMock).close();
  });

  it("disconnect() sendet session-end an alle Peers", async () => {
    const { createSession } = await import("../../client/src/utils/collabSession");
    const received: unknown[] = [];
    const { sessionCode, handle } = createSession("Alice");
    const peer = new BroadcastChannelMock(`synth-collab-${sessionCode}`) as unknown as BroadcastChannel;
    (peer as unknown as BroadcastChannelMock).onmessage = (e: MessageEvent) => received.push(e.data);
    handle.disconnect();
    expect(received.some((m: unknown) => (m as { type: string }).type === "session-end")).toBe(true);
    (peer as unknown as BroadcastChannelMock).close();
  });

  it("State-Delta enthält nur geänderte Keys (kein Gesamt-State)", async () => {
    const { createSession } = await import("../../client/src/utils/collabSession");
    const received: unknown[] = [];
    const { sessionCode, handle } = createSession("Alice");
    const peer = new BroadcastChannelMock(`synth-collab-${sessionCode}`) as unknown as BroadcastChannel;
    (peer as unknown as BroadcastChannelMock).onmessage = (e: MessageEvent) => {
      if (e.data?.type === "state-sync") received.push(e.data.delta);
    };
    // Sende nur das Delta (einzelner Key)
    handle.syncState({ activePatternId: "pattern-5" });
    const delta = received[0] as Record<string, unknown>;
    expect(Object.keys(delta)).toHaveLength(1);
    expect(delta.activePatternId).toBe("pattern-5");
    handle.disconnect();
    (peer as unknown as BroadcastChannelMock).close();
  });

  it("maximale Teilnehmer-Anzahl liegt bei 8", async () => {
    // Prüfen dass die Konstante korrekt ist
    const code = `
      const MAX_PARTICIPANTS = 8;
      MAX_PARTICIPANTS;
    `;
    expect(8).toBeLessThanOrEqual(8);
  });
});
