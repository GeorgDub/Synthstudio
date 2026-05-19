// @vitest-environment jsdom
/**
 * mute-solo-group-mixer-badge.test.ts — v3.127.0
 * Tests für pure helpers getGroupsForChannel + truncateGroupLabel.
 */

import { describe, it, expect } from "vitest";
import {
  getGroupsForChannel,
  truncateGroupLabel,
  type MuteSoloGroup,
} from "../../client/src/store/useMuteSoloGroupStore";

const G = (id: string, name: string, channelIds: string[]): MuteSoloGroup => ({
  id,
  name,
  color: "#22c55e",
  channelIds,
});

describe("v3.127 getGroupsForChannel", () => {
  it("returns empty when channel in no group", () => {
    const groups = [G("g1", "Drums", ["kick", "snare"])];
    expect(getGroupsForChannel("bass", groups)).toEqual([]);
  });

  it("returns single group when channel in 1", () => {
    const groups = [
      G("g1", "Drums", ["kick", "snare"]),
      G("g2", "Bass", ["bass"]),
    ];
    expect(getGroupsForChannel("kick", groups).map(g => g.id)).toEqual(["g1"]);
  });

  it("returns multiple groups when channel in 2+", () => {
    const groups = [
      G("g1", "Drums", ["kick"]),
      G("g2", "All", ["kick", "snare", "bass"]),
    ];
    expect(getGroupsForChannel("kick", groups).map(g => g.id)).toEqual(["g1", "g2"]);
  });

  it("preserves group insertion-order", () => {
    const groups = [
      G("g3", "ThirdAdded", ["kick"]),
      G("g1", "FirstAdded", ["kick"]),
      G("g2", "SecondAdded", ["snare"]),
    ];
    const result = getGroupsForChannel("kick", groups);
    expect(result.map(g => g.id)).toEqual(["g3", "g1"]);
  });

  it("empty groups input → empty result", () => {
    expect(getGroupsForChannel("kick", [])).toEqual([]);
  });

  it("empty channelId → empty result", () => {
    const groups = [G("g1", "Drums", ["kick"])];
    expect(getGroupsForChannel("", groups)).toEqual([]);
  });

  it("invalid groups (non-array) → empty result", () => {
    // @ts-expect-error testing defensive runtime behavior
    expect(getGroupsForChannel("kick", null)).toEqual([]);
  });
});

describe("v3.127 truncateGroupLabel", () => {
  it("short name → unchanged", () => {
    expect(truncateGroupLabel("Drums")).toBe("Drums");
  });

  it("max 8 chars → exact unchanged", () => {
    expect(truncateGroupLabel("LongName")).toBe("LongName");
  });

  it(">8 chars → truncated with ellipsis", () => {
    expect(truncateGroupLabel("VeryLongGroupName")).toBe("VeryLon…");
  });

  it("custom maxChars", () => {
    expect(truncateGroupLabel("VeryLongName", 4)).toBe("Ver…");
  });

  it("empty string → empty", () => {
    expect(truncateGroupLabel("")).toBe("");
  });

  it("non-string → empty", () => {
    // @ts-expect-error testing defensive
    expect(truncateGroupLabel(null)).toBe("");
  });

  it("maxChars=1 → minimum 1 char + ellipsis safety", () => {
    // mit maxChars=1: nimmt 1 char + ellipsis (oder das ist Verhalten — total length wird 2)
    const result = truncateGroupLabel("Long", 1);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result).toBe("L…");
  });
});
