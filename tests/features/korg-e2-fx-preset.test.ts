import { describe, it, expect } from "vitest";
import {
  IFX_PRESET_SIZE,
  decodeIfxPreset,
  setIfxPresetParam,
  setIfxPresetLevel,
  setIfxPresetName,
  GROOVE_SIZE,
  GROOVE_STEP_COUNT,
  decodeGroove,
  setGrooveStep,
} from "../../client/src/utils/korg/e2FxPreset";

// Build a 0x20C preset with known devices + a param value, at the verified offsets.
function makePreset(): Uint8Array {
  const b = new Uint8Array(IFX_PRESET_SIZE);
  // name @0x001 "TESTFX"
  "TESTFX".split("").forEach((c, i) => (b[0x001 + i] = c.charCodeAt(0)));
  b[0x12a] = 0x0a; // ifx1 device = Filter (4 params)
  b[0x12f] = 0x7f; // ifx1 pre level
  b[0x12b] = 0x40; // ifx1 post level
  b[0x135 + 2 * 2] = 64; // ifx1 param 2 = frequency
  b[0x174] = 0x0f; // ifx2 device = Distortion
  b[0x1be] = 0x3c; // mfx device = Tape Echo
  b[0x1c9 + 2 * 0] = 100; // mfx param 0 = dry_wet
  return b;
}

describe("decodeIfxPreset", () => {
  it("decodes name + 3 slots with device names and params", () => {
    const p = decodeIfxPreset(makePreset());
    expect(p.name).toBe("TESTFX");
    expect(p.slots.map((s) => s.role)).toEqual(["ifx1", "ifx2", "mfx"]);
    expect(p.slots[0].deviceName).toBe("Filter");
    expect(p.slots[0].paramNames[2]).toBe("frequency");
    expect(p.slots[0].params[2]).toBe(64);
    expect(p.slots[0].preLevel).toBe(0x7f);
    expect(p.slots[1].deviceName).toBe("Distortion");
    expect(p.slots[2].deviceName).toBe("Tape Echo");
    expect(p.slots[2].params[0]).toBe(100);
  });
});

describe("preset editors (non-destructive)", () => {
  it("setIfxPresetParam changes only the addressed byte", () => {
    const src = makePreset();
    const out = setIfxPresetParam(src, "ifx1", 3, 99); // resonance
    expect(out[0x135 + 2 * 3]).toBe(99);
    expect(decodeIfxPreset(out).slots[0].params[3]).toBe(99);
    // everything else identical
    const diff = [...out].filter((v, i) => v !== src[i]);
    expect(diff).toEqual([99]);
    expect(out.length).toBe(IFX_PRESET_SIZE);
  });

  it("setIfxPresetLevel + setIfxPresetName round-trip", () => {
    let p = makePreset();
    p = setIfxPresetLevel(p, "mfx", "pre", 0x50);
    p = setIfxPresetName(p, "NEWNAME");
    const dec = decodeIfxPreset(p);
    expect(dec.slots[2].preLevel).toBe(0x50);
    expect(dec.name).toBe("NEWNAME");
  });

  it("clamps param values to 0..127", () => {
    expect(setIfxPresetParam(makePreset(), "ifx1", 0, 999)[0x135]).toBe(127);
  });
});

// ─── Groove template ──────────────────────────────────────────────────────────
function makeGroove(): Uint8Array {
  const b = new Uint8Array(GROOVE_SIZE);
  b[0x000] = 0x47; // 'G' of GVST magic
  "SWING".split("").forEach((c, i) => (b[0x010 + i] = c.charCodeAt(0)));
  b[0x022] = 0x40; // length
  // step 0: trigger +8, velocity 0x60, gate 0x40
  b[0x030] = 8;
  b[0x031] = 0x60;
  b[0x032] = 0x40;
  // step 1: negative trigger -16 (two's complement 0xF0)
  b[0x034] = 0xf0;
  return b;
}

describe("groove decode + edit", () => {
  it("decodes name/length and 64 steps with signed trigger", () => {
    const g = decodeGroove(makeGroove());
    expect(g.name).toBe("SWING");
    expect(g.length).toBe(0x40);
    expect(g.steps).toHaveLength(GROOVE_STEP_COUNT);
    expect(g.steps[0]).toEqual({ trigger: 8, velocity: 0x60, gate: 0x40 });
    expect(g.steps[1].trigger).toBe(-16); // 0xF0 two's complement
  });

  it("setGrooveStep writes signed trigger + clamps ranges (non-destructive)", () => {
    const src = makeGroove();
    const out = setGrooveStep(src, 5, "trigger", -0x30);
    expect(out[0x030 + 5 * 4]).toBe(0x100 - 0x30); // 0xD0
    expect(decodeGroove(out).steps[5].trigger).toBe(-0x30);
    // gate clamps to 0x60
    expect(setGrooveStep(src, 0, "gate", 200)[0x032]).toBe(0x60);
  });
});
