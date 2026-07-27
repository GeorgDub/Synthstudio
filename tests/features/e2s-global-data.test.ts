import { describe, it, expect, beforeEach } from "vitest";
import {
  connectE2sDevice,
  pullE2sGlobal,
  pushE2sGlobal,
  getE2sDeviceState,
  __resetE2sDeviceForTests,
} from "../../client/src/store/useE2sDeviceStore";
import {
  E2Func,
  E2Model,
  decode7in8,
  buildGlobalDump,
} from "../../client/src/utils/korg/e2Sysex";

/** Fake device: serves a canned global blob on 0x0E, ACKs a 0x51 write. */
function fakeGlobalDevice(globalBytes: Uint8Array) {
  const input: {
    name: string;
    onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  } = { name: "Electribe 2", onmidimessage: null };
  const reply = (r: Uint8Array) =>
    queueMicrotask(() => input.onmidimessage?.({ data: r }));
  let received: Uint8Array | null = null;

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
      if (f[6] === E2Func.GLOBAL_DUMP_REQ) {
        reply(buildGlobalDump(globalBytes)); // device -> host 0x51
      } else if (f[6] === E2Func.GLOBAL_DUMP) {
        received = decode7in8(f.subarray(7, f.length - 1)); // host -> device 0x51 write
        reply(
          Uint8Array.from([
            0xf0,
            0x42,
            0x30,
            0x00,
            0x01,
            0x24,
            E2Func.ACK,
            0xf7,
          ])
        );
      }
    },
  };
  const access = {
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output]]),
  } as unknown as MIDIAccess;
  return { access, getReceived: () => received };
}

describe("global data pull/push (round-trip)", () => {
  beforeEach(() => __resetE2sDeviceForTests());

  const globalBlob = Uint8Array.from(
    { length: 256 },
    (_, i) => (i * 5 + 1) & 0xff
  );

  it("pulls global data and stores it (decoded, exact bytes)", async () => {
    await connectE2sDevice(fakeGlobalDevice(globalBlob).access);
    const data = await pullE2sGlobal();
    expect(data).toEqual(globalBlob);
    expect(getE2sDeviceState().globalData).toEqual(globalBlob);
    expect(getE2sDeviceState().error).toBeNull();
  });

  it("pushes global data back and the device receives the exact bytes", async () => {
    const dev = fakeGlobalDevice(globalBlob);
    await connectE2sDevice(dev.access);
    const pulled = await pullE2sGlobal();
    const ok = await pushE2sGlobal(pulled!);
    expect(ok).toBe(true);
    expect(dev.getReceived()).toEqual(globalBlob); // round-trip is byte-exact
  });

  it("errors cleanly when not connected (guard)", async () => {
    expect(await pullE2sGlobal()).toBeNull();
    expect(getE2sDeviceState().error).toMatch(/Kein Gerät/);
    expect(await pushE2sGlobal(new Uint8Array(4))).toBe(false);
  });
});
