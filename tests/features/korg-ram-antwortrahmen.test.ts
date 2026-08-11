/**
 * Synthstudio – korg-ram-antwortrahmen.test.ts
 *
 * ★ Diese Rahmen sind am 2026-08-11 vom GERÄT aufgezeichnet, nicht erdacht.
 * Der Entwurf zum Diagnose-Log hielt ausdrücklich fest, dass das Fixture auf
 * eine echte Aufzeichnung wartet — eine Vermutung in einen Test zu giessen
 * lässt sie ab da bewiesen aussehen.
 *
 * Aufgezeichnet mit `tools/hwtest/memory_peek.py` (Omnitribe-Repo) am
 * angeschlossenen E2S:
 *
 *     TX: F0 42 30 00 01 24 52 …            (Lesen, cmd 0x52)
 *     RX: F0 42 30 00 01 24 54 52 00 …      (Antwort, cmd 0x54!)
 *
 * ☠ **Das Gerät antwortet mit einem ANDEREN Kommando-Byte, als es empfangen
 * hat.** `parseRamResponse` prüft auf 0x52 und meldet darum „Unerwartete
 * Antwort (cmd 0x54) — läuft auf dem Gerät wirklich Hacktribe?". Das Gerät war
 * nie das Problem.
 *
 * Der zweite Fehler steckt im Datenbeginn: der Panel-Pfad schneidet ab Byte 7,
 * der Bridge-Pfad und das am Gerät bewiesene `memory_peek.py` ab Byte 9.
 * Belegt wird das hier durch den Inhalt selbst — an 0xC06B279C steht die
 * Kennung `PTST`, und die kommt nur bei der richtigen Schnittstelle heraus.
 */
import { describe, it, expect } from "vitest";
import { parseRamResponse } from "../../client/src/utils/korg/hacktribeRam";
import { parseSysex } from "../../client/src/utils/korg/e2Sysex";

function ausHex(s: string): Uint8Array {
  return Uint8Array.from(
    s.match(/.{2}/g)!.map(h => parseInt(h, 16))
  );
}

/** Antwort auf ein Lesen von 16 B ab 0xC06B279C. Dort steht „PTST". */
const ANTWORT_PTST = ausHex(
  "F0423000012454520000505453540000000000000000000000000000F7"
);

describe("RAM-Antwortrahmen des Geräts", () => {
  it("erkennt die Antwort, obwohl sie cmd 0x54 trägt", () => {
    const p = parseRamResponse(ANTWORT_PTST);
    expect(p?.kind).toBe("data");
  });

  it("liefert genau die Bytes, die im Gerät stehen", () => {
    const p = parseRamResponse(ANTWORT_PTST);
    if (p?.kind !== "data") throw new Error("kein Datenblock");
    // „PTST" — die Kennung des Pattern-Blocks. Bei falschem Datenbeginn käme
    // hier etwas Plausibles, aber Falsches heraus; deshalb wird gegen einen
    // BEKANNTEN Inhalt geprüft und nicht gegen eine Länge.
    expect(Array.from(p.data.subarray(0, 4))).toEqual([0x50, 0x54, 0x53, 0x54]);
  });

  it("der zweite Parser im selben Repo liest denselben Rahmen gleich", () => {
    // hacktribeRam und e2Sysex sind zwei Implementierungen desselben Vorgangs.
    // Solange beide existieren, müssen sie sich einig sein — sonst hängt das
    // Ergebnis davon ab, welcher Knopf gedrückt wurde.
    const p = parseSysex(ANTWORT_PTST);
    expect(p?.kind).toBe("cpuRamData");
    if (p?.kind !== "cpuRamData") throw new Error("kein Datenblock");
    expect(Array.from(p.data.subarray(0, 4))).toEqual([0x50, 0x54, 0x53, 0x54]);
  });
});
