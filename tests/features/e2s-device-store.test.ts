import { describe, it, expect, beforeEach } from "vitest";
import {
  connectE2sDevice,
  disconnectE2sDevice,
  pullE2sCurrentPattern,
  pullE2sPattern,
  applyE2sCurrentBodyEdit,
  getE2sDeviceState,
  __setE2sMidiAccessProviderForTests,
  __resetE2sDeviceForTests,
} from "../../client/src/store/useE2sDeviceStore";
import { setPatternName } from "../../client/src/utils/korg/e2PatternEdit";
import {
  E2Model,
  E2Func,
  buildCurrentPatternDump,
  buildPatternDump,
  PATTERN_NAME_OFFSET,
  PART_TABLE_OFFSET,
  PART_STRIDE,
  PART_OSC_REF_OFFSET,
} from "../../client/src/utils/korg/e2Sysex";

function makeBody(
  name: string,
  oscRefs: Record<number, number> = {}
): Uint8Array {
  const body = new Uint8Array(0x4000);
  for (let i = 0; i < name.length; i++)
    body[PATTERN_NAME_OFFSET + i] = name.charCodeAt(i);
  for (const [p, ref] of Object.entries(oscRefs)) {
    const off =
      PART_TABLE_OFFSET + Number(p) * PART_STRIDE + PART_OSC_REF_OFFSET;
    body[off] = ref & 0xff;
    body[off + 1] = (ref >> 8) & 0xff;
  }
  return body;
}

function identityReply(): Uint8Array {
  return Uint8Array.from([
    0xf0,
    0x42,
    0x50,
    0x01,
    0,
    0x00,
    E2Model.SAMPLER,
    0,
    0,
    0,
    2,
    2,
    0xf7,
  ]);
}

/** Fake MIDIAccess with one E2S in/out port pair backed by a canned responder. */
function fakeAccess(
  responder: (frame: Uint8Array) => Uint8Array[] | null,
  name = "Electribe 2"
): MIDIAccess {
  const input: {
    name: string;
    onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  } = {
    name,
    onmidimessage: null,
  };
  const output = {
    name,
    send(bytes: number[]) {
      const frame = Uint8Array.from(bytes);
      const replies = responder(frame);
      if (replies)
        for (const r of replies)
          queueMicrotask(() => input.onmidimessage?.({ data: r }));
    },
  };
  return {
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output]]),
  } as unknown as MIDIAccess;
}

function funcOf(frame: Uint8Array): number {
  return frame[2] === 0x50 ? -1 : frame[6];
}

const deviceResponder =
  (patterns: Record<number, Uint8Array>, current?: Uint8Array) =>
  (frame: Uint8Array): Uint8Array[] | null => {
    const f = funcOf(frame);
    if (f === -1) return [identityReply()];
    if (f === E2Func.CURRENT_PATTERN_DUMP_REQ && current)
      return [buildCurrentPatternDump(current)];
    if (f === E2Func.PATTERN_DUMP_REQ) {
      const n = frame[7] + frame[8] * 128;
      if (patterns[n]) return [buildPatternDump(n, patterns[n])];
    }
    return null;
  };

describe("useE2sDeviceStore", () => {
  beforeEach(() => __resetE2sDeviceForTests());

  it("connects and stores identity (happy path)", async () => {
    const ok = await connectE2sDevice(fakeAccess(deviceResponder({})));
    expect(ok).toBe(true);
    const s = getE2sDeviceState();
    expect(s.status).toBe("connected");
    expect(s.identity).toEqual({
      globalChannel: 0,
      model: E2Model.SAMPLER,
      versionMajor: 2,
      versionMinor: 2,
    });
  });

  it("reports an error when no matching port is present (edge case)", async () => {
    const access = fakeAccess(deviceResponder({}), "Some Other Synth");
    const ok = await connectE2sDevice(access, "electribe");
    expect(ok).toBe(false);
    expect(getE2sDeviceState().status).toBe("error");
    expect(getE2sDeviceState().error).toMatch(/Kein Gerät/);
  });

  it("reports an error when Web MIDI is unavailable", async () => {
    __setE2sMidiAccessProviderForTests(() =>
      Promise.reject(new Error("Web MIDI not available"))
    );
    const ok = await connectE2sDevice();
    expect(ok).toBe(false);
    expect(getE2sDeviceState().status).toBe("error");
    expect(getE2sDeviceState().error).toMatch(/Web MIDI/);
  });

  it("pulls the current pattern into a summary", async () => {
    await connectE2sDevice(
      fakeAccess(deviceResponder({}, makeBody("EDIT", { 0: 501 })))
    );
    const summary = await pullE2sCurrentPattern();
    expect(summary?.name).toBe("EDIT");
    expect(getE2sDeviceState().currentPattern?.oscRefs[0]).toBe(501);
    expect(getE2sDeviceState().busy).toBe(false);
    // decoded pattern is retained for import into the DrumMachine
    expect(getE2sDeviceState().currentDecoded?.name).toBe("EDIT");
    expect(getE2sDeviceState().currentDecoded?.parts).toHaveLength(16);
    // raw body is retained for field editing
    expect(getE2sDeviceState().currentBody).toBeInstanceOf(Uint8Array);
  });

  it("applyCurrentBodyEdit swaps the body + re-decodes for the UI", async () => {
    await connectE2sDevice(
      fakeAccess(deviceResponder({}, makeBody("EDIT", { 0: 501 })))
    );
    await pullE2sCurrentPattern();
    const body = getE2sDeviceState().currentBody!;
    applyE2sCurrentBodyEdit(setPatternName(body, "RENAMED"));
    expect(getE2sDeviceState().currentDecoded?.name).toBe("RENAMED");
    expect(getE2sDeviceState().currentPattern?.name).toBe("RENAMED");
    // osc ref survives the non-destructive edit
    expect(getE2sDeviceState().currentDecoded?.parts[0].sampleRef).toBe(501);
  });

  it("pulls a numbered pattern into the patterns map", async () => {
    await connectE2sDevice(
      fakeAccess(deviceResponder({ 42: makeBody("SLOT42", { 3: 777 }) }))
    );
    const summary = await pullE2sPattern(42);
    expect(summary?.name).toBe("SLOT42");
    expect(getE2sDeviceState().patterns[42]?.oscRefs[3]).toBe(777);
  });

  it("does not pull when disconnected (guard)", async () => {
    expect(await pullE2sCurrentPattern()).toBeNull();
    expect(await pullE2sPattern(1)).toBeNull();
  });

  it("disconnect resets to the default state", async () => {
    await connectE2sDevice(fakeAccess(deviceResponder({ 1: makeBody("X") })));
    await pullE2sPattern(1);
    disconnectE2sDevice();
    const s = getE2sDeviceState();
    expect(s.status).toBe("disconnected");
    expect(s.identity).toBeNull();
    expect(s.patterns).toEqual({});
  });
});
