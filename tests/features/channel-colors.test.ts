/**
 * Synthstudio – channel-colors.test.ts (v3.73.0)
 *
 * Tests für das Channel-Strip Color-Coding (Mixer + DrumMachine).
 * Drei Ebenen:
 *   1. Pure Color-Helpers (Palette, Validierung, Normalisierung, Default-Index)
 *   2. Pure Store-Transform applyPartColorUpdate (Sanitization + Immutability)
 *   3. Serializer Round-Trip (Schema v1.28 + Pre-v1.28 Backward-Compat)
 *
 * Mind. 5 Tests gemäß Task. Tatsächlich: 16 Tests in 5 describes.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHANNEL_COLOR_PALETTE,
  CHANNEL_COLOR_PALETTE_SIZE,
  isValidChannelColor,
  normalizeChannelColor,
  getDefaultChannelColorForIndex,
  resolveChannelColor,
  isPaletteDefaultForIndex,
} from "../../client/src/utils/channelColors";
import { applyPartColorUpdate } from "../../client/src/store/useDrumMachineStore";
import type { PatternData, PartData } from "../../client/src/audio/AudioEngine";
import {
  SYNTH_FILE_VERSION,
  serializeProject,
  parseProject,
  toJson,
  sanitizePartColors,
} from "../../client/src/utils/projectSerializer";

// ─── Test-Fixtures ───────────────────────────────────────────────────────────

function makePart(id: string, color?: string): PartData {
  return {
    id,
    name: id,
    sampleUrl: undefined,
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    stepResolution: undefined,
    steps: [],
    fx: {} as PartData["fx"],
    ...(color !== undefined ? { color } : {}),
  };
}

function makePattern(id: string, parts: PartData[]): PatternData {
  return {
    id,
    name: id,
    parts,
    stepCount: 16,
    bpm: null,
    stepResolution: "1/16",
  } as PatternData;
}

function makeBaseInput() {
  return {
    projectName: "Color-Coding Test",
    bpm: 120,
    samples: [],
    patterns: [makePattern("p1", [makePart("part-1")])],
    activePatternId: "p1",
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: {
      masterVolume: 0.85,
      channels: {},
      returnTracks: {},
      insertChains: {},
      eq16: {},
      sidechains: {},
      transientShapers: {},
    },
    humanizer: { global: {} },
    automation: { lanes: [], stepCount: 16 as const },
  };
}

// ─── 1. Default-Palette ──────────────────────────────────────────────────────

describe("v3.73.0 — Default Color-Palette (8 Farben)", () => {
  it("Palette hat exakt 8 Einträge in der vorgegebenen Reihenfolge", () => {
    expect(CHANNEL_COLOR_PALETTE_SIZE).toBe(8);
    expect(DEFAULT_CHANNEL_COLOR_PALETTE.map((p) => p.id)).toEqual([
      "drum-red",
      "bass-blue",
      "lead-yellow",
      "fx-purple",
      "pad-green",
      "vox-pink",
      "perc-orange",
      "synth-cyan",
    ]);
  });

  it("Alle Palette-Farben sind valide Hex-Strings (#RRGGBB)", () => {
    for (const p of DEFAULT_CHANNEL_COLOR_PALETTE) {
      expect(isValidChannelColor(p.hex)).toBe(true);
      expect(p.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("getDefaultChannelColorForIndex ist zyklisch nach 8", () => {
    // Index 0..7 → palette[0..7]
    for (let i = 0; i < 8; i++) {
      expect(getDefaultChannelColorForIndex(i)).toBe(
        DEFAULT_CHANNEL_COLOR_PALETTE[i].hex,
      );
    }
    // Index 8 → wieder palette[0]
    expect(getDefaultChannelColorForIndex(8)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[0].hex,
    );
    // Index 15 → palette[7]
    expect(getDefaultChannelColorForIndex(15)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[7].hex,
    );
    // Index 16 → palette[0]
    expect(getDefaultChannelColorForIndex(16)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[0].hex,
    );
  });

  it("Defensive bei negativen/NaN/Infinity Indices", () => {
    expect(getDefaultChannelColorForIndex(-1)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[0].hex,
    );
    expect(getDefaultChannelColorForIndex(NaN)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[0].hex,
    );
    expect(getDefaultChannelColorForIndex(Infinity)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[0].hex,
    );
  });
});

// ─── 2. Hex-Validierung ──────────────────────────────────────────────────────

describe("v3.73.0 — Color-Picker validiert Hex-Format", () => {
  it("isValidChannelColor: #RRGGBB und #RGB werden akzeptiert", () => {
    expect(isValidChannelColor("#ef4444")).toBe(true);
    expect(isValidChannelColor("#EF4444")).toBe(true); // case-insensitive
    expect(isValidChannelColor("#abc")).toBe(true);    // #RGB short-form
    expect(isValidChannelColor("#ABC")).toBe(true);
  });

  it("isValidChannelColor lehnt invalides Format ab", () => {
    expect(isValidChannelColor("")).toBe(false);
    expect(isValidChannelColor("ef4444")).toBe(false);     // fehlende #
    expect(isValidChannelColor("#ef44")).toBe(false);      // falsche Länge
    expect(isValidChannelColor("#gg4444")).toBe(false);    // non-hex char
    expect(isValidChannelColor("#ef4444 ")).toBe(false);   // trailing space
    expect(isValidChannelColor("red")).toBe(false);        // CSS name nicht erlaubt
    expect(isValidChannelColor("rgb(1,2,3)")).toBe(false); // RGB-Notation nicht erlaubt
    expect(isValidChannelColor(null)).toBe(false);
    expect(isValidChannelColor(undefined)).toBe(false);
    expect(isValidChannelColor(123)).toBe(false);
    expect(isValidChannelColor({})).toBe(false);
  });

  it("normalizeChannelColor: lowercase + undefined für invalid", () => {
    expect(normalizeChannelColor("#EF4444")).toBe("#ef4444");
    expect(normalizeChannelColor("#ABC")).toBe("#abc");
    expect(normalizeChannelColor("invalid")).toBeUndefined();
    expect(normalizeChannelColor("")).toBeUndefined();
    expect(normalizeChannelColor(null)).toBeUndefined();
    expect(normalizeChannelColor(undefined)).toBeUndefined();
  });

  it("resolveChannelColor: explicit > palette[index]", () => {
    expect(resolveChannelColor("#FF00FF", 0)).toBe("#ff00ff");
    expect(resolveChannelColor(undefined, 0)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[0].hex,
    );
    expect(resolveChannelColor(null, 1)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[1].hex,
    );
    expect(resolveChannelColor("invalid", 2)).toBe(
      DEFAULT_CHANNEL_COLOR_PALETTE[2].hex,
    );
  });

  it("isPaletteDefaultForIndex: erkennt Match mit Palette + Reset-Zustand", () => {
    expect(isPaletteDefaultForIndex(undefined, 0)).toBe(true);
    expect(isPaletteDefaultForIndex(null, 0)).toBe(true);
    expect(
      isPaletteDefaultForIndex(
        DEFAULT_CHANNEL_COLOR_PALETTE[0].hex.toUpperCase(),
        0,
      ),
    ).toBe(true); // case-insensitive
    expect(isPaletteDefaultForIndex("#ff00ff", 0)).toBe(false);
    expect(isPaletteDefaultForIndex("invalid", 0)).toBe(true); // invalid → fallback default
  });
});

// ─── 3. Store-Action: applyPartColorUpdate ───────────────────────────────────

describe("v3.73.0 — applyPartColorUpdate (Pure-Transform)", () => {
  it("setChannelColor updates store — valider Hex wird lowercased gespeichert", () => {
    const pattern = makePattern("pat", [makePart("p1"), makePart("p2")]);
    const [result] = applyPartColorUpdate([pattern], "p1", "#EF4444");
    expect(result.parts.find((p) => p.id === "p1")?.color).toBe("#ef4444");
    expect(result.parts.find((p) => p.id === "p2")?.color).toBeUndefined();
  });

  it("Reset auf Palette-Default: undefined entfernt die Color", () => {
    const pattern = makePattern("pat", [makePart("p1", "#ef4444")]);
    const [result] = applyPartColorUpdate([pattern], "p1", undefined);
    expect(result.parts.find((p) => p.id === "p1")?.color).toBeUndefined();
  });

  it("Invalider Color-String → silent als undefined (defensive Reset)", () => {
    const pattern = makePattern("pat", [makePart("p1", "#ef4444")]);
    const [result] = applyPartColorUpdate([pattern], "p1", "not-a-hex");
    // Invalid → normalisiert zu undefined → color wird gelöscht
    expect(result.parts.find((p) => p.id === "p1")?.color).toBeUndefined();
  });

  it("Cross-Pattern: wirkt auf alle Patterns mit derselben Part-ID", () => {
    const patterns = [
      makePattern("pat1", [makePart("p1"), makePart("p2")]),
      makePattern("pat2", [makePart("p1"), makePart("p2")]),
    ];
    const result = applyPartColorUpdate(patterns, "p1", "#3b82f6");
    for (const p of result) {
      expect(p.parts.find((pt) => pt.id === "p1")?.color).toBe("#3b82f6");
      expect(p.parts.find((pt) => pt.id === "p2")?.color).toBeUndefined();
    }
  });

  it("Immutability: gibt neue Array+Pattern+Parts-Referenzen zurück", () => {
    const patterns = [makePattern("pat", [makePart("p1")])];
    const result = applyPartColorUpdate(patterns, "p1", "#22c55e");
    expect(result).not.toBe(patterns);
    expect(result[0]).not.toBe(patterns[0]);
    expect(result[0].parts).not.toBe(patterns[0].parts);
  });
});

// ─── 4. Schema v1.28 Round-Trip ──────────────────────────────────────────────

describe("v3.73.0 — Schema v1.28 Round-Trip + Backward-Compat", () => {
  it("SYNTH_FILE_VERSION ist '1.28'", () => {
    expect(SYNTH_FILE_VERSION).toBe("1.28");
  });

  it("Schema v1.28 Round-Trip: PartData.color wird preserved", () => {
    const input = makeBaseInput();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (input.patterns[0].parts[0] as any).color = "#ef4444";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ser = serializeProject(input as any);
    const json = toJson(ser);
    const parsed = parseProject(json);
    expect(parsed.version).toBe("1.28");
    expect(parsed.patterns[0].parts[0].color).toBe("#ef4444");
  });

  it("Pre-v1.28 lädt mit auto-color (color bleibt undefined → UI fällt auf Palette-Default)", () => {
    const preV128 = {
      version: "1.27",
      savedAt: new Date().toISOString(),
      projectName: "Pre-v1.28",
      bpm: 120,
      samples: [],
      patterns: [
        {
          id: "p1",
          name: "P",
          parts: [
            // KEIN color-Feld — pre-v1.28
            {
              id: "part-1",
              name: "Kick",
              muted: false,
              soloed: false,
              volume: 1,
              pan: 0,
              steps: [],
              fx: {},
            },
          ],
          stepCount: 16,
          stepResolution: "1/16",
        },
      ],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {},
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(preV128));
    expect(parsed.version).toBe("1.27"); // source version preserved
    expect(parsed.patterns[0].parts[0].color).toBeUndefined();
  });

  it("sanitizePartColors: invalider color-String → silent gestrippt", () => {
    const patterns = [
      {
        id: "p1",
        name: "P",
        parts: [
          { id: "pt1", color: "not-a-hex" },
          { id: "pt2", color: "#EF4444" }, // valid → normalisiert lowercased
          { id: "pt3", color: null },      // null → entfernt
          { id: "pt4" },                    // kein color-Feld → unangetastet
        ],
      },
    ];
    sanitizePartColors(patterns);
    expect(("color" in patterns[0].parts[0])).toBe(false);
    expect(patterns[0].parts[1].color).toBe("#ef4444");
    expect(("color" in patterns[0].parts[2])).toBe(false);
    expect(("color" in patterns[0].parts[3])).toBe(false);
  });

  it("Schema-Bump: Pre-v1.28-Files mit gemischten color-Werten landen sauber", () => {
    const file = {
      version: "1.27",
      savedAt: new Date().toISOString(),
      projectName: "Mixed",
      bpm: 120,
      samples: [],
      patterns: [
        {
          id: "p1",
          name: "P",
          parts: [
            { id: "pt1", name: "A", muted: false, soloed: false, volume: 1, pan: 0, steps: [], fx: {}, color: "#3b82f6" },
            { id: "pt2", name: "B", muted: false, soloed: false, volume: 1, pan: 0, steps: [], fx: {}, color: "garbage" },
            { id: "pt3", name: "C", muted: false, soloed: false, volume: 1, pan: 0, steps: [], fx: {} },
          ],
          stepCount: 16,
          stepResolution: "1/16",
        },
      ],
      activePatternId: "p1",
      song: { slots: [], songModeActive: false, loopSong: false },
      mixer: {
        masterVolume: 0.85,
        channels: {},
        returnTracks: {},
        insertChains: {},
        eq16: {},
        sidechains: {},
        transientShapers: {},
      },
      humanizer: { global: {} },
      automation: { lanes: [], stepCount: 16 },
    };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.patterns[0].parts[0].color).toBe("#3b82f6");
    expect(parsed.patterns[0].parts[1].color).toBeUndefined();
    expect(parsed.patterns[0].parts[2].color).toBeUndefined();
  });
});

// ─── 5. resolveChannelColor Integration (UI-Path) ────────────────────────────

describe("v3.73.0 — resolveChannelColor liefert IMMER einen validen Hex", () => {
  it("Liefert valide Hex-Strings für 0..15 Indices", () => {
    for (let i = 0; i < 16; i++) {
      const c = resolveChannelColor(undefined, i);
      expect(isValidChannelColor(c)).toBe(true);
    }
  });

  it("Explicit-Color überschreibt Palette-Default", () => {
    expect(resolveChannelColor("#abcdef", 0)).toBe("#abcdef");
    // Index 0 = drum-red, aber user setzt cyan → cyan gewinnt
    expect(resolveChannelColor("#06b6d4", 0)).toBe("#06b6d4");
  });
});
