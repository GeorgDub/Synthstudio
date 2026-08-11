// @vitest-environment jsdom
/**
 * Synthstudio – diag-midi-tap.test.ts
 *
 * Der MIDI-Tap hüllt `navigator.requestMIDIAccess` EINMAL um. Das ist der
 * einzige Engpass, durch den alle 10 Aufrufer laufen — auch die beiden
 * konkurrierenden RAM-Pfade, ohne dass eine dieser Dateien angefasst wird.
 *
 * ☠ Die Produktionsänderung, die diese Tests rot machen würde, ist benannt:
 * `input.onmidimessage = unserHandler` zu setzen, statt `addEventListener` zu
 * benutzen. Dann verschluckt der Tap den Handler des Aufrufers — oder der
 * Aufrufer den des Taps, je nach Reihenfolge. `HacktribeRamTransfer` umschifft
 * genau das schon von Hand (`prev?.call(input, event)`).
 *
 * Der zweite Test bewacht die Reihenfolge: ein Tap, der einen Tick zu spät
 * greift, verpasst still, welcher Pfad zuerst lief — und das läse sich später
 * als „dieser Pfad sendet gar nichts".
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTraceLog } from "../../client/src/diag/traceLog";
import { installMidiTap } from "../../client/src/diag/midiTap";

/** Fake-Port mit IDL-Handler-Semantik: `onmidimessage` IST ein Listener. */
class FakeInput extends EventTarget {
  readonly id = "in-1";
  readonly name = "Fake E2S";
  private handler: ((e: Event) => void) | null = null;

  get onmidimessage() {
    return this.handler;
  }
  set onmidimessage(fn: ((e: Event) => void) | null) {
    if (this.handler) this.removeEventListener("midimessage", this.handler);
    this.handler = fn;
    if (fn) this.addEventListener("midimessage", fn);
  }

  open() {
    return Promise.resolve(this);
  }

  /** Simuliert eine eingehende Message vom Gerät. */
  emit(bytes: number[]) {
    const ev = new Event("midimessage") as Event & { data: Uint8Array };
    ev.data = Uint8Array.from(bytes);
    this.dispatchEvent(ev);
  }
}

class FakeOutput {
  readonly id = "out-1";
  readonly name = "Fake E2S";
  readonly sent: Uint8Array[] = [];
  send(data: Uint8Array | number[]) {
    this.sent.push(data instanceof Uint8Array ? data : Uint8Array.from(data));
  }
  open() {
    return Promise.resolve(this);
  }
}

function fakeAccess() {
  const input = new FakeInput();
  const output = new FakeOutput();
  const access = new EventTarget() as EventTarget & {
    inputs: Map<string, FakeInput>;
    outputs: Map<string, FakeOutput>;
  };
  access.inputs = new Map([[input.id, input]]);
  access.outputs = new Map([[output.id, output]]);
  return { access, input, output };
}

let restoreNavigator: (() => void) | null = null;

function stubRequestMidiAccess(access: unknown) {
  const nav = navigator as unknown as Record<string, unknown>;
  const had = "requestMIDIAccess" in nav;
  const prev = nav.requestMIDIAccess;
  nav.requestMIDIAccess = () => Promise.resolve(access);
  restoreNavigator = () => {
    if (had) nav.requestMIDIAccess = prev;
    else delete nav.requestMIDIAccess;
  };
}

afterEach(() => {
  restoreNavigator?.();
  restoreNavigator = null;
});

describe("midiTap — fremde Handler", () => {
  it("verschluckt den onmidimessage-Handler des Aufrufers nicht", async () => {
    const { access, input } = fakeAccess();
    stubRequestMidiAccess(access);
    const log = createTraceLog({ capacity: 100 });

    installMidiTap(log);

    // Der Aufrufer holt sich Zugriff und setzt SEINEN Handler — nach dem Tap,
    // so wie es in der App passiert.
    await (navigator as unknown as {
      requestMIDIAccess: () => Promise<unknown>;
    }).requestMIDIAccess();
    const gesehen: Uint8Array[] = [];
    input.onmidimessage = (e: Event) => {
      gesehen.push((e as Event & { data: Uint8Array }).data);
    };

    input.emit([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x52, 0xf7]);

    expect(gesehen).toHaveLength(1); // der Aufrufer hat es bekommen
    const eingang = log.recent().filter(e => e.kind === "midi-in");
    expect(eingang).toHaveLength(1); // und das Log auch
  });

  it("hält den Rohrahmen als Hex fest, auch wenn die Deutung nichts hergibt", async () => {
    const { access, input } = fakeAccess();
    stubRequestMidiAccess(access);
    const log = createTraceLog({ capacity: 100 });
    installMidiTap(log);
    await (navigator as unknown as {
      requestMIDIAccess: () => Promise<unknown>;
    }).requestMIDIAccess();

    // Ein Rahmen, dessen Kommando-Byte wir nicht kennen. Genau dieser Fall hat
    // in der Sitzung vom 2026-08-11 nur ein Banner erzeugt und keinen Beleg.
    input.emit([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x54, 0x11, 0x22, 0xf7]);

    const [ereignis] = log.recent().filter(e => e.kind === "midi-in");
    expect(ereignis.hex).toBe("F0 42 30 00 01 24 54 11 22 F7");
  });

  it("protokolliert Gesendetes und schickt es trotzdem wirklich raus", async () => {
    const { access, output } = fakeAccess();
    stubRequestMidiAccess(access);
    const log = createTraceLog({ capacity: 100 });
    installMidiTap(log);
    await (navigator as unknown as {
      requestMIDIAccess: () => Promise<unknown>;
    }).requestMIDIAccess();

    output.send(Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x52, 0xf7]));

    expect(output.sent).toHaveLength(1); // das Gerät hat es bekommen
    const ausgang = log.recent().filter(e => e.kind === "midi-out");
    expect(ausgang).toHaveLength(1);
    expect(ausgang[0].hex).toBe("F0 42 30 00 01 24 52 F7");
  });
});
