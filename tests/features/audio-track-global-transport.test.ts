/**
 * Synthstudio – audio-track-global-transport.test.ts (TASK-252)
 *
 * Deckt die Kopplung der Audio-Clip-Lane an den globalen Transport ab.
 *
 * Hintergrund (Bug "Audio-Channel global steuerbar, Melodie ausschaltbar"):
 * Der Lane-`playing`-State war rein component-local und abonnierte den globalen
 * Transport NICHT. Folge: Global-Play startete Engine-Audio, aber der Lane-Button
 * zeigte weiter "Play" und der Playhead fror; Global-Stop stoppte Engine-Audio,
 * aber die Lane-UI blieb hängen.
 *
 * `shouldLaneFollowGlobalTransport(globalPlaying, laneLocalPlaying)` ist die
 * reine Entscheidungs-Funktion: ergibt sich der *effektive* "spielt"-Zustand
 * einer Lane aus globalem Transport ODER lokalem Vorhör-Play.
 *
 * Reiner Node-Test — kein jsdom/AudioContext (die Funktion lebt in
 * audioLaneHelpers.ts, das KEINE React-/Web-Audio-Runtime zieht).
 */
import { describe, it, expect } from "vitest";
import {
  shouldLaneFollowGlobalTransport,
  isLaneTransportToggleLocked,
} from "@/components/DrumMachine/audioLaneHelpers";

describe("shouldLaneFollowGlobalTransport", () => {
  // ── Happy Path: globaler Transport dominiert ──────────────────────────────
  it("spielt wenn der globale Transport läuft (auch ohne lokales Play)", () => {
    expect(shouldLaneFollowGlobalTransport(true, false)).toBe(true);
  });

  it("spielt wenn nur lokales Vorhör-Play aktiv ist (globaler Transport aus)", () => {
    expect(shouldLaneFollowGlobalTransport(false, true)).toBe(true);
  });

  it("spielt wenn beide aktiv sind", () => {
    expect(shouldLaneFollowGlobalTransport(true, true)).toBe(true);
  });

  // ── Edge: nichts aktiv → nicht spielend ───────────────────────────────────
  it("spielt nicht wenn weder global noch lokal aktiv ist", () => {
    expect(shouldLaneFollowGlobalTransport(false, false)).toBe(false);
  });

  // ── Robustheit: nicht-boolesche/undefined Eingaben werden truthy-koerziert ──
  it("behandelt undefined als nicht-spielend (defensive Koerzierung)", () => {
    expect(
      shouldLaneFollowGlobalTransport(
        undefined as unknown as boolean,
        undefined as unknown as boolean,
      ),
    ).toBe(false);
  });

  it("koerziert truthy/falsy Eingaben zu einem echten boolean", () => {
    const r = shouldLaneFollowGlobalTransport(
      1 as unknown as boolean,
      0 as unknown as boolean,
    );
    expect(r).toBe(true);
    expect(typeof r).toBe("boolean");
  });
});

describe("isLaneTransportToggleLocked", () => {
  // Produkt-Entscheidung (TASK-252): während globaler Transport läuft, ist der
  // per-Lane Play/Stop-Button gesperrt (global gewinnt für Anzeige+Playhead).
  // Der Button dient nur dem isolierten Vorhören solange global gestoppt ist.

  // ── Happy Path ────────────────────────────────────────────────────────────
  it("sperrt den Lane-Toggle während globaler Transport läuft", () => {
    expect(isLaneTransportToggleLocked(true)).toBe(true);
  });

  it("lässt den Lane-Toggle zu wenn globaler Transport gestoppt ist", () => {
    expect(isLaneTransportToggleLocked(false)).toBe(false);
  });

  // ── Edge / Robustheit ─────────────────────────────────────────────────────
  it("behandelt undefined als nicht-gesperrt (Vorhören erlaubt)", () => {
    expect(isLaneTransportToggleLocked(undefined as unknown as boolean)).toBe(
      false,
    );
  });

  it("gibt immer einen echten boolean zurück", () => {
    const r = isLaneTransportToggleLocked(1 as unknown as boolean);
    expect(typeof r).toBe("boolean");
    expect(r).toBe(true);
  });
});
