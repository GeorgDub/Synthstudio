/**
 * tests/features/audio-clip-lane.test.ts (TASK-246)
 *
 * Unit-Tests für die pure Render-Logik der Continuous-Audio-Clip-Lanes
 * (client/src/components/DrumMachine/audioLaneHelpers.ts).
 *
 * Hintergrund: Audio-Tracks erscheinen jetzt als durchgehende Wellenform-Lane
 * im Sequencer (Option B). Die "welche Tracks ergeben Lanes"- und Mute/Solo-
 * Audibility-Regeln sind als pure Funktionen extrahiert, damit sie ohne
 * jsdom/AudioContext in Node testbar sind (die Canvas-/React-UI ist es nicht).
 *
 * Abgedeckt pro Funktion: Happy / Edge / (Persistence-analog: stabile
 * Reihenfolge + defensive Eingaben).
 */
import { describe, it, expect } from "vitest";
import {
  resolveAudioLanes,
  anyAudioTrackSoloed,
  isAudioLaneAudible,
  audioLaneLabelColorClass,
  type AudioLaneTrackLike,
} from "@/components/DrumMachine/audioLaneHelpers";

function t(
  id: string,
  over: Partial<AudioLaneTrackLike> = {},
): AudioLaneTrackLike {
  return { id, muted: false, soloed: false, ...over };
}

// ─── resolveAudioLanes ─────────────────────────────────────────────────────────

describe("resolveAudioLanes — Happy Path", () => {
  it("liefert jeden Track als Lane (1 Track = 1 Lane)", () => {
    const tracks = [t("audiotrack:a"), t("audiotrack:b")];
    const lanes = resolveAudioLanes(tracks);
    expect(lanes).toHaveLength(2);
    expect(lanes.map((l) => l.id)).toEqual(["audiotrack:a", "audiotrack:b"]);
  });

  it("erhält die Reihenfolge der Tracks (stabile Lane-Order)", () => {
    const tracks = [t("z"), t("a"), t("m")];
    expect(resolveAudioLanes(tracks).map((l) => l.id)).toEqual(["z", "a", "m"]);
  });
});

describe("resolveAudioLanes — Edge", () => {
  it("leeres Array → keine Lanes", () => {
    expect(resolveAudioLanes([])).toEqual([]);
  });

  it("null/undefined → [] (defensive)", () => {
    expect(resolveAudioLanes(null)).toEqual([]);
    expect(resolveAudioLanes(undefined)).toEqual([]);
  });

  it("verwirft Items ohne valide id (kein React-Key möglich)", () => {
    const tracks = [
      t("ok"),
      { id: "", muted: false, soloed: false } as AudioLaneTrackLike,
      null as unknown as AudioLaneTrackLike,
    ];
    expect(resolveAudioLanes(tracks).map((l) => l.id)).toEqual(["ok"]);
  });
});

// ─── anyAudioTrackSoloed ───────────────────────────────────────────────────────

describe("anyAudioTrackSoloed", () => {
  it("true wenn mindestens ein Track soloed ist", () => {
    expect(anyAudioTrackSoloed([t("a"), t("b", { soloed: true })])).toBe(true);
  });

  it("false wenn kein Track soloed ist", () => {
    expect(anyAudioTrackSoloed([t("a"), t("b")])).toBe(false);
  });

  it("false für leere/null Eingabe", () => {
    expect(anyAudioTrackSoloed([])).toBe(false);
    expect(anyAudioTrackSoloed(null)).toBe(false);
  });
});

// ─── isAudioLaneAudible ────────────────────────────────────────────────────────

describe("isAudioLaneAudible — kein Solo aktiv", () => {
  it("nicht-gemuteter Track ist hörbar", () => {
    const a = t("a");
    expect(isAudioLaneAudible(a, [a, t("b")])).toBe(true);
  });

  it("gemuteter Track ist nicht hörbar", () => {
    const a = t("a", { muted: true });
    expect(isAudioLaneAudible(a, [a, t("b")])).toBe(false);
  });
});

describe("isAudioLaneAudible — Solo-Gruppe aktiv", () => {
  it("nur soloed Tracks sind hörbar wenn ein Solo aktiv ist", () => {
    const a = t("a", { soloed: true });
    const b = t("b");
    expect(isAudioLaneAudible(a, [a, b])).toBe(true);
    expect(isAudioLaneAudible(b, [a, b])).toBe(false);
  });

  it("soloed + muted → trotzdem stumm (Mute schlägt Solo)", () => {
    const a = t("a", { soloed: true, muted: true });
    expect(isAudioLaneAudible(a, [a])).toBe(false);
  });
});

// ─── audioLaneLabelColorClass ──────────────────────────────────────────────────

describe("audioLaneLabelColorClass — semantische Tokens", () => {
  it("broken hat höchste Priorität", () => {
    expect(
      audioLaneLabelColorClass({ broken: true, muted: true, soloed: true }),
    ).toBe("text-accent-danger");
  });

  it("muted vor soloed", () => {
    expect(
      audioLaneLabelColorClass({ broken: false, muted: true, soloed: true }),
    ).toBe("text-text-dim");
  });

  it("soloed wenn weder broken noch muted", () => {
    expect(
      audioLaneLabelColorClass({ broken: false, muted: false, soloed: true }),
    ).toBe("text-accent-primary");
  });

  it("default = text-primary", () => {
    expect(
      audioLaneLabelColorClass({ broken: false, muted: false, soloed: false }),
    ).toBe("text-text-primary");
  });

  it("nutzt ausschließlich --ss-*-gebundene semantische Klassen", () => {
    const all = [
      audioLaneLabelColorClass({ broken: true, muted: false, soloed: false }),
      audioLaneLabelColorClass({ broken: false, muted: true, soloed: false }),
      audioLaneLabelColorClass({ broken: false, muted: false, soloed: true }),
      audioLaneLabelColorClass({ broken: false, muted: false, soloed: false }),
    ];
    // Keine hardcodierten Tailwind-Paletten (slate/cyan/gray/zinc …).
    for (const cls of all) {
      expect(cls).not.toMatch(/slate|cyan|gray|zinc|neutral|stone/);
      expect(cls).toMatch(/^text-(accent-(danger|primary)|text-(dim|primary))$/);
    }
  });
});
