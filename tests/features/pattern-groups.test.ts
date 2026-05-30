/**
 * tests/features/pattern-groups.test.ts — reine Helfer + Store des Pattern-Gruppen.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addPatternPure,
  removePatternPure,
  moveInGroupPure,
  purgePatternPure,
  addGroup,
  addPatternToGroup,
  moveInGroup,
  removeGroup,
  setGroupRepeats,
  getPatternGroupState,
  __resetPatternGroupStoreForTests,
  type PatternGroup,
} from "../../client/src/store/usePatternGroupStore";

const G = (id: string, patternIds: string[]): PatternGroup => ({ id, name: id, color: "#000", patternIds });

describe("reine Gruppen-Helfer", () => {
  it("addPatternPure fügt hinzu, ignoriert Duplikate", () => {
    const groups = [G("a", ["p1"])];
    expect(addPatternPure(groups, "a", "p2")[0].patternIds).toEqual(["p1", "p2"]);
    expect(addPatternPure(groups, "a", "p1")[0].patternIds).toEqual(["p1"]); // dup
  });
  it("addPatternPure lässt andere Gruppen unberührt", () => {
    const groups = [G("a", []), G("b", ["x"])];
    const r = addPatternPure(groups, "a", "p1");
    expect(r[1].patternIds).toEqual(["x"]);
  });
  it("removePatternPure entfernt nur in der Zielgruppe", () => {
    const groups = [G("a", ["p1", "p2"]), G("b", ["p1"])];
    const r = removePatternPure(groups, "a", "p1");
    expect(r[0].patternIds).toEqual(["p2"]);
    expect(r[1].patternIds).toEqual(["p1"]);
  });
  it("moveInGroupPure ordnet um", () => {
    const groups = [G("a", ["p1", "p2", "p3"])];
    expect(moveInGroupPure(groups, "a", 0, 2)[0].patternIds).toEqual(["p2", "p3", "p1"]);
    expect(moveInGroupPure(groups, "a", 2, 0)[0].patternIds).toEqual(["p3", "p1", "p2"]);
  });
  it("moveInGroupPure ignoriert out-of-range", () => {
    const groups = [G("a", ["p1", "p2"])];
    expect(moveInGroupPure(groups, "a", 0, 5)[0].patternIds).toEqual(["p1", "p2"]);
  });
  it("purgePatternPure entfernt aus allen Gruppen", () => {
    const groups = [G("a", ["p1", "p2"]), G("b", ["p2", "p3"])];
    const r = purgePatternPure(groups, "p2");
    expect(r[0].patternIds).toEqual(["p1"]);
    expect(r[1].patternIds).toEqual(["p3"]);
  });
});

describe("Gruppen-Store (Singleton + Persistenz)", () => {
  beforeEach(() => __resetPatternGroupStoreForTests());

  it("addGroup + addPatternToGroup + Reihenfolge", () => {
    const id = addGroup("Drop");
    addPatternToGroup(id, "p1");
    addPatternToGroup(id, "p2");
    addPatternToGroup(id, "p1"); // dup ignoriert
    const g = getPatternGroupState().groups.find(x => x.id === id)!;
    expect(g.name).toBe("Drop");
    expect(g.patternIds).toEqual(["p1", "p2"]);
  });

  it("moveInGroup + removeGroup", () => {
    const id = addGroup("X");
    addPatternToGroup(id, "a"); addPatternToGroup(id, "b");
    moveInGroup(id, 1, 0);
    expect(getPatternGroupState().groups[0].patternIds).toEqual(["b", "a"]);
    removeGroup(id);
    expect(getPatternGroupState().groups).toHaveLength(0);
  });

  it("repeats: Default 1, setGroupRepeats clamped auf 1..64", () => {
    const id = addGroup("R");
    expect(getPatternGroupState().groups[0].repeats).toBe(1);
    setGroupRepeats(id, 4);
    expect(getPatternGroupState().groups[0].repeats).toBe(4);
    setGroupRepeats(id, 0);   // → 1
    expect(getPatternGroupState().groups[0].repeats).toBe(1);
    setGroupRepeats(id, 999); // → 64
    expect(getPatternGroupState().groups[0].repeats).toBe(64);
  });
});
