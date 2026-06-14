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
  computeAudioTrackPos01,
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

describe("computeAudioTrackPos01 (TASK-252-FOLLOWUP)", () => {
  // Restrisiko aus TASK-252: Wechsel auf den Sequencer-Tab WÄHREND der globale
  // Transport laeuft → Lane mountet spaet. Der Position-rAF liefert den ersten
  // Wert erst beim naechsten Frame → Playhead blitzt bei 0 auf, obwohl Audio
  // laeuft. getAudioTrackPosition() seedet synchron via dieser reinen Formel.
  // Identische Formel wie der rAF-Tick (sec = offsetSec + elapsed*rate).

  // ── Late-subscribe while playing → liefert > 0 ────────────────────────────
  it("liefert eine Position > 0, wenn der Track bereits seit Sekunden laeuft", () => {
    // Start bei ctx=0, Abfrage bei ctx=2s, 10s-Buffer, rate 1 → 2/10 = 0.2.
    const pos = computeAudioTrackPos01({
      startMeta: { ctxStart: 0, offsetSec: 0 },
      currentTime: 2,
      rate: 1,
      durationSec: 10,
      loop: false,
    });
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeCloseTo(0.2, 5);
  });

  it("beruecksichtigt startOffset + playbackRate (Time-Stretch)", () => {
    // offset 1s + 2s vergangen bei rate 2 → sec = 1 + 4 = 5; /10 = 0.5.
    const pos = computeAudioTrackPos01({
      startMeta: { ctxStart: 3, offsetSec: 1 },
      currentTime: 5,
      rate: 2,
      durationSec: 10,
      loop: false,
    });
    expect(pos).toBeCloseTo(0.5, 5);
  });

  it("wrappt im Loop-Modus modulo statt zu clampen", () => {
    // sec = 25 bei 10s-Buffer → ohne Loop geclampt auf 1.0, mit Loop 0.5.
    const looped = computeAudioTrackPos01({
      startMeta: { ctxStart: 0, offsetSec: 0 },
      currentTime: 25,
      rate: 1,
      durationSec: 10,
      loop: true,
    });
    expect(looped).toBeCloseTo(0.5, 5);
    const clamped = computeAudioTrackPos01({
      startMeta: { ctxStart: 0, offsetSec: 0 },
      currentTime: 25,
      rate: 1,
      durationSec: 10,
      loop: false,
    });
    expect(clamped).toBe(1);
  });

  // ── Nicht spielend / kein Start → liefert 0 ───────────────────────────────
  it("liefert 0, wenn kein startMeta vorhanden ist (Track nicht gestartet)", () => {
    expect(
      computeAudioTrackPos01({
        startMeta: null,
        currentTime: 5,
        rate: 1,
        durationSec: 10,
      }),
    ).toBe(0);
  });

  it("liefert 0 bei nicht-positiver Buffer-Dauer (kein Buffer/unbekannt)", () => {
    expect(
      computeAudioTrackPos01({
        startMeta: { ctxStart: 0, offsetSec: 0 },
        currentTime: 5,
        rate: 1,
        durationSec: 0,
      }),
    ).toBe(0);
  });

  // ── Cleanup/Robustheit: nach Unsubscribe wird kein Snapshot mehr geseedet ──
  // (Die Lane fragt getAudioTrackPosition nur, wenn isAudioTrackPlaying true ist;
  //  ist der Track gestoppt → startMeta null → 0. Hier reine Formel-Garantie.)
  it("liefert 0 bei nicht-finitem ctxStart (defensive Koerzierung)", () => {
    expect(
      computeAudioTrackPos01({
        startMeta: { ctxStart: NaN, offsetSec: 0 },
        currentTime: 5,
        rate: 1,
        durationSec: 10,
      }),
    ).toBe(0);
  });

  it("faellt bei nicht-finiter rate auf rate=1 zurueck (kein NaN-Playhead)", () => {
    // rate=Infinity → koerziert zu 1 → sec = 5, /10 = 0.5 (nicht NaN/0).
    const pos = computeAudioTrackPos01({
      startMeta: { ctxStart: 0, offsetSec: 0 },
      currentTime: 5,
      rate: Infinity,
      durationSec: 10,
    });
    expect(pos).toBeCloseTo(0.5, 5);
  });
});
