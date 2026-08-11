// @vitest-environment jsdom
/**
 * Synthstudio – diag-midi-verdichtung.test.ts
 *
 * MIDI-Clock läuft mit 24 Ticks je Viertel; bei 185 BPM sind das ~74 Ereignisse
 * pro Sekunde. Einzeln protokolliert deckt das jede interessante Zeile zu —
 * und der Ringpuffer wirft nach wenigen Sekunden alles Wichtige raus.
 *
 * Verdichtet werden deshalb Clock und Noten. Sysex, CC und NRPN NIE: das sind
 * genau die Rahmen, wegen derer das Log gebaut wurde.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTraceLog } from "../../client/src/diag/traceLog";
import { installMidiTap } from "../../client/src/diag/midiTap";

class FakeInput extends EventTarget {
  readonly id = "in-1";
  readonly name = "Fake E2S";
  open() {
    return Promise.resolve(this);
  }
  emit(bytes: number[]) {
    const ev = new Event("midimessage") as Event & { data: Uint8Array };
    ev.data = Uint8Array.from(bytes);
    this.dispatchEvent(ev);
  }
}

let zurueck: (() => void) | null = null;
afterEach(() => {
  zurueck?.();
  zurueck = null;
});

async function aufbau(opts?: { verdichten?: boolean }) {
  const input = new FakeInput();
  const access = new EventTarget() as EventTarget & {
    inputs: Map<string, FakeInput>;
    outputs: Map<string, never>;
  };
  access.inputs = new Map([[input.id, input]]);
  access.outputs = new Map();
  const nav = navigator as unknown as Record<string, unknown>;
  const vorher = nav.requestMIDIAccess;
  nav.requestMIDIAccess = () => Promise.resolve(access);
  const log = createTraceLog({ capacity: 500 });
  const ab = installMidiTap(log, opts);
  zurueck = () => {
    ab();
    nav.requestMIDIAccess = vorher;
  };
  await (
    navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }
  ).requestMIDIAccess();
  return { input, log };
}

describe("midiTap — Verdichtung", () => {
  it("fasst Clock-Ticks zu einem Zähler zusammen", async () => {
    const { input, log } = await aufbau();

    for (let i = 0; i < 100; i++) input.emit([0xf8]);
    input.emit([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x52, 0xf7]); // spült

    const eingang = log.recent().filter(e => e.kind === "midi-in");
    expect(eingang).toHaveLength(2);
    expect(eingang[0].msg).toContain("100");
    expect(eingang[0].msg?.toLowerCase()).toContain("clock");
  });

  it("lässt Sysex zwischen den Ticks einzeln stehen", async () => {
    const { input, log } = await aufbau();

    input.emit([0xf8]);
    input.emit([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x52, 0xf7]);
    input.emit([0xf8]);
    input.emit([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x54, 0xf7]);

    const sysex = log
      .recent()
      .filter(e => e.kind === "midi-in" && e.hex?.startsWith("F0"));
    expect(sysex).toHaveLength(2);
    expect(sysex[0].hex).toContain(" 52 ");
    expect(sysex[1].hex).toContain(" 54 ");
  });

  it("verdichtet CC nicht — daran hängt die Parameter-Diagnose", async () => {
    const { input, log } = await aufbau();

    input.emit([0xb0, 0x4a, 0x40]);
    input.emit([0xb0, 0x4a, 0x41]);

    const cc = log.recent().filter(e => e.kind === "midi-in");
    expect(cc).toHaveLength(2);
  });

  it("kann abgeschaltet werden, dann steht jeder Tick einzeln da", async () => {
    const { input, log } = await aufbau({ verdichten: false });

    for (let i = 0; i < 10; i++) input.emit([0xf8]);

    expect(log.recent().filter(e => e.kind === "midi-in")).toHaveLength(10);
  });
});
