/**
 * tests/features/midi-mapping-share.test.ts
 *
 * v3.64.0 — MIDI-Mapping JSON-Sharing (Export/Import) analog v3.47
 * Plugin-Preset-Sharing.
 *
 * Coverage:
 *   - buildMidiMappingShareJson liefert v2-Envelope mit korrektem Schema
 *   - parseMidiMappingShareJson akzeptiert v2-Envelope
 *   - parseMidiMappingShareJson migriert v1-Layouts (Backward-Compat)
 *   - applyMappingShareImport in merge-mode dedupliziert (cc+channel)
 *   - applyMappingShareImport in replace-mode ersetzt alles
 *   - Missing-Targets-Handling: unbekannte partIds werden gemeldet
 *   - Schema-Validation: unbekanntes Schema → clean reject
 *   - Round-Trip: export → import = identische ccMappings + noteMappings
 *   - Drag-Drop: `.synthmidi.json` routet zu "midi-mapping:import"
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";

import {
  MIDI_MAPPING_SHARE_SCHEMA,
  MIDI_MAPPING_SHARE_SUFFIX,
  buildMidiMappingShareJson,
  parseMidiMappingShareJson,
  applyMappingShareImport,
  sanitizeMappingFileName,
} from "../../client/src/utils/midiMappingShare";
import { buildMidiLayoutJson } from "../../client/src/utils/midiLayoutExport";
import {
  detectFileType,
  dispatchFileDrop,
  MIDI_MAPPING_SUFFIX,
} from "../../client/src/utils/dragDropDispatch";
import type { MidiMapping, MidiNoteMapping } from "../../client/src/hooks/useMidi";

// Sample-Daten
const sampleCc: MidiMapping[] = [
  { cc: 1, channel: 0, target: { type: "bpm" }, label: "Mod → BPM" },
  { cc: 7, channel: 0, target: { type: "masterVolume" }, label: "Master" },
];
const sampleNotes: MidiNoteMapping[] = [
  { note: 36, channel: 9, partId: "kick", label: "Kick" },
  { note: 38, channel: 9, partId: "snare", label: "Snare", performancePadIndex: 2 },
];

describe("v3.64 — buildMidiMappingShareJson liefert valides v2-Schema", () => {
  it("v2-Envelope mit Schema-Tag + meta + Mappings", () => {
    const json = buildMidiMappingShareJson({
      meta: {
        name: "Mein Setup",
        description: "Studio MK2",
        hardwareHint: "Akai MPK Mini",
        author: "georg",
        appVersion: "3.64.0",
      },
      ccMappings: sampleCc,
      noteMappings: sampleNotes,
    });
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe(MIDI_MAPPING_SHARE_SCHEMA);
    expect(parsed.meta.name).toBe("Mein Setup");
    expect(parsed.meta.description).toBe("Studio MK2");
    expect(parsed.meta.hardwareHint).toBe("Akai MPK Mini");
    expect(parsed.meta.author).toBe("georg");
    expect(parsed.meta.appVersion).toBe("3.64.0");
    expect(typeof parsed.meta.createdAt).toBe("number");
    expect(parsed.ccMappings).toHaveLength(2);
    expect(parsed.noteMappings).toHaveLength(2);
    expect(parsed.noteMappings[1].performancePadIndex).toBe(2);
  });

  it("Pretty-printed JSON (Newlines + Indent)", () => {
    const json = buildMidiMappingShareJson({
      meta: { name: "x" },
      ccMappings: sampleCc,
      noteMappings: [],
    });
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });

  it("setzt createdAt automatisch wenn nicht gegeben", () => {
    const before = Date.now();
    const json = buildMidiMappingShareJson({
      meta: { name: "Auto" },
      ccMappings: sampleCc,
      noteMappings: [],
    });
    const parsed = JSON.parse(json);
    expect(parsed.meta.createdAt).toBeGreaterThanOrEqual(before);
  });
});

describe("v3.64 — parseMidiMappingShareJson v2", () => {
  it("akzeptiert valides v2-Envelope", () => {
    const json = buildMidiMappingShareJson({
      meta: { name: "Test", author: "me" },
      ccMappings: sampleCc,
      noteMappings: sampleNotes,
    });
    const r = parseMidiMappingShareJson(json);
    expect(r.success).toBe(true);
    expect(r.envelope).toBeDefined();
    expect(r.envelope!.meta.name).toBe("Test");
    expect(r.envelope!.meta.author).toBe("me");
    expect(r.envelope!.ccMappings).toHaveLength(2);
    expect(r.envelope!.noteMappings).toHaveLength(2);
    expect(r.migratedFromV1).toBeUndefined();
  });

  it("rejected leeres File", () => {
    const r = parseMidiMappingShareJson("");
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/leer/i);
  });

  it("rejected unbekanntes Schema", () => {
    const r = parseMidiMappingShareJson(
      JSON.stringify({ schema: "some-other-app-v9", ccMappings: [], noteMappings: [] }),
    );
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/schema/i);
  });

  it("rejected fehlende meta.name", () => {
    const r = parseMidiMappingShareJson(
      JSON.stringify({
        schema: MIDI_MAPPING_SHARE_SCHEMA,
        meta: {},
        ccMappings: sampleCc,
        noteMappings: [],
      }),
    );
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/meta.name/i);
  });

  it("rejected Envelope ohne Mappings (alles leer)", () => {
    const r = parseMidiMappingShareJson(
      JSON.stringify({
        schema: MIDI_MAPPING_SHARE_SCHEMA,
        meta: { name: "Empty" },
        ccMappings: [],
        noteMappings: [],
      }),
    );
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/keine gültigen/i);
  });

  it("skipt einzelne ungültige cc-Einträge mit warning", () => {
    const r = parseMidiMappingShareJson(
      JSON.stringify({
        schema: MIDI_MAPPING_SHARE_SCHEMA,
        meta: { name: "Mixed" },
        ccMappings: [
          { cc: 1, channel: 0, target: { type: "bpm" }, label: "ok" },
          { cc: 999, channel: 0, target: { type: "bpm" }, label: "bad cc" },
          { cc: 5, channel: 0, target: { type: "totally-unknown" }, label: "bad target" },
        ],
        noteMappings: [],
      }),
    );
    expect(r.success).toBe(true);
    expect(r.envelope!.ccMappings).toHaveLength(1);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("v3.64 — Backward-Compat v1-Layout-Migration", () => {
  it("akzeptiert v1-Layout-JSON und migriert auf v2", () => {
    const v1Json = buildMidiLayoutJson({
      name: "Legacy Setup",
      ccMappings: sampleCc,
      noteMappings: sampleNotes,
    });
    const r = parseMidiMappingShareJson(v1Json);
    expect(r.success).toBe(true);
    expect(r.migratedFromV1).toBe(true);
    expect(r.envelope!.schema).toBe(MIDI_MAPPING_SHARE_SCHEMA);
    expect(r.envelope!.meta.name).toBe("Legacy Setup");
    expect(r.envelope!.ccMappings).toHaveLength(2);
    expect(r.envelope!.noteMappings).toHaveLength(2);
  });
});

describe("v3.64 — applyMappingShareImport merge vs replace", () => {
  it("replace-mode setzt alles neu", () => {
    const envelope = {
      schema: MIDI_MAPPING_SHARE_SCHEMA as typeof MIDI_MAPPING_SHARE_SCHEMA,
      meta: { name: "R" },
      ccMappings: sampleCc,
      noteMappings: sampleNotes,
    };
    const existing = {
      ccMappings: [
        { cc: 99, channel: 0, target: { type: "bpm" as const }, label: "old" },
      ],
      noteMappings: [
        { note: 60, channel: 0, partId: "old", label: "old" },
      ],
    };
    const r = applyMappingShareImport(envelope, existing, "replace");
    expect(r.ccMappings).toHaveLength(2);
    expect(r.noteMappings).toHaveLength(2);
    expect(r.ccMappings.find((m) => m.cc === 99)).toBeUndefined();
    expect(r.addedCount).toBe(4);
  });

  it("merge-mode überschreibt cc+channel-Kollisionen, hängt sonst an", () => {
    const envelope = {
      schema: MIDI_MAPPING_SHARE_SCHEMA as typeof MIDI_MAPPING_SHARE_SCHEMA,
      meta: { name: "M" },
      ccMappings: [
        { cc: 1, channel: 0, target: { type: "bpm" as const }, label: "neu CC1" },
        { cc: 50, channel: 0, target: { type: "tapTempo" as const }, label: "neu CC50" },
      ],
      noteMappings: [],
    };
    const existing = {
      ccMappings: [
        { cc: 1, channel: 0, target: { type: "playStop" as const }, label: "alt CC1" },
        { cc: 7, channel: 0, target: { type: "masterVolume" as const }, label: "alt CC7" },
      ],
      noteMappings: [],
    };
    const r = applyMappingShareImport(envelope, existing, "merge");
    expect(r.ccMappings).toHaveLength(3); // 1 (überschrieben), 7 (alt), 50 (neu)
    expect(r.ccMappings.find((m) => m.cc === 1)?.label).toBe("neu CC1");
    expect(r.ccMappings.find((m) => m.cc === 7)?.label).toBe("alt CC7");
    expect(r.replacedCount).toBe(1);
    expect(r.addedCount).toBe(1);
  });

  it("merge: existing note+channel wird überschrieben", () => {
    const envelope = {
      schema: MIDI_MAPPING_SHARE_SCHEMA as typeof MIDI_MAPPING_SHARE_SCHEMA,
      meta: { name: "M2" },
      ccMappings: [],
      noteMappings: [
        { note: 36, channel: 9, partId: "kick-new", label: "Kick neu" },
      ],
    };
    const existing = {
      ccMappings: [],
      noteMappings: [
        { note: 36, channel: 9, partId: "kick-alt", label: "Kick alt" },
        { note: 38, channel: 9, partId: "snare", label: "Snare" },
      ],
    };
    const r = applyMappingShareImport(envelope, existing, "merge");
    expect(r.noteMappings).toHaveLength(2);
    expect(r.noteMappings.find((m) => m.note === 36)?.partId).toBe("kick-new");
    expect(r.replacedCount).toBe(1);
  });
});

describe("v3.64 — Missing-Target Handling", () => {
  it("liefert missingPartIds wenn knownPartIds gegeben", () => {
    const envelope = {
      schema: MIDI_MAPPING_SHARE_SCHEMA as typeof MIDI_MAPPING_SHARE_SCHEMA,
      meta: { name: "X" },
      ccMappings: [],
      noteMappings: [
        { note: 36, channel: 9, partId: "kick", label: "Kick" },
        { note: 38, channel: 9, partId: "ghost-snare", label: "Ghost" },
        { note: 42, channel: 9, partId: "ghost-hat", label: "Ghost HH" },
      ],
    };
    const r = applyMappingShareImport(envelope, { ccMappings: [], noteMappings: [] }, "replace", [
      "kick",
      "tom",
    ]);
    expect(r.missingPartIds.sort()).toEqual(["ghost-hat", "ghost-snare"]);
    // Mappings werden trotzdem behalten
    expect(r.noteMappings).toHaveLength(3);
  });

  it("liefert leere Missing-Liste wenn knownPartIds=[]", () => {
    const envelope = {
      schema: MIDI_MAPPING_SHARE_SCHEMA as typeof MIDI_MAPPING_SHARE_SCHEMA,
      meta: { name: "X" },
      ccMappings: [],
      noteMappings: [
        { note: 36, channel: 9, partId: "kick", label: "Kick" },
      ],
    };
    const r = applyMappingShareImport(envelope, { ccMappings: [], noteMappings: [] }, "replace");
    expect(r.missingPartIds).toHaveLength(0);
  });
});

describe("v3.64 — Round-Trip export → import", () => {
  it("preserves ccMappings + noteMappings exact", () => {
    const json = buildMidiMappingShareJson({
      meta: {
        name: "Round-Trip-Test",
        description: "All-feature mapping",
        hardwareHint: "MPC One",
        author: "tester",
        createdAt: 1700000000000,
        appVersion: "3.64.0",
      },
      ccMappings: sampleCc,
      noteMappings: sampleNotes,
    });
    const r = parseMidiMappingShareJson(json);
    expect(r.success).toBe(true);
    const env = r.envelope!;
    expect(env.meta.name).toBe("Round-Trip-Test");
    expect(env.meta.description).toBe("All-feature mapping");
    expect(env.meta.hardwareHint).toBe("MPC One");
    expect(env.meta.author).toBe("tester");
    expect(env.meta.createdAt).toBe(1700000000000);
    expect(env.meta.appVersion).toBe("3.64.0");
    expect(env.ccMappings).toEqual(sampleCc);
    // Note-Mappings inkl. performancePadIndex
    expect(env.noteMappings).toEqual(sampleNotes);
  });
});

describe("v3.64 — sanitizeMappingFileName", () => {
  it("strippt Path-Separatoren und Sonder-Chars", () => {
    expect(sanitizeMappingFileName("Mein Setup / v2!")).toBe("Mein-Setup-v2");
  });
  it("Fallback wenn leer", () => {
    expect(sanitizeMappingFileName("!!!")).toBe("midi-mapping");
    expect(sanitizeMappingFileName("")).toBe("midi-mapping");
  });
  it("Unicode-Umlaute bleiben", () => {
    expect(sanitizeMappingFileName("Schöne Mappings")).toBe("Schöne-Mappings");
  });
});

describe("v3.64 — Drag-Drop Routing", () => {
  it(".synthmidi.json wird als 'midi-mapping' erkannt", () => {
    expect(detectFileType("mein-setup.synthmidi.json")).toBe("midi-mapping");
    expect(detectFileType("foo.SYNTHMIDI.JSON")).toBe("midi-mapping");
    // Normales .json bleibt unknown (kein false-positive)
    expect(detectFileType("layout.json")).toBe("unknown");
  });

  it("MIDI_MAPPING_SUFFIX-Konstante matched share-Modul-Suffix", () => {
    expect(MIDI_MAPPING_SUFFIX).toBe(MIDI_MAPPING_SHARE_SUFFIX);
  });

  it("dispatchFileDrop für .synthmidi.json feuert 'midi-mapping:import'", () => {
    const received: { type: string; detail: unknown }[] = [];
    const handler = (e: Event) => {
      received.push({ type: e.type, detail: (e as CustomEvent).detail });
    };
    window.addEventListener("midi-mapping:import", handler);
    try {
      const fakeFile = { name: "mein-mapping.synthmidi.json" };
      const result = dispatchFileDrop(fakeFile);
      expect(result.handled).toBe(true);
      expect(result.type).toBe("midi-mapping");
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("midi-mapping:import");
    } finally {
      window.removeEventListener("midi-mapping:import", handler);
    }
  });
});
