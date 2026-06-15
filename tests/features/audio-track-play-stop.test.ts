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
import { laneStateOnGlobalChange } from "@/components/DrumMachine/audioLaneHelpers";

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

// ─── TASK-267: laneStateOnGlobalChange ────────────────────────────────────────
//
// SUPERSEDES TASK-261 + TASK-252: Diese koppelten den per-Lane Play/Stop-Button
// an den globalen Transport (Button disabled während Global-Play, effectivePlaying
// = playing OR global). TASK-267 entkoppelt den Button — jede Audio-Lane ist nun
// unabhängig vom globalen Transport start-/stoppbar (User: „Die Audio lanes sollen
// auch separat im Sequenzer gestartet und gestoppt werden und nicht nur global.").
//
// `laneStateOnGlobalChange(globalPlaying, { muted, broken })` synchronisiert den
// lokalen `playing`-State auf das, was die Engine bei Global-Play TATSÄCHLICH tut:
// playAllRegisteredAudioTracks() startet nur nicht-gemutete, nicht-broken Tracks.
// So bleibt der lokale State wahrheitsgemäß → der nächste Klick stoppt korrekt.
//
// State-Semantik (dokumentiert via diese Tests):
//  - Manueller Stop einer Lane WÄHREND Global läuft → Voice stirbt, playing=false;
//    nichts restartet sie bis zum nächsten Global stop→play-Zyklus (der ruft
//    playAllRegisteredAudioTracks erneut) ODER einem manuellen Start.
//  - Manueller Start bei Global=OFF → previewt unabhängig.
//  - Der PERSISTENTE „diese Lane vom Global-Playback ausschließen"-Intent ist
//    MUTE (existiert bereits); der per-Lane-Stop ist transient.
describe("laneStateOnGlobalChange — TASK-267 (entkoppelter Lane-Transport)", () => {
  it("global true + nicht gemutet/broken → true (Engine startet die Lane)", () => {
    expect(laneStateOnGlobalChange(true, { muted: false, broken: false })).toBe(
      true,
    );
  });

  it("global true + gemutet → false (playAllRegisteredAudioTracks skippt muted)", () => {
    expect(laneStateOnGlobalChange(true, { muted: true, broken: false })).toBe(
      false,
    );
  });

  it("global true + broken → false (kein Buffer → kann nicht starten)", () => {
    expect(laneStateOnGlobalChange(true, { muted: false, broken: true })).toBe(
      false,
    );
  });

  it("global true + gemutet UND broken → false", () => {
    expect(laneStateOnGlobalChange(true, { muted: true, broken: true })).toBe(
      false,
    );
  });

  it("global false → immer false (Global-Stop killt alle Voices)", () => {
    expect(laneStateOnGlobalChange(false, { muted: false, broken: false })).toBe(
      false,
    );
    expect(laneStateOnGlobalChange(false, { muted: true, broken: false })).toBe(
      false,
    );
    expect(laneStateOnGlobalChange(false, { muted: false, broken: true })).toBe(
      false,
    );
  });

  it("gibt immer einen echten boolean zurück", () => {
    const r = laneStateOnGlobalChange(true, { muted: false, broken: false });
    expect(typeof r).toBe("boolean");
  });
});
