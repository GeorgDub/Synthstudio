import { describe, it, expect, beforeEach } from "vitest";
import {
  IFX_TYPES,
  MFX_TYPES,
  fxTypeDef,
  decodeFxEditBuffer,
  decodeFxControlMap,
  fxEditBufferAddr,
  FX_EDIT_BUFFER_BASE,
  FX_EDIT_BUFFER_STRIDE,
  FX_CONTROL_MAP_OFFSET,
  FX_CONTROL_SLOT_SIZE,
  FX_SOURCE_CONTROLS,
} from "../../client/src/utils/korg/e2FxParams";
import {
  connectE2sDevice,
  readE2sFxBuffer,
  __resetE2sDeviceForTests,
} from "../../client/src/store/useE2sDeviceStore";
import {
  E2Func,
  E2Model,
  decode7in8,
  encode7in8,
} from "../../client/src/utils/korg/e2Sysex";

describe("FX type/param tables", () => {
  it("has known IFX + MFX types with expected first params", () => {
    expect(IFX_TYPES[0x0a].name).toBe("Filter");
    expect(IFX_TYPES[0x0a].params).toEqual([
      "dry_wet",
      "output_select",
      "frequency",
      "resonance",
    ]);
    expect(MFX_TYPES[0x3c].name).toBe("Tape Echo");
    expect(MFX_TYPES[0x3c].params[0]).toBe("dry_wet");
  });

  it("fxTypeDef selects the right table by isMfx", () => {
    expect(fxTypeDef(0x28, true)?.name).toBe("MKP2 Comp"); // MFX
    expect(fxTypeDef(0x28, false)).toBeUndefined(); // 0x28 is not an IFX id
    expect(fxTypeDef(0x01, false)?.name).toBe("MKP2 Comp"); // IFX
  });

  it("param index positions match the NRPN DATA-MSB ordering (0-based)", () => {
    // I_distortion (0x0F): index 1 = gain, 14 = output_level
    expect(IFX_TYPES[0x0f].params[1]).toBe("gain");
    expect(IFX_TYPES[0x0f].params[14]).toBe("output_level");
  });
});

describe("FX defaults alignment", () => {
  it("every type's default array matches its param-name count (IFX + MFX)", async () => {
    const { IFX_DEFAULTS, MFX_DEFAULTS } =
      await import("../../client/src/utils/korg/e2FxDefaults");
    for (const [id, def] of Object.entries(IFX_TYPES)) {
      const d = IFX_DEFAULTS[Number(id)];
      expect(
        d,
        `IFX 0x${Number(id).toString(16)} defaults present`
      ).toBeDefined();
      expect(d.length, `IFX 0x${Number(id).toString(16)} length`).toBe(
        def.params.length
      );
    }
    for (const [id, def] of Object.entries(MFX_TYPES)) {
      const d = MFX_DEFAULTS[Number(id)];
      expect(
        d,
        `MFX 0x${Number(id).toString(16)} defaults present`
      ).toBeDefined();
      expect(d.length, `MFX 0x${Number(id).toString(16)} length`).toBe(
        def.params.length
      );
    }
  });
});

describe("fxEditBufferAddr + decodeFxEditBuffer", () => {
  it("computes the RAM address per slot", () => {
    expect(fxEditBufferAddr(0)).toBe(FX_EDIT_BUFFER_BASE);
    expect(fxEditBufferAddr(0x20)).toBe(
      FX_EDIT_BUFFER_BASE + FX_EDIT_BUFFER_STRIDE * 0x20
    );
  });

  it("decodes device + params (value at 0x03 + 2*k) from the 0x72 buffer", () => {
    const buf = new Uint8Array(FX_EDIT_BUFFER_STRIDE);
    buf[0] = 0x0a; // IFX Filter (4 params)
    buf[0x03 + 2 * 0] = 100; // dry_wet
    buf[0x03 + 2 * 1] = 1; // output_select
    buf[0x03 + 2 * 2] = 64; // frequency
    buf[0x03 + 2 * 3] = 30; // resonance
    buf[0x33] = 0x7f; // input level
    buf[0x35] = 0x40; // output level
    const dec = decodeFxEditBuffer(buf, false);
    expect(dec.device).toBe(0x0a);
    expect(dec.params).toEqual([100, 1, 64, 30]);
    expect(dec.inputLevel).toBe(0x7f);
    expect(dec.outputLevel).toBe(0x40);
  });

  it("returns no params for an unknown device id (edge case)", () => {
    const buf = new Uint8Array(FX_EDIT_BUFFER_STRIDE);
    buf[0] = 0x77;
    expect(decodeFxEditBuffer(buf, false).params).toEqual([]);
  });
});

describe("decodeFxControlMap", () => {
  it("reads 10 slots (source/target/min/max, 6 B each) from offset 0x36", () => {
    const buf = new Uint8Array(FX_EDIT_BUFFER_STRIDE);
    // slot 0: source=FX Edit X (0x02), target param 2, min 0x10, max 0x70
    const o = FX_CONTROL_MAP_OFFSET;
    buf[o + 0] = 0x02;
    buf[o + 1] = 2;
    buf[o + 3] = 0x10;
    buf[o + 5] = 0x70;
    // slot 9 (last): source=Play/Start (0x0a)
    const o9 = FX_CONTROL_MAP_OFFSET + 9 * FX_CONTROL_SLOT_SIZE;
    buf[o9] = 0x0a;
    const map = decodeFxControlMap(buf);
    expect(map).toHaveLength(10);
    expect(map[0]).toEqual({
      sourceControl: 0x02,
      targetParam: 2,
      minValue: 0x10,
      maxValue: 0x70,
    });
    expect(map[9].sourceControl).toBe(0x0a);
    expect(FX_SOURCE_CONTROLS[0x0a]).toBe("Play/Start");
  });

  it("is included in decodeFxEditBuffer and fills the buffer exactly to 0x72", () => {
    // 0x36 + 10*6 = 0x72 → last map byte is the final buffer byte.
    expect(FX_CONTROL_MAP_OFFSET + 10 * FX_CONTROL_SLOT_SIZE).toBe(
      FX_EDIT_BUFFER_STRIDE
    );
    const buf = new Uint8Array(FX_EDIT_BUFFER_STRIDE);
    buf[0] = 0x0a; // Filter
    buf[FX_CONTROL_MAP_OFFSET + 1] = 3; // slot0 target param 3
    const dec = decodeFxEditBuffer(buf, false);
    expect(dec.controlMap).toHaveLength(10);
    expect(dec.controlMap[0].targetParam).toBe(3);
  });
});

// ─── Bridge/store read via a fake hacktribe RAM device ────────────────────────
function fakeFxDevice(slotBytes: Record<number, Uint8Array>) {
  const input: {
    name: string;
    onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  } = {
    name: "Electribe 2",
    onmidimessage: null,
  };
  const reply = (r: Uint8Array) =>
    queueMicrotask(() => input.onmidimessage?.({ data: r }));
  const u = (d: Uint8Array, o: number) =>
    d[o] + d[o + 1] * 0x100 + d[o + 2] * 0x10000 + d[o + 3] * 0x1000000;
  const output = {
    name: "Electribe 2",
    send(bytes: number[]) {
      const f = Uint8Array.from(bytes);
      if (f[2] === 0x50) {
        reply(
          Uint8Array.from([
            0xf0,
            0x42,
            0x50,
            0x01,
            0,
            0,
            E2Model.SAMPLER,
            0,
            0,
            0,
            2,
            2,
            0xf7,
          ])
        );
        return;
      }
      if (f[6] === E2Func.READ_CPU_RAM) {
        const payload = decode7in8(f.subarray(7, f.length - 1));
        const addr = u(payload, 0);
        const len = u(payload, 4);
        const data = slotBytes[addr] ?? new Uint8Array(len);
        reply(
          Uint8Array.from([
            0xf0,
            0x42,
            0x30,
            0x00,
            0x01,
            0x24,
            E2Func.READ_CPU_RAM,
            0,
            0,
            ...encode7in8(data.subarray(0, len)),
            0xf7,
          ])
        );
      }
    },
  };
  return {
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output]]),
  } as unknown as MIDIAccess;
}

describe("store readFxBuffer", () => {
  beforeEach(() => __resetE2sDeviceForTests());

  it("reads + decodes the live FX buffer of a slot", async () => {
    const buf = new Uint8Array(FX_EDIT_BUFFER_STRIDE);
    buf[0] = 0x0f; // IFX Distortion
    buf[0x03 + 2 * 1] = 90; // gain
    const access = fakeFxDevice({ [fxEditBufferAddr(4)]: buf });
    await connectE2sDevice(access);
    const dec = await readE2sFxBuffer(4);
    expect(dec?.device).toBe(0x0f);
    expect(dec?.params[1]).toBe(90);
  });

  it("returns null when not connected", async () => {
    expect(await readE2sFxBuffer(0)).toBeNull();
  });
});
