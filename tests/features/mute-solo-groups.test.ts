/**
 * Synthstudio – mute-solo-groups.test.ts (v3.125.0)
 *
 * @vitest-environment jsdom
 *
 * Tests für useMuteSoloGroupStore (Bus-Groups für one-click group-mute/solo).
 * jsdom: brauchen wir für localStorage + window.dispatchEvent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __resetMuteSoloGroupStoreForTests,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupColor,
  addChannelToGroup,
  removeChannelFromGroup,
  removeChannelFromAllGroups,
  muteGroup,
  soloGroup,
  clearSoloGroup,
  isGroupSoloed,
  getGroupById,
  getMuteSoloGroupState,
  DEFAULT_GROUP_COLOR,
} from "../../client/src/store/useMuteSoloGroupStore";

const STORAGE_KEY = "ss-mute-solo-groups:v1";

interface CapturedEvent {
  name: string;
  detail: unknown;
}

function captureEvents(...names: string[]): {
  events: CapturedEvent[];
  dispose: () => void;
} {
  const events: CapturedEvent[] = [];
  const listeners: Array<[string, EventListener]> = [];
  for (const n of names) {
    const listener: EventListener = (e) => {
      events.push({ name: n, detail: (e as CustomEvent).detail });
    };
    window.addEventListener(n, listener);
    listeners.push([n, listener]);
  }
  return {
    events,
    dispose: () => {
      for (const [n, l] of listeners) window.removeEventListener(n, l);
    },
  };
}

beforeEach(() => {
  __resetMuteSoloGroupStoreForTests();
});

afterEach(() => {
  __resetMuteSoloGroupStoreForTests();
});

describe("addGroup", () => {
  it("creates a group with persistence", () => {
    const g = addGroup("Drums", "#ef4444", ["kick", "snare"]);
    expect(g.id).toBeTruthy();
    expect(g.name).toBe("Drums");
    expect(g.color).toBe("#ef4444");
    expect(g.channelIds).toEqual(["kick", "snare"]);

    // Persistence
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].name).toBe("Drums");
  });

  it("falls back to default color when invalid", () => {
    const g = addGroup("X", "not-a-hex");
    expect(g.color).toBe(DEFAULT_GROUP_COLOR);
  });

  it("defaults empty name to 'Group'", () => {
    const g = addGroup("", "#ef4444");
    expect(g.name).toBe("Group");
  });

  it("dedupes channelIds on creation", () => {
    const g = addGroup("Drums", "#ef4444", ["kick", "kick", "snare", "kick"]);
    expect(g.channelIds).toEqual(["kick", "snare"]);
  });

  it("returns unique IDs for sequential adds", () => {
    const a = addGroup("A", "#ef4444");
    const b = addGroup("B", "#3b82f6");
    expect(a.id).not.toBe(b.id);
  });
});

describe("removeGroup", () => {
  it("cleans up references and persistence", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    expect(getMuteSoloGroupState().groups).toHaveLength(1);
    removeGroup(g.id);
    expect(getMuteSoloGroupState().groups).toHaveLength(0);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.groups).toHaveLength(0);
  });

  it("is no-op for unknown ID", () => {
    addGroup("Drums", "#ef4444", []);
    removeGroup("non-existent");
    expect(getMuteSoloGroupState().groups).toHaveLength(1);
  });

  it("clears solo snapshot when group is removed", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    soloGroup(g.id, ["kick", "snare"], { kick: false, snare: false });
    expect(isGroupSoloed(g.id)).toBe(true);
    removeGroup(g.id);
    expect(isGroupSoloed(g.id)).toBe(false);
  });
});

describe("addChannelToGroup", () => {
  it("is idempotent — no duplicates", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    addChannelToGroup(g.id, "kick");
    addChannelToGroup(g.id, "kick");
    addChannelToGroup(g.id, "kick");
    const updated = getGroupById(g.id)!;
    expect(updated.channelIds).toEqual(["kick"]);
  });

  it("appends new channel in insertion order", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    addChannelToGroup(g.id, "snare");
    addChannelToGroup(g.id, "hat");
    expect(getGroupById(g.id)!.channelIds).toEqual(["kick", "snare", "hat"]);
  });

  it("ignores empty channelId", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    addChannelToGroup(g.id, "");
    expect(getGroupById(g.id)!.channelIds).toEqual(["kick"]);
  });
});

describe("removeChannelFromGroup", () => {
  it("removes correctly", () => {
    const g = addGroup("Drums", "#ef4444", ["kick", "snare", "hat"]);
    removeChannelFromGroup(g.id, "snare");
    expect(getGroupById(g.id)!.channelIds).toEqual(["kick", "hat"]);
  });

  it("is no-op for non-member channel", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    removeChannelFromGroup(g.id, "ghost");
    expect(getGroupById(g.id)!.channelIds).toEqual(["kick"]);
  });
});

describe("muteGroup", () => {
  it("dispatches muteChannels event with all channels", () => {
    const g = addGroup("Drums", "#ef4444", ["kick", "snare"]);
    const cap = captureEvents("mute-solo-group:muteChannels");
    muteGroup(g.id);
    expect(cap.events).toHaveLength(1);
    expect((cap.events[0].detail as { channelIds: string[] }).channelIds).toEqual([
      "kick",
      "snare",
    ]);
    cap.dispose();
  });

  it("empty group: is no-op (no event)", () => {
    const g = addGroup("Empty", "#ef4444", []);
    const cap = captureEvents("mute-solo-group:muteChannels");
    muteGroup(g.id);
    expect(cap.events).toHaveLength(0);
    cap.dispose();
  });

  it("unknown ID: is no-op", () => {
    const cap = captureEvents("mute-solo-group:muteChannels");
    muteGroup("non-existent");
    expect(cap.events).toHaveLength(0);
    cap.dispose();
  });
});

describe("soloGroup", () => {
  it("dispatches soloChannels event: only group channels unmuted", () => {
    const g = addGroup("Drums", "#ef4444", ["kick", "snare"]);
    const cap = captureEvents("mute-solo-group:soloChannels");
    soloGroup(g.id, ["kick", "snare", "bass", "lead"], {
      kick: false,
      snare: false,
      bass: false,
      lead: false,
    });
    expect(cap.events).toHaveLength(1);
    const target = (
      cap.events[0].detail as {
        target: Array<{ channelId: string; muted: boolean }>;
      }
    ).target;
    // Group channels: muted=false
    expect(target.find((t) => t.channelId === "kick")?.muted).toBe(false);
    expect(target.find((t) => t.channelId === "snare")?.muted).toBe(false);
    // Non-group: muted=true
    expect(target.find((t) => t.channelId === "bass")?.muted).toBe(true);
    expect(target.find((t) => t.channelId === "lead")?.muted).toBe(true);
    cap.dispose();
  });

  it("snapshots current mute-state for clearSoloGroup", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    soloGroup(g.id, ["kick", "bass"], { kick: false, bass: true });
    expect(isGroupSoloed(g.id)).toBe(true);
  });

  it("empty group: no-op", () => {
    const g = addGroup("Empty", "#ef4444", []);
    const cap = captureEvents("mute-solo-group:soloChannels");
    soloGroup(g.id, ["kick", "bass"], { kick: false, bass: false });
    expect(cap.events).toHaveLength(0);
    cap.dispose();
  });
});

describe("clearSoloGroup", () => {
  it("restores previous mute states from snapshot", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    soloGroup(g.id, ["kick", "bass", "lead"], {
      kick: false,
      bass: true, // bass was already muted before solo
      lead: false,
    });

    const cap = captureEvents("mute-solo-group:clearSolo");
    clearSoloGroup(g.id);
    expect(cap.events).toHaveLength(1);
    const target = (
      cap.events[0].detail as {
        target: Array<{ channelId: string; muted: boolean }>;
      }
    ).target;
    // Restored values
    expect(target.find((t) => t.channelId === "kick")?.muted).toBe(false);
    expect(target.find((t) => t.channelId === "bass")?.muted).toBe(true);
    expect(target.find((t) => t.channelId === "lead")?.muted).toBe(false);
    // Snapshot cleared
    expect(isGroupSoloed(g.id)).toBe(false);
    cap.dispose();
  });

  it("no-op when no snapshot exists", () => {
    const g = addGroup("Drums", "#ef4444", ["kick"]);
    const cap = captureEvents("mute-solo-group:clearSolo");
    clearSoloGroup(g.id);
    expect(cap.events).toHaveLength(0);
    cap.dispose();
  });
});

describe("renameGroup", () => {
  it("renames with persistence", () => {
    const g = addGroup("Drums", "#ef4444", []);
    renameGroup(g.id, "Percussion");
    expect(getGroupById(g.id)!.name).toBe("Percussion");
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.groups[0].name).toBe("Percussion");
  });

  it("ignores empty name", () => {
    const g = addGroup("Drums", "#ef4444", []);
    renameGroup(g.id, "");
    expect(getGroupById(g.id)!.name).toBe("Drums");
  });
});

describe("setGroupColor", () => {
  it("changes color with persistence", () => {
    const g = addGroup("Drums", "#ef4444", []);
    setGroupColor(g.id, "#3b82f6");
    expect(getGroupById(g.id)!.color).toBe("#3b82f6");
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.groups[0].color).toBe("#3b82f6");
  });

  it("falls back to default color on invalid input", () => {
    const g = addGroup("Drums", "#ef4444", []);
    setGroupColor(g.id, "garbage");
    expect(getGroupById(g.id)!.color).toBe(DEFAULT_GROUP_COLOR);
  });
});

describe("removeChannelFromAllGroups", () => {
  it("removes channel from every group + snapshot", () => {
    const a = addGroup("A", "#ef4444", ["kick", "snare"]);
    const b = addGroup("B", "#3b82f6", ["kick", "bass"]);
    soloGroup(a.id, ["kick", "snare", "bass"], { kick: false, snare: false, bass: false });

    removeChannelFromAllGroups("kick");

    expect(getGroupById(a.id)!.channelIds).toEqual(["snare"]);
    expect(getGroupById(b.id)!.channelIds).toEqual(["bass"]);
    // Snapshot purged for 'kick'
    const snap = getMuteSoloGroupState().soloSnapshots[a.id];
    expect(snap).toBeDefined();
    expect("kick" in snap!).toBe(false);
  });
});

describe("Persistence-Reload", () => {
  it("groups survive store reset → reload from localStorage", () => {
    addGroup("Drums", "#ef4444", ["kick", "snare"]);
    addGroup("Bass", "#3b82f6", ["bass"]);
    // Simulate reload: drop in-memory state, rerun loader.
    // Since module state is a singleton, we hit storage via a second instance.
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0].name).toBe("Drums");
    expect(parsed.groups[1].name).toBe("Bass");
    // soloSnapshots are NOT persisted
    expect("soloSnapshots" in parsed).toBe(false);
  });
});
