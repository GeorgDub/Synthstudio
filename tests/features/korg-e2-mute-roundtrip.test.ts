/**
 * Synthstudio – korg-e2-mute-roundtrip.test.ts (v3.319.0)
 *
 * Der Mute-Zustand muss in beide Richtungen mitfahren. Ohne das ist nach jedem
 * Transfer **jeder** Part aktiv: was am Gerät stumm war, klingt in Synthstudio
 * (und umgekehrt schaltet ein Push alle Parts wieder laut).
 *
 * Das Byte ist belegt: Part `+0x01`, 0 = spielt, 1 = stumm — aus Korgs
 * offizieller „electribe MIDI Implementation Rev 1.00" (TABLE 6), gegengeprüft
 * mit keijiro/e2edit und maks/elfer. Die Schreibseite (`buildE2PatternBody`)
 * konnte es bereits; gefüllt hat das Feld nur nie jemand, und die Leseseite
 * kannte es gar nicht.
 */
import { describe, it, expect } from "vitest";
import { synthstudioPatternToBody } from "../../client/src/utils/korg/synthstudioToE2Pattern";
import { decodePatternBody } from "../../client/src/utils/korg/e2Sysex";
import type { PatternData } from "../../client/src/audio/AudioEngine";
import { DEFAULT_CHANNEL_FX } from "../../client/src/audio/AudioEngine";

function part(name: string, muted: boolean): PatternData["parts"][number] {
  return {
    id: name,
    name,
    muted,
    soloed: false,
    volume: 1,
    pan: 0,
    steps: [],
    fx: { ...DEFAULT_CHANNEL_FX },
  };
}

function pattern(mutes: boolean[]): PatternData {
  return {
    id: "p",
    name: "P",
    stepCount: 16,
    stepResolution: "1/16",
    bpm: 120,
    parts: mutes.map((m, i) => part(`P${i + 1}`, m)),
  } as PatternData;
}

describe("Mute-Zustand überlebt den Weg zur Korg und zurück", () => {
  it("schreibt einen stummen Part als stumm in den Pattern-Body", () => {
    const body = synthstudioPatternToBody(pattern([true, false, false]));

    const decoded = decodePatternBody(body);

    expect(decoded?.parts[0].muted).toBe(true);
  });

  it("lässt einen klingenden Part klingend", () => {
    const body = synthstudioPatternToBody(pattern([true, false, false]));

    const decoded = decodePatternBody(body);

    expect(decoded?.parts[1].muted).toBe(false);
  });

  it("hält das Muster über alle 16 Parts durch", () => {
    const muster = Array.from({ length: 16 }, (_, i) => i % 3 === 0);

    const decoded = decodePatternBody(synthstudioPatternToBody(pattern(muster)));

    expect(decoded?.parts.map(p => p.muted)).toEqual(muster);
  });

  it("meldet für ein Init-Pattern ohne Mute-Angabe nichts als stumm", () => {
    const decoded = decodePatternBody(
      synthstudioPatternToBody(pattern(new Array(16).fill(false)))
    );

    expect(decoded?.parts.some(p => p.muted)).toBe(false);
  });
});
