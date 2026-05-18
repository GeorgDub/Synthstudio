/**
 * tests/features/sample-library-tags.test.ts (v3.54.0)
 *
 * Unit-Tests für die Sample-Library Tag-Pipeline.
 *
 * Coverage:
 *  - addTagToSample / removeTagFromSample (Pure-fn, idempotent)
 *  - filterByTags AND/OR-Mode
 *  - matchesSearchQuery (Name + Tag-Substring)
 *  - applyAutoTagsFromFilename (autoTagFromFilename-Integration)
 *  - extractAllTags / applySampleFilters Komposit
 *  - Backward-Compat: Samples ohne `tags`-Feld
 *
 * env: node — pure functions, kein DOM nötig.
 */
import { describe, it, expect } from "vitest";
import type { Sample } from "@/store/useProjectStore";
import {
  addTagToSample,
  removeTagFromSample,
  setSampleTags,
  filterByTags,
  filterByCategory,
  matchesSearchQuery,
  applyAutoTagsFromFilename,
  extractAllTags,
  applySampleFilters,
  normalizeTag,
  getSampleTags,
  getTopTagSuggestions,
  COMMON_TAG_SUGGESTIONS,
} from "@/utils/sampleLibrary";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSample(overrides: Partial<Sample> = {}): Sample {
  return {
    id: "s1",
    name: "Kick 01.wav",
    path: "/samples/Kick 01.wav",
    category: "drum",
    ...overrides,
  };
}

// ─── Tests: Tag-Mutations ────────────────────────────────────────────────────

describe("v3.54.0 — addTagToSample / removeTagFromSample", () => {
  it("addTagToSample + removeTagFromSample round-trip", () => {
    const s = makeSample();
    const s1 = addTagToSample(s, "kick");
    expect(s1.tags).toEqual(["kick"]);
    // Original NICHT mutiert (immutable)
    expect(s.tags).toBeUndefined();

    const s2 = removeTagFromSample(s1, "kick");
    expect(s2.tags).toEqual([]);
  });

  it("addTagToSample ist idempotent (Duplikate werden nicht angehängt)", () => {
    const s = makeSample({ tags: ["kick"] });
    const s1 = addTagToSample(s, "kick");
    // Gleiche Referenz: kein neues Objekt bei No-Op
    expect(s1).toBe(s);
    expect(s1.tags).toEqual(["kick"]);
  });

  it("addTagToSample normalisiert Tags (lowercase + trim)", () => {
    const s = makeSample();
    const s1 = addTagToSample(s, "  KICK  ");
    expect(s1.tags).toEqual(["kick"]);
  });

  it("addTagToSample ignoriert leere und whitespace-only Tags", () => {
    const s = makeSample();
    expect(addTagToSample(s, "")).toBe(s);
    expect(addTagToSample(s, "   ")).toBe(s);
  });

  it("removeTagFromSample auf nicht-vorhandenem Tag → unverändert", () => {
    const s = makeSample({ tags: ["kick"] });
    const out = removeTagFromSample(s, "snare");
    expect(out).toBe(s);
  });

  it("setSampleTags dedupliziert + normalisiert", () => {
    const s = makeSample();
    const out = setSampleTags(s, ["Kick", "kick", "SNARE", "  snare  ", ""]);
    expect(out.tags).toEqual(["kick", "snare"]);
  });

  it("normalizeTag liefert null für invalid input", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    // @ts-expect-error – Test defensive non-string
    expect(normalizeTag(null)).toBeNull();
    // @ts-expect-error
    expect(normalizeTag(42)).toBeNull();
    expect(normalizeTag("KICK")).toBe("kick");
  });
});

// ─── Tests: Backward-Compat ─────────────────────────────────────────────────

describe("v3.54.0 — Backward-Compat (Samples ohne `tags`-Property)", () => {
  it("getSampleTags liefert [] bei fehlendem tags-Feld", () => {
    const s = makeSample();
    expect(getSampleTags(s)).toEqual([]);
  });

  it("addTagToSample funktioniert auf Sample ohne tags-Feld", () => {
    const s = makeSample();
    const out = addTagToSample(s, "kick");
    expect(out.tags).toEqual(["kick"]);
  });

  it("removeTagFromSample auf Sample ohne tags-Feld → unverändert", () => {
    const s = makeSample();
    const out = removeTagFromSample(s, "kick");
    expect(out).toBe(s);
  });
});

// ─── Tests: filterByTags ─────────────────────────────────────────────────────

describe("v3.54.0 — filterByTags AND/OR-Mode", () => {
  const samples: Sample[] = [
    makeSample({ id: "1", name: "Kick", tags: ["kick", "drum"] }),
    makeSample({ id: "2", name: "Snare", tags: ["snare", "drum"] }),
    makeSample({ id: "3", name: "Hat", tags: ["closed-hat", "drum"] }),
    makeSample({ id: "4", name: "Vocal", tags: ["vocal"] }),
    makeSample({ id: "5", name: "Untagged" }), // ohne tags-Feld
  ];

  it("filterByTags OR-Mode: matched mindestens ein Tag", () => {
    const out = filterByTags(samples, ["kick", "vocal"], "OR");
    expect(out.map((s) => s.id).sort()).toEqual(["1", "4"]);
  });

  it("filterByTags AND-Mode: alle Tags müssen matchen", () => {
    const out = filterByTags(samples, ["kick", "drum"], "AND");
    expect(out.map((s) => s.id)).toEqual(["1"]);
  });

  it("filterByTags AND-Mode mit unmöglicher Kombination → leer", () => {
    const out = filterByTags(samples, ["kick", "vocal"], "AND");
    expect(out).toEqual([]);
  });

  it("filterByTags ohne Tag-Liste → unveränderte Kopie", () => {
    const out = filterByTags(samples, [], "OR");
    expect(out).toHaveLength(samples.length);
    // Slice = neue Array-Referenz, gleiche Inhalte
    expect(out).not.toBe(samples);
  });

  it("filterByTags normalisiert Input-Tags (case-insensitive)", () => {
    const out = filterByTags(samples, ["KICK"], "OR");
    expect(out.map((s) => s.id)).toEqual(["1"]);
  });

  it("filterByTags ignoriert Samples ohne tags-Feld bei aktivem Filter", () => {
    const out = filterByTags(samples, ["drum"], "OR");
    expect(out.find((s) => s.id === "5")).toBeUndefined();
  });
});

// ─── Tests: Search ──────────────────────────────────────────────────────────

describe("v3.54.0 — matchesSearchQuery", () => {
  it("matched Sample-Name case-insensitive", () => {
    const s = makeSample({ name: "BigKick 808.wav" });
    expect(matchesSearchQuery(s, "kick")).toBe(true);
    expect(matchesSearchQuery(s, "KICK")).toBe(true);
    expect(matchesSearchQuery(s, "808")).toBe(true);
  });

  it("matched Tag case-insensitive", () => {
    const s = makeSample({ name: "noname.wav", tags: ["kick", "low-pass"] });
    expect(matchesSearchQuery(s, "low")).toBe(true);
    expect(matchesSearchQuery(s, "pass")).toBe(true);
  });

  it("leerer Query → match=true", () => {
    const s = makeSample();
    expect(matchesSearchQuery(s, "")).toBe(true);
    expect(matchesSearchQuery(s, "   ")).toBe(true);
  });

  it("kein Match → false", () => {
    const s = makeSample({ name: "kick.wav", tags: ["kick"] });
    expect(matchesSearchQuery(s, "snare")).toBe(false);
  });
});

// ─── Tests: applyAutoTagsFromFilename ───────────────────────────────────────

describe("v3.54.0 — applyAutoTagsFromFilename", () => {
  it("ergänzt Tags aus Dateiname (kick → kick-Tag)", () => {
    const s = makeSample({ name: "Kick_01.wav", path: "/lib/Kick_01.wav" });
    const out = applyAutoTagsFromFilename(s);
    expect(out.tags).toContain("kick");
  });

  it("merged mit bestehenden Tags (keine Duplikate)", () => {
    const s = makeSample({
      name: "Kick_01.wav",
      path: "/lib/Kick_01.wav",
      tags: ["custom"],
    });
    const out = applyAutoTagsFromFilename(s);
    expect(out.tags).toContain("custom");
    expect(out.tags).toContain("kick");
    // Doppel-add wenn manuelles Tag schon "kick" hieße — kein Duplikat.
    const s2 = applyAutoTagsFromFilename(out);
    expect(s2.tags).toEqual(out.tags);
  });

  it("returnt unveränderte Referenz, wenn keine Auto-Tags gefunden werden", () => {
    const s = makeSample({ name: "xyz123.wav", path: "/lib/xyz123.wav" });
    const out = applyAutoTagsFromFilename(s);
    // autoTagFromFilename liefert [] für "xyz123" → kein Update.
    expect(out).toBe(s);
  });
});

// ─── Tests: extractAllTags + Komposit-Filter ─────────────────────────────────

describe("v3.54.0 — extractAllTags / applySampleFilters Komposit", () => {
  const samples: Sample[] = [
    makeSample({ id: "1", name: "Kick", tags: ["kick", "drum"], category: "drum" }),
    makeSample({ id: "2", name: "Snare", tags: ["snare", "drum"], category: "drum" }),
    makeSample({ id: "3", name: "Synth Lead", tags: ["synth"], category: "synth" }),
    makeSample({ id: "4", name: "Empty" }),
  ];

  it("extractAllTags liefert alle unique Tags sortiert", () => {
    expect(extractAllTags(samples)).toEqual(["drum", "kick", "snare", "synth"]);
  });

  it("applySampleFilters: category + tags + query gemeinsam", () => {
    const out = applySampleFilters(samples, {
      category: "drum",
      tags: ["drum"],
      tagMode: "AND",
      query: "kick",
    });
    expect(out.map((s) => s.id)).toEqual(["1"]);
  });

  it("applySampleFilters: leerer Filter → alle Samples (neues Array)", () => {
    const out = applySampleFilters(samples, {});
    expect(out).toHaveLength(samples.length);
    expect(out).not.toBe(samples);
  });

  it("filterByCategory: 'all' liefert Kopie", () => {
    const out = filterByCategory(samples, "all");
    expect(out).toHaveLength(samples.length);
    expect(out).not.toBe(samples);
  });

  it("filterByCategory: spezifische Kategorie filtert korrekt", () => {
    const out = filterByCategory(samples, "synth");
    expect(out.map((s) => s.id)).toEqual(["3"]);
  });
});

// ─── v3.55.0 — Tag-CRUD UI Coverage ──────────────────────────────────────────

describe("v3.55.0 — Tag-Editor UI: Add/Remove Tag-Pipeline", () => {
  it("Add tag persistiert in der Sample-Liste (Store-Update-Simulation)", () => {
    // Simuliert was useProjectStore.addTagToSample tut: samples.map mit
    // addTagToSample auf dem Treffer-ID. Closes v3.54 Caveat:
    // "User kann Tags nicht pro Sample im UI hinzufügen".
    const samples: Sample[] = [
      makeSample({ id: "s1", name: "kick.wav" }),
      makeSample({ id: "s2", name: "snare.wav" }),
    ];
    const updated = samples.map((s) =>
      s.id === "s1" ? addTagToSample(s, "kick") : s,
    );
    expect(getSampleTags(updated[0])).toEqual(["kick"]);
    expect(getSampleTags(updated[1])).toEqual([]);
    // Idempotent: zweiter Add ändert nichts an Tags
    const updated2 = updated.map((s) =>
      s.id === "s1" ? addTagToSample(s, "kick") : s,
    );
    expect(updated2[0]).toBe(updated[0]);
  });

  it("Remove tag via ✕-Button entfernt korrekt — andere Samples unangetastet", () => {
    const samples: Sample[] = [
      makeSample({ id: "s1", name: "k", tags: ["kick", "808", "drum"] }),
      makeSample({ id: "s2", name: "s", tags: ["snare", "drum"] }),
    ];
    const updated = samples.map((s) =>
      s.id === "s1" ? removeTagFromSample(s, "808") : s,
    );
    expect(getSampleTags(updated[0])).toEqual(["kick", "drum"]);
    // Andere Samples bleiben referenz-identisch (kein Re-Render-Storm)
    expect(updated[1]).toBe(samples[1]);
  });

  it("Tag-Input normalisiert User-Input (Caps, Whitespace) beim Add", () => {
    const s = makeSample();
    const out = addTagToSample(s, "  KICK  ");
    // Closes UX-Risiko: User tippt "Kick" und filterByTags("kick") matched
    expect(getSampleTags(out)).toEqual(["kick"]);
  });
});

describe("v3.55.0 — getTopTagSuggestions Autocomplete", () => {
  it("liefert most-used Tags zuerst (Frequency-Sort)", () => {
    const samples: Sample[] = [
      makeSample({ id: "1", tags: ["kick", "drum"] }),
      makeSample({ id: "2", tags: ["kick", "808"] }),
      makeSample({ id: "3", tags: ["kick"] }),
      makeSample({ id: "4", tags: ["snare", "drum"] }),
    ];
    const out = getTopTagSuggestions(samples, 5);
    // kick=3, drum=2, snare=1, 808=1 — kick first
    expect(out[0]).toBe("kick");
    expect(out[1]).toBe("drum");
    expect(out).toContain("snare");
    expect(out).toContain("808");
  });

  it("füllt mit COMMON_TAG_SUGGESTIONS auf, wenn weniger als limit eigene Tags da sind", () => {
    const samples: Sample[] = [
      makeSample({ id: "1", tags: ["custom-tag"] }),
    ];
    const out = getTopTagSuggestions(samples, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe("custom-tag"); // own tag first
    // Weitere Slots aus COMMON_TAG_SUGGESTIONS (kick, snare, …)
    expect(COMMON_TAG_SUGGESTIONS).toContain(out[1]);
  });

  it("dedupliziert wenn Common-Tag schon als own Tag existiert", () => {
    const samples: Sample[] = [makeSample({ id: "1", tags: ["kick"] })];
    const out = getTopTagSuggestions(samples, 5);
    // 'kick' darf nur EINMAL drin sein, obwohl es in COMMON_TAG_SUGGESTIONS auch ist
    expect(out.filter((t) => t === "kick")).toHaveLength(1);
  });

  it("leere Sample-Liste → fallback komplett aus COMMON_TAG_SUGGESTIONS", () => {
    const out = getTopTagSuggestions([], 10);
    expect(out).toHaveLength(10);
    for (const t of out) {
      expect(COMMON_TAG_SUGGESTIONS).toContain(t);
    }
  });

  it("limit clampt die Ausgabe", () => {
    const out = getTopTagSuggestions([], 3);
    expect(out).toHaveLength(3);
  });
});
