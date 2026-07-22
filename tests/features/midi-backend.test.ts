/**
 * tests/features/midi-backend.test.ts
 *
 * Coverage für den MIDI-Backend-Opt-in-Schalter (useMidiBackendStore) und den
 * Client-seitigen nativen MIDI-Brücken-Layer (nativeMidiAccess): Manager-
 * Routing/Lifecycle, MIDIAccess-Shim (D2) und OmniTribe-Adapter (D1) — alles
 * mit injizierter Fake-Bridge, ohne Electron/Hardware.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// tests/features laufen in node (kein jsdom) → minimaler localStorage-Mock,
// damit Persistenz-Assertions greifen. Der Store selbst kapselt fehlendes
// localStorage in try/catch, würde also auch ohne Mock nicht werfen.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  });
}

import {
  getMidiBackend,
  isNativeMidiBackend,
  setMidiBackend,
  resolveBackend,
  __resetMidiBackendForTests,
} from "../../client/src/store/useMidiBackendStore";
import {
  NativeMidiManager,
  createNativeMidiAccess,
  connectOmniTribeNative,
  describeNativeMidiStatus,
  OMNITRIBE_PORT_PATTERNS,
  type NativeMidiBridge,
  type NativeMidiMessage,
} from "../../client/src/utils/nativeMidiAccess";

// ─── Fake-Bridge ─────────────────────────────────────────────────────────────

interface FakeBridgeOptions {
  inputs?: string[];
  outputs?: string[];
  listFails?: boolean;
  openInputFailsFor?: number[];
  openOutputFailsFor?: number[];
}

function makeFakeBridge(opts: FakeBridgeOptions = {}) {
  const inputs = (opts.inputs ?? []).map((name, index) => ({ index, name }));
  const outputs = (opts.outputs ?? []).map((name, index) => ({ index, name }));
  let listeners: ((msg: NativeMidiMessage) => void)[] = [];
  const sent: { handle: string; bytes: number[] }[] = [];
  const closed: string[] = [];
  let unsubCount = 0;

  const bridge: NativeMidiBridge = {
    listMidiPorts: async () =>
      opts.listFails
        ? { success: false, error: "no native layer" }
        : { success: true, inputs, outputs },
    openMidiInput: async (portIndex: number) =>
      opts.openInputFailsFor?.includes(portIndex)
        ? { success: false, error: "port busy" }
        : { success: true, handle: `in:${portIndex}` },
    openMidiOutput: async (portIndex: number) =>
      opts.openOutputFailsFor?.includes(portIndex)
        ? { success: false, error: "port busy" }
        : { success: true, handle: `out:${portIndex}` },
    sendMidi: async (handle: string, bytes: number[]) => {
      sent.push({ handle, bytes });
      return { success: true };
    },
    closeMidiPort: async (handle: string) => {
      closed.push(handle);
      return { success: true };
    },
    onMidiMessage: cb => {
      listeners.push(cb);
      return () => {
        unsubCount++;
        listeners = listeners.filter(l => l !== cb);
      };
    },
  };

  return {
    bridge,
    sent,
    closed,
    emit: (msg: NativeMidiMessage) => listeners.forEach(l => l(msg)),
    get listenerCount() {
      return listeners.length;
    },
    get unsubCount() {
      return unsubCount;
    },
  };
}

// ─── useMidiBackendStore ───────────────────────────────────────────────────────

describe("resolveBackend (default: native in Electron, web in browser)", () => {
  it("honours an explicit stored choice", () => {
    expect(resolveBackend("web", true)).toBe("web");
    expect(resolveBackend("native", false)).toBe("native");
  });
  it("defaults to native in Electron, web in browser when unset", () => {
    expect(resolveBackend(null, true)).toBe("native");
    expect(resolveBackend(null, false)).toBe("web");
  });
  it("ignores an invalid stored value → platform default", () => {
    expect(resolveBackend("garbage", true)).toBe("native");
    expect(resolveBackend("", false)).toBe("web");
  });
});

describe("useMidiBackendStore", () => {
  beforeEach(() => __resetMidiBackendForTests());

  it("default ist 'web' (Opt-in: nativ NICHT default)", () => {
    expect(getMidiBackend()).toBe("web");
    expect(isNativeMidiBackend()).toBe(false);
  });

  it("setMidiBackend wechselt + persistiert nach localStorage", () => {
    setMidiBackend("native");
    expect(getMidiBackend()).toBe("native");
    expect(isNativeMidiBackend()).toBe(true);
    expect(localStorage.getItem("ss-midi-backend")).toBe("native");
  });

  it("ignoriert ungültige Werte", () => {
    setMidiBackend("garbage" as never);
    expect(getMidiBackend()).toBe("web");
  });

  it("liest persistierten Wert beim Reset wieder auf Default zurück", () => {
    setMidiBackend("native");
    __resetMidiBackendForTests();
    expect(getMidiBackend()).toBe("web");
    expect(localStorage.getItem("ss-midi-backend")).toBeNull();
  });
});

// ─── NativeMidiManager ─────────────────────────────────────────────────────────

describe("NativeMidiManager", () => {
  it("routet midi:message nur an den passenden Handle", async () => {
    const fake = makeFakeBridge({ inputs: ["A", "B"] });
    const mgr = new NativeMidiManager(fake.bridge);
    const a: number[][] = [];
    const b: number[][] = [];
    const ha = await mgr.openInput(0, bytes => a.push(bytes));
    const hb = await mgr.openInput(1, bytes => b.push(bytes));
    expect(ha).toBe("in:0");
    expect(hb).toBe("in:1");

    fake.emit({ handle: "in:0", bytes: [0x90, 60, 100], deltaTime: 0 });
    fake.emit({ handle: "in:1", bytes: [0x80, 60, 0], deltaTime: 0 });
    fake.emit({ handle: "in:99", bytes: [0xff], deltaTime: 0 }); // unbekannt → ignoriert

    expect(a).toEqual([[0x90, 60, 100]]);
    expect(b).toEqual([[0x80, 60, 0]]);
  });

  it("abonniert das Event nur EINMAL für mehrere Inputs", async () => {
    const fake = makeFakeBridge({ inputs: ["A", "B"] });
    const mgr = new NativeMidiManager(fake.bridge);
    await mgr.openInput(0, () => {});
    await mgr.openInput(1, () => {});
    expect(fake.listenerCount).toBe(1);
  });

  it("openInput liefert null wenn der Port belegt ist", async () => {
    const fake = makeFakeBridge({ inputs: ["A"], openInputFailsFor: [0] });
    const mgr = new NativeMidiManager(fake.bridge);
    expect(await mgr.openInput(0, () => {})).toBeNull();
    expect(mgr.openHandleCount).toBe(0);
  });

  it("send ist fire-and-forget + konvertiert Uint8Array → number[]", async () => {
    const fake = makeFakeBridge({ outputs: ["O"] });
    const mgr = new NativeMidiManager(fake.bridge);
    const h = await mgr.openOutput(0);
    expect(h).toBe("out:0");
    mgr.send(h!, Uint8Array.from([0xf0, 0x7e, 0xf7]));
    // microtask abwarten (Promise im send())
    await Promise.resolve();
    expect(fake.sent).toEqual([{ handle: "out:0", bytes: [0xf0, 0x7e, 0xf7] }]);
  });

  it("send reicht ein plain number[] ohne Kopie durch (keine Allokation)", async () => {
    const fake = makeFakeBridge({ outputs: ["O"] });
    const mgr = new NativeMidiManager(fake.bridge);
    const h = await mgr.openOutput(0);
    const payload = [0xb0, 7, 100];
    mgr.send(h!, payload);
    await Promise.resolve();
    // Dieselbe Referenz → kein redundantes Array.from-Kopieren im Hot-Path.
    expect(fake.sent[0].bytes).toBe(payload);
  });

  it("closeAll schließt alle Handles + entkoppelt den Listener", async () => {
    const fake = makeFakeBridge({ inputs: ["A"], outputs: ["O"] });
    const mgr = new NativeMidiManager(fake.bridge);
    await mgr.openInput(0, () => {});
    await mgr.openOutput(0);
    expect(mgr.openHandleCount).toBe(2);

    await mgr.closeAll();
    expect(fake.closed.sort()).toEqual(["in:0", "out:0"]);
    expect(mgr.openHandleCount).toBe(0);
    expect(fake.unsubCount).toBe(1);

    // Nach closeAll dürfen keine Messages mehr geroutet werden.
    const before = fake.listenerCount;
    expect(before).toBe(0);
  });
});

// ─── D2: createNativeMidiAccess (MIDIAccess-Shim) ──────────────────────────────

describe("createNativeMidiAccess", () => {
  it("baut echte Maps von In/Out-Ports mit Handle als id", async () => {
    const fake = makeFakeBridge({
      inputs: ["Keystep"],
      outputs: ["Keystep", "GS Synth"],
    });
    const access = await createNativeMidiAccess(fake.bridge);
    expect(access).not.toBeNull();
    expect(access!.inputs.size).toBe(1);
    expect(access!.outputs.size).toBe(2);
    const input = access!.inputs.get("in:0")!;
    expect(input.id).toBe("in:0");
    expect(input.name).toBe("Keystep");
    expect(input.type).toBe("input");
  });

  it("liefert null wenn der native Layer nicht verfügbar ist", async () => {
    const fake = makeFakeBridge({ listFails: true });
    expect(await createNativeMidiAccess(fake.bridge)).toBeNull();
  });

  it("input.onmidimessage bekommt Web-MIDI-kompatibles {data: Uint8Array}", async () => {
    const fake = makeFakeBridge({ inputs: ["Pad"] });
    const access = await createNativeMidiAccess(fake.bridge);
    const events: Uint8Array[] = [];
    access!.inputs.get("in:0")!.onmidimessage = e => events.push(e.data);
    fake.emit({ handle: "in:0", bytes: [0x90, 64, 127], deltaTime: 0 });
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(events[0])).toEqual([0x90, 64, 127]);
  });

  it("output.send routet fire-and-forget an die Bridge", async () => {
    const fake = makeFakeBridge({ outputs: ["Synth"] });
    const access = await createNativeMidiAccess(fake.bridge);
    access!.outputs.get("out:0")!.send([0xb0, 7, 100]);
    await Promise.resolve();
    expect(fake.sent).toEqual([{ handle: "out:0", bytes: [0xb0, 7, 100] }]);
  });

  it("überspringt belegte Input-Ports ohne zu werfen", async () => {
    const fake = makeFakeBridge({ inputs: ["A", "B"], openInputFailsFor: [0] });
    const access = await createNativeMidiAccess(fake.bridge);
    expect(access!.inputs.size).toBe(1);
    expect(access!.inputs.get("in:1")).toBeDefined();
  });

  it("onstatechange ist settable (kein Hotplug, aber kein Throw)", async () => {
    const fake = makeFakeBridge({ inputs: ["A"] });
    const access = await createNativeMidiAccess(fake.bridge);
    expect(access!.onstatechange).toBeNull();
    access!.onstatechange = () => {};
    expect(typeof access!.onstatechange).toBe("function");
  });
});

// ─── D1: connectOmniTribeNative (WsTransport-Adapter) ──────────────────────────

describe("connectOmniTribeNative", () => {
  it("matcht KORG/OmniTribe-Ports per Pattern + öffnet In+Out", async () => {
    const fake = makeFakeBridge({
      inputs: ["Some Keyboard", "electribe sampler"],
      outputs: ["GS Synth", "electribe sampler"],
    });
    const conn = await connectOmniTribeNative(fake.bridge);
    expect(conn).not.toBeNull();
    expect(conn!.inHandle).toBe("in:1");
    expect(conn!.outHandle).toBe("out:1");
    expect(conn!.inName).toBe("electribe sampler");
  });

  it("liefert null wenn kein Gerät matcht", async () => {
    const fake = makeFakeBridge({
      inputs: ["Generic Pad"],
      outputs: ["GS Synth"],
    });
    expect(await connectOmniTribeNative(fake.bridge)).toBeNull();
  });

  it("transport.send geht an den Out-Handle, eingehende Bytes an onmessage", async () => {
    const fake = makeFakeBridge({
      inputs: ["omnitribe"],
      outputs: ["omnitribe"],
    });
    const conn = await connectOmniTribeNative(fake.bridge);
    const received: number[][] = [];
    conn!.transport.onmessage = data => received.push(Array.from(data));

    conn!.transport.send(Uint8Array.from([0xf0, 0x42, 0xf7]));
    await Promise.resolve();
    expect(fake.sent).toEqual([{ handle: "out:0", bytes: [0xf0, 0x42, 0xf7] }]);

    fake.emit({
      handle: "in:0",
      bytes: [0xf0, 0x42, 0x01, 0xf7],
      deltaTime: 0,
    });
    expect(received).toEqual([[0xf0, 0x42, 0x01, 0xf7]]);
  });

  it("schließt den Output wieder wenn der Input-Open fehlschlägt (kein Leak)", async () => {
    const fake = makeFakeBridge({
      inputs: ["omnitribe"],
      outputs: ["omnitribe"],
      openInputFailsFor: [0],
    });
    const conn = await connectOmniTribeNative(fake.bridge);
    expect(conn).toBeNull();
    expect(fake.closed).toContain("out:0");
  });

  it("transport.close ruft closeAll (Teardown beider Handles)", async () => {
    const fake = makeFakeBridge({
      inputs: ["omnitribe"],
      outputs: ["omnitribe"],
    });
    const conn = await connectOmniTribeNative(fake.bridge);
    conn!.transport.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.closed.sort()).toEqual(["in:0", "out:0"]);
  });

  it("OMNITRIBE_PORT_PATTERNS enthält die KORG-Familien", () => {
    expect(OMNITRIBE_PORT_PATTERNS).toContain("omnitribe");
    expect(OMNITRIBE_PORT_PATTERNS).toContain("electribe");
    expect(OMNITRIBE_PORT_PATTERNS).toContain("korg");
  });
});

// ─── describeNativeMidiStatus ──────────────────────────────────────────────────

describe("describeNativeMidiStatus", () => {
  it("nicht verfügbar → error", () => {
    const s = describeNativeMidiStatus(null, null);
    expect(s.level).toBe("error");
    expect(s.headline).toMatch(/nicht verfügbar/i);
  });

  it("verfügbar mit In+Out → ok", () => {
    const s = describeNativeMidiStatus(
      {
        available: true,
        openInputs: 1,
        openOutputs: 1,
        virtualPortsSupported: false,
      },
      {
        inputs: [{ index: 0, name: "Keystep" }],
        outputs: [{ index: 0, name: "Synth" }],
      }
    );
    expect(s.level).toBe("ok");
    expect(s.inputCount).toBe(1);
    expect(s.outputCount).toBe(1);
    expect(s.headline).toMatch(/1 In \/ 1 Out/);
    // Windows-Hinweis zu virtuellen Ports ist informativ, kein warn.
    expect(s.notes.some(n => /[Vv]irtuelle/.test(n))).toBe(true);
  });

  it("verfügbar aber 0 Eingänge → warn + Stille-Hinweis (Advisor-Falle)", () => {
    const s = describeNativeMidiStatus(
      {
        available: true,
        openInputs: 0,
        openOutputs: 1,
        virtualPortsSupported: false,
      },
      { inputs: [], outputs: [{ index: 0, name: "GS Synth" }] }
    );
    expect(s.level).toBe("warn");
    expect(s.notes.some(n => /Eingänge/.test(n))).toBe(true);
  });

  it("zählt offene Handles durch", () => {
    const s = describeNativeMidiStatus(
      {
        available: true,
        openInputs: 2,
        openOutputs: 3,
        virtualPortsSupported: true,
      },
      {
        inputs: [
          { index: 0, name: "a" },
          { index: 1, name: "b" },
        ],
        outputs: [{ index: 0, name: "c" }],
      }
    );
    expect(s.openInputs).toBe(2);
    expect(s.openOutputs).toBe(3);
  });
});
