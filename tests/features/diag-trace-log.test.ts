/**
 * Synthstudio – diag-trace-log.test.ts
 *
 * Der Kern des Diagnose-Logs: ein Ringpuffer, dessen laufende Nummer die
 * Wahrheit über die Reihenfolge ist.
 *
 * Warum nicht der Zeitstempel: zwei Ereignisse in derselben Millisekunde sind
 * darüber nicht unterscheidbar — und genau bei Sende/Antwort-Paaren kommt es
 * darauf an. Verdrängt der Puffer die ältesten Einträge, muss an der Lücke
 * ablesbar bleiben, DASS etwas fehlt. Ein Puffer, der stillschweigend neu
 * durchnummeriert, macht aus einem Verlust eine lückenlose Lüge.
 */
import { describe, it, expect } from "vitest";
import { createTraceLog } from "../../client/src/diag/traceLog";

describe("traceLog — Ringpuffer", () => {
  it("nummeriert lückenlos weiter, nachdem die ältesten Einträge verdrängt wurden", () => {
    const log = createTraceLog({ capacity: 3 });
    for (let i = 0; i < 5; i++) {
      log.push({ kind: "step", src: "test", msg: `e${i}` });
    }

    const events = log.recent();
    expect(events).toHaveLength(3);
    expect(events.map(e => e.msg)).toEqual(["e2", "e3", "e4"]);
    // Die verdrängten 1 und 2 hinterlassen eine sichtbare Lücke.
    expect(events.map(e => e.seq)).toEqual([3, 4, 5]);
  });

  it("meldet, wie viele Ereignisse der Puffer verworfen hat", () => {
    const log = createTraceLog({ capacity: 2 });
    for (let i = 0; i < 5; i++) {
      log.push({ kind: "step", src: "test", msg: `e${i}` });
    }
    expect(log.droppedCount()).toBe(3);
  });
});
