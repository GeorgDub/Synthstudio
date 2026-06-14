/**
 * tests/features/audio-track-play-stop.test.ts (TASK-245)
 *
 * Unit-Tests für die Per-Track Play/Stop State-Machine im AudioTrackStrip.
 *
 * Hintergrund: Ein importierter/aufgenommener Audio-Track hatte keinen eigenen
 * Play-Button — Playback hing nur am Global-Transport. Die Engine-API
 * (playAudioTrack/stopAudioTrack/onAudioTrackEnded) existierte bereits.
 *
 * Getestet wird die exportierte pure Transition-Funktion
 * `nextAudioTrackPlayState`, die den component-local `playing`-State steuert.
 * Der React-Komponenten-State selbst ist in Node (kein RTL/AudioContext) nicht
 * sinnvoll testbar — deshalb ist die State-Logik als pure Funktion extrahiert.
 *
 * Abgedeckt:
 *  - Happy: play → true, stop → false, toggle invertiert
 *  - Edge: ended-Event setzt playing zurück (onAudioTrackEnded-Pfad)
 *  - Idempotenz: play während playing bleibt true (Replay),
 *                stop während stopped bleibt false
 *  - broken: jeder Start wird blockiert (kein Buffer → konservativ false)
 */
import { describe, it, expect } from "vitest";
import { nextAudioTrackPlayState } from "@/components/Mixer/AudioTrackStrip";

describe("nextAudioTrackPlayState — Happy Path", () => {
  it("play startet die Wiedergabe (false → true)", () => {
    expect(nextAudioTrackPlayState(false, "play")).toBe(true);
  });

  it("stop beendet die Wiedergabe (true → false)", () => {
    expect(nextAudioTrackPlayState(true, "stop")).toBe(false);
  });

  it("toggle invertiert beide Richtungen", () => {
    expect(nextAudioTrackPlayState(false, "toggle")).toBe(true);
    expect(nextAudioTrackPlayState(true, "toggle")).toBe(false);
  });
});

describe("nextAudioTrackPlayState — Edge (ended-Event)", () => {
  it("ended setzt einen laufenden Track auf false (natürliches Ende)", () => {
    expect(nextAudioTrackPlayState(true, "ended")).toBe(false);
  });

  it("ended auf bereits gestopptem Track bleibt false (idempotent)", () => {
    expect(nextAudioTrackPlayState(false, "ended")).toBe(false);
  });
});

describe("nextAudioTrackPlayState — Idempotenz", () => {
  it("play während playing bleibt true (Replay)", () => {
    expect(nextAudioTrackPlayState(true, "play")).toBe(true);
  });

  it("stop während stopped bleibt false", () => {
    expect(nextAudioTrackPlayState(false, "stop")).toBe(false);
  });
});

describe("nextAudioTrackPlayState — broken Track", () => {
  it("blockiert play wenn die Datei broken ist (kein Buffer)", () => {
    expect(nextAudioTrackPlayState(false, "play", { broken: true })).toBe(false);
  });

  it("blockiert toggle wenn broken (kann nicht gestartet werden)", () => {
    expect(nextAudioTrackPlayState(false, "toggle", { broken: true })).toBe(false);
  });

  it("erzwingt false auch wenn aktuell true + broken", () => {
    expect(nextAudioTrackPlayState(true, "play", { broken: true })).toBe(false);
    expect(nextAudioTrackPlayState(true, "toggle", { broken: true })).toBe(false);
  });

  it("broken=false verhält sich wie der Default-Pfad", () => {
    expect(nextAudioTrackPlayState(false, "play", { broken: false })).toBe(true);
  });
});
