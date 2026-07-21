import { describe, it, expect, beforeEach } from "vitest";
import {
  connectE2sDevice,
  __resetE2sDeviceForTests,
} from "../../client/src/store/useE2sDeviceStore";
import {
  refreshE2sPresetCounts,
  captureE2sPreset,
  copyE2sPreset,
  restoreE2sBackup,
  removeE2sBackup,
  updateE2sBackupBytes,
  writeE2sPresetBytes,
  getE2sPresetState,
  __resetE2sPresetForTests,
} from "../../client/src/store/useE2sPresetStore";
import {
  E2Func,
  E2Model,
  decode7in8,
  encode7in8,
  IFX_BASE_ADDR,
  IFX_STRIDE,
  IFX_COUNT_ADDR,
  GROOVE_COUNT_ADDR,
} from "../../client/src/utils/korg/e2Sysex";

// A fake hacktribe device with a small RAM model backing IFX/groove + counters.
function fakeHacktribeAccess() {
  const ram = new Map<number, number>(); // sparse byte store
  ram.set(IFX_COUNT_ADDR, 5);
  ram.set(GROOVE_COUNT_ADDR, 9);
  // Seed IFX slot 0 with a recognizable pattern.
  for (let i = 0; i < IFX_STRIDE; i++)
    ram.set(IFX_BASE_ADDR + i, (i * 3) & 0xff);

  let writeAddr = 0;
  const input: {
    name: string;
    onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  } = {
    name: "Electribe 2",
    onmidimessage: null,
  };
  const reply = (r: Uint8Array) =>
    queueMicrotask(() => input.onmidimessage?.({ data: r }));
  const u = (dec: Uint8Array, o: number) =>
    dec[o] + dec[o + 1] * 0x100 + dec[o + 2] * 0x10000 + dec[o + 3] * 0x1000000;

  const output = {
    name: "Electribe 2",
    send(bytes: number[]) {
      const f = Uint8Array.from(bytes);
      if (f[2] === 0x50) {
        // identity
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
      const func = f[6];
      const payload = decode7in8(f.subarray(7, f.length - 1));
      if (func === E2Func.READ_CPU_RAM) {
        const addr = u(payload, 0);
        const len = u(payload, 4);
        const data = new Uint8Array(len);
        for (let i = 0; i < len; i++) data[i] = ram.get(addr + i) ?? 0;
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
            ...encode7in8(data),
            0xf7,
          ])
        );
      } else if (func === E2Func.SET_WRITE_ADDR) {
        writeAddr = u(payload, 0);
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
      } else if (func === E2Func.WRITE_CPU_RAM) {
        for (let i = 0; i < payload.length; i++)
          ram.set(writeAddr + i, payload[i]);
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
  return { access, ram };
}

describe("useE2sPresetStore (via device bridge + fake hacktribe RAM)", () => {
  beforeEach(() => {
    __resetE2sDeviceForTests();
    __resetE2sPresetForTests();
  });

  it("reads IFX/groove preset counts", async () => {
    await connectE2sDevice(fakeHacktribeAccess().access);
    await refreshE2sPresetCounts();
    expect(getE2sPresetState().ifxCount).toBe(5);
    expect(getE2sPresetState().grooveCount).toBe(9);
  });

  it("captures an IFX preset into a backup (blob)", async () => {
    await connectE2sDevice(fakeHacktribeAccess().access);
    await captureE2sPreset("ifx", 0);
    const backups = getE2sPresetState().backups;
    expect(backups).toHaveLength(1);
    expect(backups[0].kind).toBe("ifx");
    expect(backups[0].bytes.length).toBe(IFX_STRIDE);
    expect(backups[0].bytes[10]).toBe((10 * 3) & 0xff);
  });

  it("copies IFX slot 0 -> 1 (device-sourced bytes) and it round-trips", async () => {
    const { access, ram } = fakeHacktribeAccess();
    await connectE2sDevice(access);
    await copyE2sPreset("ifx", 0, 1);
    // slot 1 in RAM now mirrors slot 0's pattern
    expect(ram.get(IFX_BASE_ADDR + IFX_STRIDE * 1 + 10)).toBe((10 * 3) & 0xff);
    expect(getE2sPresetState().error).toBeNull();
  });

  it("restores a captured backup into another slot", async () => {
    const { access, ram } = fakeHacktribeAccess();
    await connectE2sDevice(access);
    await captureE2sPreset("ifx", 0);
    const id = getE2sPresetState().backups[0].id;
    await restoreE2sBackup(id, 2);
    expect(ram.get(IFX_BASE_ADDR + IFX_STRIDE * 2 + 5)).toBe((5 * 3) & 0xff);
  });

  it("errors cleanly when no device is connected (guard)", async () => {
    await refreshE2sPresetCounts();
    expect(getE2sPresetState().error).toMatch(/Kein Gerät/);
  });

  it("removes a backup", async () => {
    await connectE2sDevice(fakeHacktribeAccess().access);
    await captureE2sPreset("ifx", 0);
    const id = getE2sPresetState().backups[0].id;
    removeE2sBackup(id);
    expect(getE2sPresetState().backups).toHaveLength(0);
  });

  it("updateBackupBytes replaces a backup's bytes in-place (field-edit)", async () => {
    await connectE2sDevice(fakeHacktribeAccess().access);
    await captureE2sPreset("ifx", 0);
    const id = getE2sPresetState().backups[0].id;
    const edited = getE2sPresetState().backups[0].bytes.slice();
    edited[10] = 0x77;
    updateE2sBackupBytes(id, edited);
    expect(getE2sPresetState().backups[0].bytes[10]).toBe(0x77);
    expect(getE2sPresetState().backups).toHaveLength(1);
  });

  it("writeE2sPresetBytes writes edited bytes into a slot (round-trip via RAM)", async () => {
    const { access, ram } = fakeHacktribeAccess();
    await connectE2sDevice(access);
    await captureE2sPreset("ifx", 0);
    const edited = getE2sPresetState().backups[0].bytes.slice();
    edited[10] = 0x77;
    const ok = await writeE2sPresetBytes("ifx", 3, edited);
    expect(ok).toBe(true);
    expect(ram.get(IFX_BASE_ADDR + IFX_STRIDE * 3 + 10)).toBe(0x77);
  });

  it("writeE2sPresetBytes returns false when no device is connected", async () => {
    const ok = await writeE2sPresetBytes("ifx", 0, new Uint8Array(IFX_STRIDE));
    expect(ok).toBe(false);
    expect(getE2sPresetState().error).toMatch(/Kein Gerät/);
  });
});
