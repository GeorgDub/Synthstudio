/**
 * Synthstudio – diag-file-sink.test.ts
 *
 * Die Datei ist der Teil, den der Bedienende mir hinüberreicht. Das Panel zeigt
 * dasselbe live, aber lange Ketten passen auf keinen Screenshot.
 *
 * Zwei Eigenschaften entscheiden, ob die Datei etwas taugt:
 *   1. Sie schreibt jedes Ereignis GENAU EINMAL — doppelte Zeilen liessen einen
 *      Vorgang wie zwei aussehen.
 *   2. Sie meldet, wenn der Ringpuffer etwas verworfen hat. Eine Datei mit
 *      stiller Lücke ist schlimmer als eine mit Fehlermeldung.
 */
import { describe, it, expect } from "vitest";
import { createTraceLog } from "../../client/src/diag/traceLog";
import { createFileSink } from "../../client/src/diag/fileSink";

function sammler() {
  const zeilen: string[] = [];
  return {
    zeilen,
    schreibe: async (text: string) => {
      zeilen.push(...text.split("\n").filter(Boolean));
    },
  };
}

describe("fileSink", () => {
  it("schreibt jedes Ereignis genau einmal", async () => {
    const log = createTraceLog({ capacity: 100 });
    const s = sammler();
    const sink = createFileSink(log, { schreibe: s.schreibe });

    log.push({ kind: "step", src: "a", msg: "eins" });
    log.push({ kind: "step", src: "a", msg: "zwei" });
    await sink.flush();
    log.push({ kind: "step", src: "a", msg: "drei" });
    await sink.flush();

    const geparst = s.zeilen.map(z => JSON.parse(z));
    expect(geparst.map(e => e.msg)).toEqual(["eins", "zwei", "drei"]);
  });

  it("schreibt nichts, wenn nichts passiert ist", async () => {
    const log = createTraceLog({ capacity: 100 });
    const s = sammler();
    const sink = createFileSink(log, { schreibe: s.schreibe });

    log.push({ kind: "step", src: "a", msg: "eins" });
    await sink.flush();
    await sink.flush();

    expect(s.zeilen).toHaveLength(1);
  });

  it("meldet eine Lücke, statt sie zu verschweigen", async () => {
    // Der Ringpuffer fasst 2; bis zum Spülen fallen 3 Ereignisse raus. Ohne
    // Meldung sähe die Datei lückenlos aus — und die laufende Nummer wäre das
    // einzige, was den Verlust noch verriete.
    const log = createTraceLog({ capacity: 2 });
    const s = sammler();
    const sink = createFileSink(log, { schreibe: s.schreibe });

    for (let i = 0; i < 5; i++) {
      log.push({ kind: "step", src: "a", msg: `e${i}` });
    }
    await sink.flush();

    const geparst = s.zeilen.map(z => JSON.parse(z));
    const luecke = geparst.find(e => e.kind === "error");
    expect(luecke).toBeTruthy();
    expect(luecke.msg).toContain("3");
  });

  it("hält die laufende Nummer als Beleg in der Datei", async () => {
    const log = createTraceLog({ capacity: 100 });
    const s = sammler();
    const sink = createFileSink(log, { schreibe: s.schreibe });

    log.push({ kind: "midi-in", src: "E2S", msg: "cmd 0x52", hex: "F0 42" });
    await sink.flush();

    const e = JSON.parse(s.zeilen[0]);
    expect(e.seq).toBe(1);
    expect(e.hex).toBe("F0 42"); // der Beleg gehört in die Datei
  });

  it("lässt einen Schreibfehler die App nicht mitreissen", async () => {
    const log = createTraceLog({ capacity: 100 });
    const sink = createFileSink(log, {
      schreibe: async () => {
        throw new Error("Platte voll");
      },
    });

    log.push({ kind: "step", src: "a", msg: "eins" });

    await expect(sink.flush()).resolves.toBeUndefined();
  });
});
