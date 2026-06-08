/**
 * tests/features/midi-native.test.ts
 *
 * Coverage für den nativen MIDI-Layer (#11) — Pure-Validatoren + Server-Logik
 * mit gemockter @julusian/midi (kein Electron/Hardware nötig).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateMidiPortIndex,
  validateMidiBytes,
  validateMidiHandle,
  MIDI_MAX_MESSAGE_BYTES,
} from "../../electron/ipcValidators";
import {
  __setMidiModuleForTests,
  __openPortCountForTests,
  listMidiPorts,
  openMidiInput,
  openMidiOutput,
  sendMidi,
  closeMidiPort,
  closeAllMidi,
  getMidiStatus,
  setMidiEmitter,
  type MidiModule,
} from "../../electron/midi-native";

// ─── Fake @julusian/midi ─────────────────────────────────────────────────────

let lastMessageCb: ((delta: number, msg: number[]) => void) | null = null;
const sentMessages: number[][] = [];

function makeFakeModule(inputNames: string[], outputNames: string[]): MidiModule {
  class FakeInput {
    private cb: ((d: number, m: number[]) => void) | null = null;
    getPortCount() { return inputNames.length; }
    getPortName(i: number) { return inputNames[i] ?? ""; }
    openPort(_i: number) { /* noop */ }
    closePort() { /* noop */ }
    ignoreTypes(_s: boolean, _t: boolean, _a: boolean) { /* noop */ }
    on(_e: "message", cb: (d: number, m: number[]) => void) { this.cb = cb; lastMessageCb = cb; }
  }
  class FakeOutput {
    getPortCount() { return outputNames.length; }
    getPortName(i: number) { return outputNames[i] ?? ""; }
    openPort(_i: number) { /* noop */ }
    closePort() { /* noop */ }
    sendMessage(bytes: number[]) { sentMessages.push(bytes); }
  }
  return { Input: FakeInput as unknown as MidiModule["Input"], Output: FakeOutput as unknown as MidiModule["Output"] };
}

beforeEach(() => {
  sentMessages.length = 0;
  lastMessageCb = null;
  closeAllMidi();
  __setMidiModuleForTests(makeFakeModule(["OmniTribe IN"], ["OmniTribe OUT", "GS Synth"]));
});

// ─── Validatoren ─────────────────────────────────────────────────────────────

describe("validateMidiPortIndex", () => {
  it("akzeptiert gültigen Index", () => {
    expect(validateMidiPortIndex(0)).toEqual({ ok: true, index: 0 });
  });
  it("lehnt Nicht-Ganzzahl ab", () => {
    expect(validateMidiPortIndex(1.5).ok).toBe(false);
    expect(validateMidiPortIndex("0").ok).toBe(false);
  });
  it("lehnt Out-of-Bounds ab", () => {
    expect(validateMidiPortIndex(-1).ok).toBe(false);
    expect(validateMidiPortIndex(99999).ok).toBe(false);
  });
});

describe("validateMidiBytes", () => {
  it("akzeptiert gültige Bytes + Uint8Array", () => {
    expect(validateMidiBytes([144, 60, 100])).toEqual({ ok: true, bytes: [144, 60, 100] });
    expect(validateMidiBytes(new Uint8Array([240, 0, 247]))).toEqual({ ok: true, bytes: [240, 0, 247] });
  });
  it("lehnt leere / Nicht-Array ab", () => {
    expect(validateMidiBytes([]).ok).toBe(false);
    expect(validateMidiBytes("nope").ok).toBe(false);
  });
  it("lehnt Out-of-Range-Byte ab", () => {
    expect(validateMidiBytes([144, 300]).ok).toBe(false);
    expect(validateMidiBytes([144, -1]).ok).toBe(false);
    expect(validateMidiBytes([144, 1.5]).ok).toBe(false);
  });
  it("lehnt Übergröße ab (Flooding-Schutz)", () => {
    const huge = new Array(MIDI_MAX_MESSAGE_BYTES + 1).fill(0);
    expect(validateMidiBytes(huge).ok).toBe(false);
  });
});

describe("validateMidiHandle", () => {
  it("akzeptiert in:/out:-Handles", () => {
    expect(validateMidiHandle("in:0")).toEqual({ ok: true, handle: "in:0" });
    expect(validateMidiHandle("out:12")).toEqual({ ok: true, handle: "out:12" });
  });
  it("lehnt Fremdformate ab", () => {
    expect(validateMidiHandle("foo:0").ok).toBe(false);
    expect(validateMidiHandle("in:").ok).toBe(false);
    expect(validateMidiHandle(42).ok).toBe(false);
  });
});

// ─── Server-Logik ────────────────────────────────────────────────────────────

describe("midi-native server", () => {
  it("listMidiPorts liefert In-/Out-Ports", () => {
    const r = listMidiPorts();
    expect(r.success).toBe(true);
    expect(r.outputs?.map(o => o.name)).toEqual(["OmniTribe OUT", "GS Synth"]);
    expect(r.inputs?.[0]).toEqual({ index: 0, name: "OmniTribe IN" });
  });

  it("Output öffnen → senden → gesendete Bytes ankommen", () => {
    const open = openMidiOutput(0);
    expect(open.success).toBe(true);
    expect(open.handle).toBe("out:0");
    const send = sendMidi(open.handle!, [144, 60, 100]);
    expect(send.success).toBe(true);
    expect(sentMessages).toEqual([[144, 60, 100]]);
  });

  it("Senden an unbekanntes/Input-Handle schlägt fehl", () => {
    expect(sendMidi("out:99", [144]).success).toBe(false);
    openMidiInput(0);
    expect(sendMidi("in:0", [144]).success).toBe(false); // Input ist kein Output
  });

  it("Input öffnen → eingehende Message wird an Renderer emittiert", () => {
    const emit = vi.fn();
    setMidiEmitter(emit);
    const open = openMidiInput(0);
    expect(open.handle).toBe("in:0");
    // Simuliere eingehende MIDI-Nachricht via gespeichertem Callback.
    lastMessageCb?.(0.01, [248]); // MIDI clock
    expect(emit).toHaveBeenCalledWith("midi:message", { handle: "in:0", bytes: [248], deltaTime: 0.01 });
    setMidiEmitter(null);
  });

  it("Out-of-Bounds-Port → Fehler, kein offenes Handle", () => {
    expect(openMidiOutput(50).success).toBe(false);
    expect(__openPortCountForTests()).toBe(0);
  });

  it("closeMidiPort + closeAllMidi räumen auf", () => {
    openMidiOutput(0);
    openMidiInput(0);
    expect(__openPortCountForTests()).toBe(2);
    closeMidiPort("out:0");
    expect(__openPortCountForTests()).toBe(1);
    closeAllMidi();
    expect(__openPortCountForTests()).toBe(0);
  });

  it("getMidiStatus reflektiert offene Ports + Plattform-Flag", () => {
    openMidiOutput(0);
    const st = getMidiStatus();
    expect(st.available).toBe(true);
    expect(st.openOutputs).toBe(1);
    expect(st.virtualPortsSupported).toBe(process.platform !== "win32");
  });
});
