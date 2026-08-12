/**
 * Synthstudio – korg-push-gegenprobe.test.ts
 *
 * `memory_poke.py` im Omnitribe-Repo hält es seit jeher so: „Nach dem Schreiben
 * wird IMMER zurückgelesen und verglichen. Ein Write ohne Gegenprobe ist ein
 * Write, von dem man nichts weiß." Die App tat das nicht — sie meldete Erfolg,
 * sobald das Gerät ein ACK schickte.
 *
 * ☠ Das ACK bestätigt den EMPFANG, nicht den Inhalt. Auf der USB-Strecke gehen
 * einzelne Pakete verloren (Rahmenlänge schwankt um Vielfache von 3, ein
 * USB-MIDI-Paket trägt 3 Datenbytes). Alle Nutzbytes sind gültige 7-Bit-Werte,
 * eine Prüfsumme gibt es nicht — ein verfälschter Push kommt also als
 * plausibles Pattern an, und das ACK sagt trotzdem „in Ordnung".
 *
 * Der Test simuliert genau das: ein Gerät, das quittiert und dann etwas
 * anderes abgelegt hat.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  connectE2sDevice,
  pushE2sBody,
  pushE2sCurrentBody,
  __setE2sMidiAccessProviderForTests,
  __resetE2sDeviceForTests,
} from "../../client/src/store/useE2sDeviceStore";
import {
  E2Model,
  E2Func,
  buildPatternDump,
  buildCurrentPatternDump,
} from "../../client/src/utils/korg/e2Sysex";

function body(fuellwert: number): Uint8Array {
  const b = new Uint8Array(0x4000);
  b.fill(fuellwert);
  return b;
}

function identityReply(): Uint8Array {
  return Uint8Array.from([
    0xf0, 0x42, 0x50, 0x01, 0, 0x00, E2Model.SAMPLER, 0, 0, 0, 2, 2, 0xf7,
  ]);
}

function ack(): Uint8Array {
  return Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, E2Func.ACK, 0xf7]);
}

/**
 * Gerät, das jeden Push quittiert — aber `abgelegt` zurückgibt, egal was
 * geschickt wurde.
 */
function fakeAccess(abgelegt: Uint8Array): MIDIAccess {
  const input: {
    name: string;
    onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  } = { name: "Electribe 2", onmidimessage: null };
  const output = {
    name: "Electribe 2",
    send(bytes: number[]) {
      const frame = Uint8Array.from(bytes);
      const antworten: Uint8Array[] =
        frame[2] === 0x50
          ? [identityReply()]
          : frame[6] === E2Func.PATTERN_DUMP_REQ
            ? [buildPatternDump(frame[7] + frame[8] * 128, abgelegt)]
            : frame[6] === E2Func.CURRENT_PATTERN_DUMP_REQ
              ? [buildCurrentPatternDump(abgelegt)]
              : frame[6] === E2Func.PATTERN_DUMP ||
                  frame[6] === E2Func.CURRENT_PATTERN_DUMP
                ? [ack()]
                : [];
      for (const r of antworten) queueMicrotask(() => input.onmidimessage?.({ data: r }));
    },
  };
  return {
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output]]),
  } as unknown as MIDIAccess;
}

beforeEach(() => __resetE2sDeviceForTests());

describe("Push mit Gegenprobe", () => {
  it("meldet Erfolg, wenn das Gerät wirklich hat, was geschickt wurde", async () => {
    const gesendet = body(0x11);
    __setE2sMidiAccessProviderForTests(async () => fakeAccess(gesendet));
    await connectE2sDevice();

    await expect(pushE2sBody(3, gesendet)).resolves.toBe(true);
  });

  it("meldet FEHLSCHLAG, wenn das Gerät quittiert aber etwas anderes abgelegt hat", async () => {
    // Der Kern: das ACK kommt, der Inhalt stimmt nicht. Ohne Gegenprobe wäre
    // das ein stiller Datenverlust mit grünem Haken daneben.
    __setE2sMidiAccessProviderForTests(async () => fakeAccess(body(0x22)));
    await connectE2sDevice();

    await expect(pushE2sBody(3, body(0x11))).resolves.toBe(false);
  });

  it("prüft den Edit-Buffer-Push genauso gegen", async () => {
    // ☠ Hier war die Gegenprobe zuerst absichtlich weggelassen, mit der
    // Begründung „das laufende Pattern ändert sich ohnehin von selbst".
    // Am 2026-08-12 gemessen: zwei bestätigte Lesungen des aktuellen Patterns
    // ergaben NULL abweichende Bytes. Die Begründung war eine Vermutung aus
    // einer kaputten Messung — und hätte den gefährlicheren der beiden
    // Schreibwege ungeprüft gelassen, denn „⇧ Gerät" schreibt in den
    // Edit-Buffer, nicht in einen Slot.
    __setE2sMidiAccessProviderForTests(async () => fakeAccess(body(0x22)));
    await connectE2sDevice();

    await expect(pushE2sCurrentBody(body(0x11))).resolves.toBe(false);
  });
});
