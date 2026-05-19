// @vitest-environment node
/**
 * sample-multi-select.test.ts (v3.152.0)
 */
import { describe, it, expect } from "vitest";
import {
  toggleInSet,
  rangeSelect,
  clearSelection,
  selectAll,
  filterSelected,
} from "@/utils/sampleMultiSelect";

describe("sampleMultiSelect", () => {
  describe("toggleInSet", () => {
    it("fügt neue ID hinzu", () => {
      const set = new Set<string>(["a"]);
      const next = toggleInSet(set, "b");
      expect(Array.from(next).sort()).toEqual(["a", "b"]);
    });

    it("entfernt existierende ID", () => {
      const set = new Set<string>(["a", "b"]);
      const next = toggleInSet(set, "a");
      expect(Array.from(next)).toEqual(["b"]);
    });

    it("liefert neuen Set (Input bleibt unverändert)", () => {
      const set = new Set<string>(["a"]);
      const next = toggleInSet(set, "b");
      expect(next).not.toBe(set);
      expect(set.size).toBe(1);
    });
  });

  describe("rangeSelect", () => {
    const order = ["s1", "s2", "s3", "s4", "s5"];

    it("liefert alle IDs zwischen Anker und Target (inkl.)", () => {
      const result = rangeSelect(order, "s2", "s4");
      expect(Array.from(result).sort()).toEqual(["s2", "s3", "s4"]);
    });

    it("funktioniert in umgekehrter Richtung", () => {
      const result = rangeSelect(order, "s4", "s2");
      expect(Array.from(result).sort()).toEqual(["s2", "s3", "s4"]);
    });

    it("inklusiv bei selbem Anker + Target (1 Element)", () => {
      const result = rangeSelect(order, "s3", "s3");
      expect(Array.from(result)).toEqual(["s3"]);
    });

    it("merge mit initialSet (Union)", () => {
      const initial = new Set(["s1"]);
      const result = rangeSelect(order, "s3", "s4", initial);
      expect(Array.from(result).sort()).toEqual(["s1", "s3", "s4"]);
    });

    it("liefert initialSet wenn Anker nicht im Array", () => {
      const initial = new Set(["x"]);
      const result = rangeSelect(order, "nonexistent", "s2", initial);
      expect(Array.from(result)).toEqual(["x"]);
    });

    it("liefert initialSet wenn Target nicht im Array", () => {
      const initial = new Set(["x"]);
      const result = rangeSelect(order, "s2", "nonexistent", initial);
      expect(Array.from(result)).toEqual(["x"]);
    });

    it("handhabt leeres orderedIds Array", () => {
      const result = rangeSelect([], "s1", "s2");
      expect(result.size).toBe(0);
    });
  });

  describe("clearSelection", () => {
    it("liefert leeren Set", () => {
      expect(clearSelection().size).toBe(0);
    });
  });

  describe("selectAll", () => {
    it("liefert Set mit allen IDs", () => {
      const ids = ["a", "b", "c"];
      const result = selectAll(ids);
      expect(result.size).toBe(3);
      expect(result.has("b")).toBe(true);
    });
  });

  describe("filterSelected", () => {
    it("entfernt IDs aus Selection die nicht in allIds sind", () => {
      const all = ["a", "b", "c"];
      const selected = new Set(["a", "x", "c", "y"]);
      const result = filterSelected(all, selected);
      expect(Array.from(result).sort()).toEqual(["a", "c"]);
    });

    it("liefert leeren Set wenn allIds leer", () => {
      const selected = new Set(["a", "b"]);
      const result = filterSelected([], selected);
      expect(result.size).toBe(0);
    });

    it("liefert leeren Set wenn selected leer", () => {
      const result = filterSelected(["a", "b"], new Set());
      expect(result.size).toBe(0);
    });
  });
});
