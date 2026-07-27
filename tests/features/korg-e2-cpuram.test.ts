import { describe, it, expect } from "vitest";
import {
  E2SysexBridge,
  E2SequencerRunningError,
  type E2Transport,
} from "../../client/src/audio/E2SysexBridge";
import {
  E2Func,
  E2Model,
  u32le,
  decode7in8,
  encode7in8,
  parseSysex,
  buildReadCpuRamRequest,
  isWritablePresetRam,
  ifxPresetAddr,
  groovePresetAddr,
  IFX_BASE_ADDR,
  IFX_STRIDE,
  GROOVE_BASE_ADDR,
  GROOVE_STRIDE,
} from "../../client/src/utils/korg/e2Sysex";

describe("u32le", () => {
  it("encodes addresses >= 0x80000000 unsigned-safe (happy path)", () => {
    expect(u32le(0xc00a80f0)).toEqual([0xf0, 0x80, 0x0a, 0xc0]);
  });
  it("encodes zero and small values (edge case)", () => {
    expect(u32le(0)).toEqual([0, 0, 0, 0]);
    expect(u32le(0x20c)).toEqual([0x0c, 0x02, 0, 0]);
  });
  it("round-trips through a decode", () => {
    const bytes = u32le(0xc0143b00);
    const n =
      bytes[0] + bytes[1] * 0x100 + bytes[2] * 0x10000 + bytes[3] * 0x1000000;
    expect(n).toBe(0xc0143b00);
  });
});

describe("preset addressing + write guard", () => {
  it("computes IFX and groove slot addresses", () => {
    expect(ifxPresetAddr(0)).toBe(IFX_BASE_ADDR);
    expect(ifxPresetAddr(99)).toBe(IFX_BASE_ADDR + IFX_STRIDE * 99);
    expect(groovePresetAddr(0)).toBe(GROOVE_BASE_ADDR);
    expect(groovePresetAddr(127)).toBe(GROOVE_BASE_ADDR + GROOVE_STRIDE * 127);
  });
  it("accepts writes inside IFX/groove ranges, rejects outside (edge cases)", () => {
    expect(isWritablePresetRam(ifxPresetAddr(0), IFX_STRIDE)).toBe(true);
    expect(isWritablePresetRam(groovePresetAddr(127), GROOVE_STRIDE)).toBe(
      true
    );
    expect(isWritablePresetRam(0x80000000, 4)).toBe(false); // bootloader — never
    expect(isWritablePresetRam(ifxPresetAddr(99), IFX_STRIDE + 1)).toBe(false); // overruns table
  });
});

describe("buildReadCpuRamRequest + parse cpuRamData", () => {
  it("encodes addr+len 32-bit LE, 7-in-8 (round-trip)", () => {
    const frame = buildReadCpuRamRequest(0xc00a80f0, 0x20c);
    expect(frame[6]).toBe(E2Func.READ_CPU_RAM);
    const payload = frame.subarray(7, frame.length - 1);
    const dec = decode7in8(payload);
    expect(Array.from(dec.subarray(0, 4))).toEqual(u32le(0xc00a80f0));
    expect(Array.from(dec.subarray(4, 8))).toEqual(u32le(0x20c));
  });

  it("parses a RAM-read reply (data at [9:-1])", () => {
    const data = Uint8Array.from({ length: 20 }, (_, i) => (i * 7) & 0xff);
    const reply = Uint8Array.from([
      0xf0,
      0x42,
      0x30,
      0x00,
      0x01,
      0x24,
      E2Func.READ_CPU_RAM,
      0x00,
      0x00,
      ...encode7in8(data),
      0xf7,
    ]);
    const p = parseSysex(reply);
    expect(p?.kind).toBe("cpuRamData");
    if (p?.kind === "cpuRamData") expect(p.data).toEqual(data);
  });
});

// ─── Bridge-level RAM/preset flows via a fake hacktribe device ────────────────
function reqAddrLen(frame: Uint8Array): { addr: number; len: number } {
  const dec = decode7in8(frame.subarray(7, frame.length - 1));
  const u = (o: number) =>
    dec[o] + dec[o + 1] * 0x100 + dec[o + 2] * 0x10000 + dec[o + 3] * 0x1000000;
  return { addr: u(0), len: u(4) };
}
function ramReadReply(data: Uint8Array): Uint8Array {
  return Uint8Array.from([
    0xf0,
    0x42,
    0x30,
    0x00,
    0x01,
    0x24,
    E2Func.READ_CPU_RAM,
    0x00,
    0x00,
    ...encode7in8(data),
    0xf7,
  ]);
}
const ACK = Uint8Array.from([
  0xf0,
  0x42,
  0x30,
  0x00,
  0x01,
  E2Model.SAMPLER,
  E2Func.ACK,
  0xf7,
]);

function fakeDevice(responder: (frame: Uint8Array) => Uint8Array[] | null) {
  const sent: Uint8Array[] = [];
  const transport: E2Transport = {
    onmessage: null,
    send(frame: Uint8Array) {
      sent.push(frame);
      const replies = responder(frame);
      if (replies)
        for (const r of replies) queueMicrotask(() => transport.onmessage?.(r));
    },
  };
  return { transport, sent };
}

describe("E2SysexBridge — CPU RAM read", () => {
  it("reads exactly len bytes back", async () => {
    const { transport } = fakeDevice(f => {
      if (f[6] === E2Func.READ_CPU_RAM) {
        const { len } = reqAddrLen(f);
        return [
          ramReadReply(Uint8Array.from({ length: len }, (_, i) => i & 0x7f)),
        ];
      }
      return null;
    });
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    const data = await bridge.readIfxPreset(0);
    expect(data.length).toBe(IFX_STRIDE);
    expect(data[5]).toBe(5);
  });

  it("reads the IFX preset counter (1 byte)", async () => {
    const { transport } = fakeDevice(f =>
      f[6] === E2Func.READ_CPU_RAM ? [ramReadReply(Uint8Array.from([7]))] : null
    );
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    expect(await bridge.readIfxCount()).toBe(7);
  });
});

describe("E2SysexBridge — CPU RAM write (guarded)", () => {
  const ackAll = () => fakeDevice(() => [ACK]);

  it("refuses writes outside the IFX/groove ranges (safety guard)", async () => {
    const { transport, sent } = ackAll();
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    await expect(
      bridge.writeCpuRam(0x80000000, new Uint8Array(4))
    ).rejects.toThrow(/outside IFX\/Groove/);
    expect(sent).toHaveLength(0);
  });

  it("writes an IFX preset in 0x100 chunks (0x20C -> 3 set/data pairs)", async () => {
    const { transport, sent } = ackAll();
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    await bridge.writeIfxPreset(3, new Uint8Array(IFX_STRIDE).fill(0x41));
    const setAddr = sent.filter(f => f[6] === E2Func.SET_WRITE_ADDR).length;
    const writeDat = sent.filter(f => f[6] === E2Func.WRITE_CPU_RAM).length;
    expect(setAddr).toBe(3); // ceil(0x20C / 0x100) = 3
    expect(writeDat).toBe(3);
  });

  it("rejects a wrong-sized IFX preset (edge case)", async () => {
    const { transport } = ackAll();
    const bridge = new E2SysexBridge();
    bridge.attach(transport);
    await expect(bridge.writeIfxPreset(0, new Uint8Array(10))).rejects.toThrow(
      /must be/
    );
  });

  it("blocks preset writes while the sequencer runs", async () => {
    const { transport, sent } = fakeDevice(() => [ACK]);
    const bridge = new E2SysexBridge({ isPlaying: () => true });
    bridge.attach(transport);
    await expect(
      bridge.writeGrooveTemplate(0, new Uint8Array(GROOVE_STRIDE))
    ).rejects.toBeInstanceOf(E2SequencerRunningError);
    expect(sent).toHaveLength(0);
  });
});
