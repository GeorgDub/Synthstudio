/**
 * Tests – projectTemplates.ts (v1.10)
 *
 * Testet die 6 Genre-Templates: Vollständigkeit, BPM, Step-Anzahl,
 * Parts-Struktur, Preview-Korrektheit und getTemplate()-Lookup.
 */

import { describe, it, expect } from "vitest";
import {
  PROJECT_TEMPLATES,
  getTemplate,
  type TemplateGenre,
} from "../client/src/utils/projectTemplates";

const EXPECTED_GENRES: TemplateGenre[] = [
  "techno",
  "house",
  "hiphop",
  "trap",
  "ambient",
  "reggaeton",
];

const EXPECTED_BPM: Record<TemplateGenre, number> = {
  techno: 135,
  house: 124,
  hiphop: 90,
  trap: 140,
  ambient: 80,
  reggaeton: 100,
};

describe("PROJECT_TEMPLATES – Vollständigkeit", () => {
  it("enthält genau 6 Templates", () => {
    expect(PROJECT_TEMPLATES).toHaveLength(6);
  });

  it("enthält alle erwarteten Genre-IDs", () => {
    const ids = PROJECT_TEMPLATES.map((t) => t.id);
    for (const genre of EXPECTED_GENRES) {
      expect(ids).toContain(genre);
    }
  });

  it("jedes Template hat einen name, description und bpm", () => {
    for (const t of PROJECT_TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.bpm).toBeGreaterThan(0);
    }
  });
});

describe("PROJECT_TEMPLATES – BPM-Werte", () => {
  for (const genre of EXPECTED_GENRES) {
    it(`${genre}: BPM = ${EXPECTED_BPM[genre]}`, () => {
      const t = PROJECT_TEMPLATES.find((x) => x.id === genre)!;
      expect(t.bpm).toBe(EXPECTED_BPM[genre]);
    });
  }
});

describe("PROJECT_TEMPLATES – Parts-Struktur", () => {
  it("jedes Template hat genau 5 Parts", () => {
    for (const t of PROJECT_TEMPLATES) {
      expect(t.parts).toHaveLength(5);
    }
  });

  it("alle Parts haben einen name und steps-Array", () => {
    for (const t of PROJECT_TEMPLATES) {
      for (const part of t.parts) {
        expect(part.name).toBeTruthy();
        expect(Array.isArray(part.steps)).toBe(true);
      }
    }
  });

  it("jeder Part hat genau 16 Steps (stepCount=16)", () => {
    for (const t of PROJECT_TEMPLATES) {
      expect(t.stepCount).toBe(16);
      for (const part of t.parts) {
        expect(part.steps).toHaveLength(16);
      }
    }
  });

  it("alle Steps sind boolean-Werte", () => {
    for (const t of PROJECT_TEMPLATES) {
      for (const part of t.parts) {
        for (const step of part.steps) {
          expect(typeof step).toBe("boolean");
        }
      }
    }
  });

  it("defaultVelocity liegt im Bereich 1–127 (wenn gesetzt)", () => {
    for (const t of PROJECT_TEMPLATES) {
      for (const part of t.parts) {
        if (part.defaultVelocity !== undefined) {
          expect(part.defaultVelocity).toBeGreaterThanOrEqual(1);
          expect(part.defaultVelocity).toBeLessThanOrEqual(127);
        }
      }
    }
  });
});

describe("PROJECT_TEMPLATES – Preview", () => {
  it("preview hat genau 16 Einträge", () => {
    for (const t of PROJECT_TEMPLATES) {
      expect(t.preview).toHaveLength(16);
    }
  });

  it("techno-preview entspricht dem Kick-Pattern (4/4)", () => {
    const t = PROJECT_TEMPLATES.find((x) => x.id === "techno")!;
    const kick = t.parts.find((p) => p.name === "Kick")!;
    expect(t.preview).toEqual(kick.steps);
  });
});

describe("getTemplate()", () => {
  it("gibt das korrekte Template für jede Genre-ID zurück", () => {
    for (const genre of EXPECTED_GENRES) {
      const t = getTemplate(genre);
      expect(t).toBeDefined();
      expect(t!.id).toBe(genre);
    }
  });

  it("techno: stepCount=16, bpm=135", () => {
    const t = getTemplate("techno")!;
    expect(t.stepCount).toBe(16);
    expect(t.bpm).toBe(135);
  });

  it("trap: Hi-Hat klingt voll – alle 16 Steps aktiv", () => {
    const t = getTemplate("trap")!;
    const hat = t.parts.find((p) => p.name === "Hi-Hat cl.")!;
    expect(hat.steps.every((s) => s === true)).toBe(true);
  });

  it("ambient: Kick hat nur 2 aktive Steps (spärliche Perkussion)", () => {
    const t = getTemplate("ambient")!;
    const kick = t.parts.find((p) => p.name === "Kick")!;
    const activeCount = kick.steps.filter(Boolean).length;
    expect(activeCount).toBe(2);
  });

  it("unbekannte ID → undefined", () => {
    // @ts-expect-error – Absichtlicher Typen-Fehler für den Test
    expect(getTemplate("jazz")).toBeUndefined();
  });
});
