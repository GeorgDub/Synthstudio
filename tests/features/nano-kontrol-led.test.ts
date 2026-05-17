/**
 * tests/features/nano-kontrol-led.test.ts
 *
 * TASK-231 (v2.84.0) — KORG nanoKONTROL2 LED-Feedback + Scene-Mode.
 *
 * Setup-Pattern (identisch zu midi-clock-out.test.ts):
 *   - Mock-Sender pusht jede Message in ein Array
 *   - NanoKontrolFeedback wird mit dem Sender konstruiert
 *   - Wir testen Diff-Sync, Full-Sync, AllLedsOff und Scene-Cycle
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  NanoKontrolFeedback,
  type NanoKontrolChannelState,
} from "../../client/src/audio/NanoKontrolFeedback";
import {
  NANO_KONTROL2,
  buildNanoKontrolLed,
  sendNanoKontrolFullSync,
  sendNanoKontrolAllLedsOff,
  sendNanoKontrolLed,
  loadFeedbackEnabled,
  saveFeedbackEnabled,
  loadFeedbackOutputId,
  saveFeedbackOutputId,
  loadFeedbackSceneMode,
  saveFeedbackSceneMode,
  type MidiAccessLike,
  type MidiOutputLike,
} from "../../client/src/utils/midiOutput";
import {
  addScene,
  removeScene,
  cycleScene,
  setActiveScene,
  getSceneState,
} from "../../client/src/store/useSceneStore";

// ─── Mock-Helpers ─────────────────────────────────────────────────────────────

function makeMockAccess(outputs: Partial<MidiOutputLike>[]): MidiAccessLike & { sent: Map<string, number[][]> } {
  const sent = new Map<string, number[][]>();
  const map = new Map<string, MidiOutputLike>();
  for (const o of outputs) {
    const id = o.id ?? "out-" + Math.random();
    sent.set(id, []);
    const out: MidiOutputLike = {
      id,
      name: "name" in o ? (o.name as string | null) : "Mock-Out",
      manufacturer: "manufacturer" in o ? (o.manufacturer as string | null) : "KORG",
      state: o.state ?? "connected",
      send: (data: number[] | Uint8Array) => {
        const arr = Array.isArray(data) ? [...data] : Array.from(data);
        sent.get(id)!.push(arr);
      },
    };
    map.set(id, out);
  }
  return { outputs: map, sent } as MidiAccessLike & { sent: Map<string, number[][]> };
}

function captureSender(): { sender: (bytes: number[]) => void; messages: number[][] } {
  const messages: number[][] = [];
  return {
    sender: (bytes: number[]) => { messages.push([...bytes]); },
    messages,
  };
}

// ─── buildNanoKontrolLed Tests ────────────────────────────────────────────────

describe("buildNanoKontrolLed (TASK-231)", () => {
  it("baut CC-Message mit Status 0xB0 (Ch1) + value 127 für LED-On", () => {
    const msg = buildNanoKontrolLed(NANO_KONTROL2.MUTE_CC_BASE, true);
    expect(msg).toEqual([0xb0, 48, 127]);
  });

  it("baut CC-Message mit value 0 für LED-Off", () => {
    const msg = buildNanoKontrolLed(NANO_KONTROL2.SOLO_CC_BASE + 7, false);
    expect(msg).toEqual([0xb0, 39, 0]);
  });
});

// ─── NanoKontrolFeedback: Sync-Verhalten ──────────────────────────────────────

describe("NanoKontrolFeedback.syncMixer (TASK-231)", () => {
  let cap: ReturnType<typeof captureSender>;
  let fb: NanoKontrolFeedback;

  beforeEach(() => {
    cap = captureSender();
    fb = new NanoKontrolFeedback(cap.sender);
    fb.setEnabled(true);
  });

  it("synchronisiert Mute-LED bei Channel.muted-Toggle", () => {
    const channels: NanoKontrolChannelState[] = Array.from({ length: 8 }, () => ({ muted: false, soloed: false }));
    // Erster Sync: alle 16 LEDs (8 Mute + 8 Solo) müssen rausgehen weil
    // Cache leer ist (undefined !== false → diff).
    const firstSent = fb.syncMixer(channels);
    expect(firstSent).toBe(16);

    cap.messages.length = 0;
    // Channel 3 muten → exakt 1 Message
    channels[3].muted = true;
    const sentNow = fb.syncMixer(channels);
    expect(sentNow).toBe(1);
    expect(cap.messages).toEqual([
      [0xb0, NANO_KONTROL2.MUTE_CC_BASE + 3, 127],
    ]);
  });

  it("synchronisiert Solo-LED bei Channel.soloed-Toggle", () => {
    const channels: NanoKontrolChannelState[] = Array.from({ length: 8 }, () => ({ muted: false, soloed: false }));
    fb.syncMixer(channels); // initial Full-Sync
    cap.messages.length = 0;
    channels[5].soloed = true;
    const sent = fb.syncMixer(channels);
    expect(sent).toBe(1);
    expect(cap.messages[0]).toEqual([0xb0, NANO_KONTROL2.SOLO_CC_BASE + 5, 127]);
  });

  it("schickt initialen Full-Sync bei Activate (forceFullSync)", () => {
    fb.setEnabled(false);
    fb.setEnabled(true); // disable+enable → resetCache (via allLedsOff + sender stays)
    cap.messages.length = 0;
    // 4 muted, 2 soloed
    const channels: NanoKontrolChannelState[] = Array.from({ length: 8 }, (_, i) => ({
      muted: i < 4,
      soloed: i >= 6,
    }));
    const sent = fb.forceFullSync(channels);
    expect(sent).toBe(16); // alle 8 Mute + 8 Solo gehen raus
    // Check ein paar Inhalte
    const muteOnMessages = cap.messages.filter(
      m => m[1] >= NANO_KONTROL2.MUTE_CC_BASE && m[1] < NANO_KONTROL2.MUTE_CC_BASE + 8 && m[2] === 127,
    );
    expect(muteOnMessages.length).toBe(4);
    const soloOnMessages = cap.messages.filter(
      m => m[1] >= NANO_KONTROL2.SOLO_CC_BASE && m[1] < NANO_KONTROL2.SOLO_CC_BASE + 8 && m[2] === 127,
    );
    expect(soloOnMessages.length).toBe(2);
  });

  it("schickt nichts wenn disabled", () => {
    fb.setEnabled(false);
    cap.messages.length = 0;
    const channels: NanoKontrolChannelState[] = Array.from({ length: 8 }, () => ({ muted: true, soloed: true }));
    const sent = fb.syncMixer(channels);
    expect(sent).toBe(0);
    expect(cap.messages).toEqual([]);
  });

  it("setEnabled(false) schickt allLedsOff (24 Messages: 8 Mute + 8 Solo + 8 Rec)", () => {
    // Vorher ein paar LEDs an, damit der allLedsOff-Call etwas zu tun hat.
    fb.syncMixer(Array.from({ length: 8 }, () => ({ muted: true, soloed: true })));
    cap.messages.length = 0;
    fb.setEnabled(false);
    // 8 Mute-Off + 8 Solo-Off + 8 Rec-Off = 24
    expect(cap.messages.length).toBe(24);
    expect(cap.messages.every(m => m[2] === 0)).toBe(true);
  });

  it("ignoriert Sender-Exceptions defensive (Hardware-Disconnect mid-send)", () => {
    let count = 0;
    const sender = (_bytes: number[]) => {
      count++;
      if (count === 2) throw new Error("device disconnected");
    };
    const fb2 = new NanoKontrolFeedback(sender);
    fb2.setEnabled(true);
    const channels: NanoKontrolChannelState[] = Array.from({ length: 8 }, () => ({ muted: false, soloed: false }));
    // Sollte NICHT crashen
    expect(() => fb2.syncMixer(channels)).not.toThrow();
    // Counter beweist dass weitere Sends nach dem Throw weitergingen
    expect(count).toBeGreaterThan(2);
  });

  it("no-op wenn kein Sender gesetzt ist", () => {
    const fb3 = new NanoKontrolFeedback(null);
    fb3.setEnabled(true);
    const sent = fb3.syncMixer([{ muted: true, soloed: true }]);
    expect(sent).toBe(0);
  });

  it("Diff-Sync: keine wiederholten Messages bei unverändertem State", () => {
    const channels: NanoKontrolChannelState[] = Array.from({ length: 8 }, () => ({ muted: false, soloed: false }));
    fb.syncMixer(channels);
    cap.messages.length = 0;
    // Zweiter Call mit identischem State → 0 Messages
    const sent = fb.syncMixer(channels);
    expect(sent).toBe(0);
    expect(cap.messages).toEqual([]);
  });
});

// ─── sendNanoKontrolFullSync (stateless Variante) ─────────────────────────────

describe("sendNanoKontrolFullSync (TASK-231)", () => {
  it("schickt 16 CC-Messages an das Output", () => {
    const access = makeMockAccess([{ id: "nano" }]);
    const channels = Array.from({ length: 8 }, (_, i) => ({ muted: i % 2 === 0, soloed: false }));
    const sent = sendNanoKontrolFullSync(access, "nano", channels);
    expect(sent).toBe(16);
    expect(access.sent.get("nano")!.length).toBe(16);
  });

  it("liefert 0 bei fehlendem Output", () => {
    const access = makeMockAccess([{ id: "nano" }]);
    const channels = Array.from({ length: 8 }, () => ({ muted: false, soloed: false }));
    expect(sendNanoKontrolFullSync(access, "missing", channels)).toBe(0);
    expect(sendNanoKontrolFullSync(null, "nano", channels)).toBe(0);
  });

  it("füllt fehlende Channels mit muted=false/soloed=false auf", () => {
    const access = makeMockAccess([{ id: "nano" }]);
    const sent = sendNanoKontrolFullSync(access, "nano", [{ muted: true, soloed: false }]);
    expect(sent).toBe(16);
    // Channel 0 muted=true (value 127)
    const channel0Mute = access.sent.get("nano")!.find(
      m => m[1] === NANO_KONTROL2.MUTE_CC_BASE && m[2] === 127,
    );
    expect(channel0Mute).toBeDefined();
    // Channel 1 muted=false (value 0)
    const channel1Mute = access.sent.get("nano")!.find(
      m => m[1] === NANO_KONTROL2.MUTE_CC_BASE + 1 && m[2] === 0,
    );
    expect(channel1Mute).toBeDefined();
  });
});

describe("sendNanoKontrolAllLedsOff (TASK-231)", () => {
  it("schickt 24 Off-Messages (Mute + Solo + Rec für alle 8 Channels)", () => {
    const access = makeMockAccess([{ id: "nano" }]);
    const sent = sendNanoKontrolAllLedsOff(access, "nano");
    expect(sent).toBe(24);
    const messages = access.sent.get("nano")!;
    expect(messages.length).toBe(24);
    expect(messages.every(m => m[2] === 0)).toBe(true);
  });
});

describe("sendNanoKontrolLed (TASK-231)", () => {
  it("schickt einzelne LED-CC für den korrekten Channel-Index", () => {
    const access = makeMockAccess([{ id: "nano" }]);
    expect(sendNanoKontrolLed(access, "nano", "mute", 3, true)).toBe(true);
    expect(access.sent.get("nano")![0]).toEqual([0xb0, NANO_KONTROL2.MUTE_CC_BASE + 3, 127]);
  });

  it("rejected channelIndex out of range", () => {
    const access = makeMockAccess([{ id: "nano" }]);
    expect(sendNanoKontrolLed(access, "nano", "mute", -1, true)).toBe(false);
    expect(sendNanoKontrolLed(access, "nano", "mute", 8, true)).toBe(false);
  });
});

// ─── Scene-Cycling via Marker-Buttons ─────────────────────────────────────────

describe("cycleScene (TASK-231 Scene-Mode)", () => {
  beforeEach(() => {
    // Reset Scene-Store für jeden Test
    const ids = getSceneState().scenes.map(s => s.id);
    for (const id of ids) removeScene(id);
    setActiveScene(null);
  });

  it("liefert null wenn keine Scenes vorhanden", () => {
    expect(cycleScene(1)).toBeNull();
    expect(cycleScene(-1)).toBeNull();
  });

  it("Marker-NEXT cyclet vorwärts mit Wrap-Around", () => {
    const a = addScene("A", "pat-1");
    const b = addScene("B", "pat-2");
    const c = addScene("C", "pat-3");
    setActiveScene(a);
    expect(cycleScene(1)).toBe(b);
    expect(getSceneState().activeSceneId).toBe(b);
    expect(cycleScene(1)).toBe(c);
    // Wrap zurück auf a
    expect(cycleScene(1)).toBe(a);
  });

  it("Marker-PREV cyclet rückwärts mit Wrap-Around", () => {
    const a = addScene("A", "pat-1");
    const b = addScene("B", "pat-2");
    const c = addScene("C", "pat-3");
    setActiveScene(a);
    expect(cycleScene(-1)).toBe(c); // Wrap zur letzten
    expect(cycleScene(-1)).toBe(b);
    expect(cycleScene(-1)).toBe(a);
  });

  it("startet ohne aktive Scene bei Index 0 (vorwärts) bzw. letzter (rückwärts)", () => {
    const a = addScene("A", "pat-1");
    const b = addScene("B", "pat-2");
    setActiveScene(null);
    expect(cycleScene(1)).toBe(a);
    setActiveScene(null);
    expect(cycleScene(-1)).toBe(b);
  });
});

// ─── localStorage-Persistenz ─────────────────────────────────────────────────

// Minimal in-memory localStorage-Shim für Node-Vitest (environment:node hat
// kein localStorage). Wir setzen ihn auf den globalen Scope wenn er fehlt.
function ensureLocalStorageShim(): void {
  if (typeof globalThis.localStorage !== "undefined") return;
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

describe("Feedback-Output Persistenz (TASK-231)", () => {
  beforeEach(() => {
    ensureLocalStorageShim();
    // Reset Storage
    saveFeedbackOutputId(null);
    saveFeedbackEnabled(false);
    saveFeedbackSceneMode(false);
  });

  it("speichert und lädt die Feedback-Output-ID", () => {
    expect(loadFeedbackOutputId()).toBeNull();
    saveFeedbackOutputId("nano-123");
    expect(loadFeedbackOutputId()).toBe("nano-123");
    saveFeedbackOutputId(null);
    expect(loadFeedbackOutputId()).toBeNull();
  });

  it("speichert und lädt den Feedback-Enabled-Flag", () => {
    expect(loadFeedbackEnabled()).toBe(false);
    saveFeedbackEnabled(true);
    expect(loadFeedbackEnabled()).toBe(true);
    saveFeedbackEnabled(false);
    expect(loadFeedbackEnabled()).toBe(false);
  });

  it("speichert und lädt den Scene-Mode-Flag", () => {
    expect(loadFeedbackSceneMode()).toBe(false);
    saveFeedbackSceneMode(true);
    expect(loadFeedbackSceneMode()).toBe(true);
  });
});
