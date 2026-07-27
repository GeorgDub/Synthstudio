// @vitest-environment jsdom
/**
 * omnitribe-fx-command.test.ts — v3.287.0
 *
 * Bridge-Seite von OTP CMD 0x10 FX (FX-Preset & Groove).
 *
 * Spec: `omnitribe/docs/midi/OTP_CMD_FX.md`. Dieselben Werte müssen in der
 * C-Firmware (`otp_protocol.h`) und im Python-Codec (`otp_codec.py`) stehen —
 * das ist die 3-Quellen-Regel aus `agents/PROTOCOL.md`. Hier wird die
 * TypeScript-Seite geprüft; die anderen beiden decken
 * `omnitribe/tests/test_sprint135_otp_cmd_fx.py` ab.
 *
 * Ersetzt Hacktribes Weg über rohe AM1808-RAM-Adressen: wir kopieren die API,
 * nicht die Adressen. Die Blob-Layouts (524 B Preset, 320 B Groove) werden
 * hier bewusst NICHT gedeutet — die Bridge transportiert.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

import {
  FX_BANK_IFX,
  FX_BANK_MFX,
  FX_GROOVE_SIZE,
  FX_PRESET_SIZE,
  FX_SLOT_MFX,
  FxSub,
  OmniTribeBridge,
  OtpCmd,
  decode7Bit,
  encode7Bit,
  type FxGrooveEvent,
  type FxPresetEvent,
} from "../../client/src/audio/OmniTribeBridge";

// ─── Fakes ──────────────────────────────────────────────────────────────────

class FakeMidiOutput {
  name = "OmniTribe v0.1";
  sent: number[][] = [];
  send(bytes: number[]): void { this.sent.push(bytes.slice()); }
}

class FakeMidiInput {
  name = "OmniTribe v0.1";
  onmidimessage: ((e: { data: Uint8Array }) => void) | null = null;
}

function makeAccess(out: FakeMidiOutput, inp: FakeMidiInput): MIDIAccess {
  const outputs = new Map<string, FakeMidiOutput>([["o1", out]]);
  const inputs = new Map<string, FakeMidiInput>([["i1", inp]]);
  return { outputs, inputs, sysexEnabled: true } as unknown as MIDIAccess;
}

/** F0 7D 01 02 CMD SUB LEN_H LEN_L [PAYLOAD] CHK F7 */
function parseFrame(bytes: number[]): { cmd: number; sub: number; payload: number[] } {
  expect(bytes[0]).toBe(0xf0);
  expect(bytes[bytes.length - 1]).toBe(0xf7);
  const len = (bytes[6] << 7) | bytes[7];
  return { cmd: bytes[4], sub: bytes[5], payload: bytes.slice(8, 8 + len) };
}

/** Ein Blob mit High-Bit-Bytes — genau die, die ein 7-Bit-Kanal verstümmelt. */
function blob(size: number, fill = 0xa5): Uint8Array {
  return Uint8Array.from({ length: size }, (_, i) => (fill + i) & 0xff);
}

let out: FakeMidiOutput;
let inp: FakeMidiInput;
let bridge: OmniTribeBridge;

beforeEach(() => {
  vi.useFakeTimers();
  out = new FakeMidiOutput();
  inp = new FakeMidiInput();
  bridge = new OmniTribeBridge();
  bridge.connect(makeAccess(out, inp));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Die Bridge sammelt Frames in einer Drossel-Warteschlange und leert sie per
 * setTimeout(10) — ohne das hier liegt nach einem Aufruf noch nichts am Port.
 */
function flushThrottler(): void {
  for (let i = 0; i < 20; i++) vi.advanceTimersByTime(11);
}

/** Der zuletzt gesendete Frame. */
function lastFrame() {
  flushThrottler();
  expect(out.sent.length).toBeGreaterThan(0);
  return parseFrame(out.sent[out.sent.length - 1]);
}

/**
 * Nur die FX-Frames.
 *
 * `connect()` schickt selbst einen Identity-Request — wer roh `out.sent`
 * zaehlt, zaehlt den mit und misst etwas anderes als gemeint.
 */
function fxFrames() {
  flushThrottler();
  return out.sent.map(parseFrame).filter((f) => f.cmd === OtpCmd.FX);
}

// ─── Konstanten / 3-Quellen-Sync ────────────────────────────────────────────

describe("Kommando-Allokation", () => {
  it("belegt 0x10 und kollidiert mit keinem anderen Kommando", () => {
    expect(OtpCmd.FX).toBe(0x10);
    const values = Object.values(OtpCmd);
    expect(new Set(values).size).toBe(values.length);
  });

  it("nummeriert die SUBs lückenlos 0x00..0x08", () => {
    expect(Object.values(FxSub)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("führt die Blob-Größen der Geräteformate", () => {
    // hacktribe_ram_and_formats.md §2 (0x20C) und §3 (0x140).
    expect(FX_PRESET_SIZE).toBe(0x20c);
    expect(FX_GROOVE_SIZE).toBe(0x140);
  });

  it("legt den MFX-Slot über den höchsten Part-Slot", () => {
    // fx_slot = (part-1)*2 + slot → Part 16 / Slot 1 = 0x1F.
    expect(FX_SLOT_MFX).toBe(0x20);
    expect(FX_SLOT_MFX).toBeGreaterThan(15 * 2 + 1);
  });
});

// ─── Preset schreiben ───────────────────────────────────────────────────────

describe("writeFxPreset", () => {
  it("sendet IFX auf SUB 0x00 mit Slot als erstem Byte", () => {
    bridge.writeFxPreset(FX_BANK_IFX, 3, blob(FX_PRESET_SIZE));
    const f = lastFrame();
    expect(f.cmd).toBe(OtpCmd.FX);
    expect(f.sub).toBe(FxSub.WRITE_IFX_PRESET);
    expect(f.payload[0]).toBe(3);
  });

  it("sendet MFX auf einem anderen SUB", () => {
    bridge.writeFxPreset(FX_BANK_MFX, 3, blob(FX_PRESET_SIZE));
    expect(lastFrame().sub).toBe(FxSub.WRITE_MFX_PRESET);
  });

  it("bringt High-Bit-Bytes unversehrt durch den 7-Bit-Kanal", () => {
    const preset = blob(FX_PRESET_SIZE, 0x80);
    bridge.writeFxPreset(FX_BANK_IFX, 0, preset);
    const decoded = decode7Bit(Uint8Array.from(lastFrame().payload.slice(1)));
    expect(Array.from(decoded.slice(0, FX_PRESET_SIZE))).toEqual(Array.from(preset));
  });

  it("hält den ganzen Frame 7-bit-sicher", () => {
    bridge.writeFxPreset(FX_BANK_IFX, 0, blob(FX_PRESET_SIZE, 0xff));
    flushThrottler();
    const body = out.sent[out.sent.length - 1].slice(1, -1);
    expect(body.every((b) => b <= 0x7f)).toBe(true);
  });

  it("wirft bei falscher Größe statt einen halben Preset zu senden", () => {
    expect(() => bridge.writeFxPreset(FX_BANK_IFX, 0, blob(FX_PRESET_SIZE - 1)))
      .toThrow(RangeError);
    expect(fxFrames()).toHaveLength(0);
  });
});

// ─── Preset anfordern ───────────────────────────────────────────────────────

describe("requestFxPreset", () => {
  it("sendet bank und slot als zwei Bytes", () => {
    bridge.requestFxPreset(FX_BANK_MFX, 12);
    const f = lastFrame();
    expect(f.sub).toBe(FxSub.READ_PRESET_REQ);
    expect(f.payload).toEqual([FX_BANK_MFX, 12]);
  });
});

// ─── Live-Param ─────────────────────────────────────────────────────────────

describe("setFxParam", () => {
  it("zerlegt den u16 in drei Septets, LSB zuerst", () => {
    bridge.setFxParam(FX_SLOT_MFX, 4, 1234);
    const f = lastFrame();
    expect(f.sub).toBe(FxSub.SET_PARAM);
    expect(f.payload.slice(0, 2)).toEqual([FX_SLOT_MFX, 4]);
    const value = f.payload[2] | (f.payload[3] << 7) | (f.payload[4] << 14);
    expect(value).toBe(1234);
  });

  it("überträgt einen vollen u16 verlustfrei", () => {
    // Zwei Septets fassen nur 14 Bit — genau hier fällt das auf.
    bridge.setFxParam(0, 0, 0xffff);
    const p = lastFrame().payload;
    expect(p[2] | (p[3] << 7) | (p[4] << 14)).toBe(0xffff);
  });

  it("begrenzt statt zu überlaufen", () => {
    bridge.setFxParam(0, 0, 999_999);
    const p = lastFrame().payload;
    expect(p[2] | (p[3] << 7) | (p[4] << 14)).toBe(0xffff);
  });

  it("hält alle Bytes 7-bit-sicher", () => {
    bridge.setFxParam(FX_SLOT_MFX, 127, 0xffff);
    expect(lastFrame().payload.every((b) => b <= 0x7f)).toBe(true);
  });
});

// ─── Control-Map ────────────────────────────────────────────────────────────

describe("setFxControlMap", () => {
  it("packt die Zuweisung in EINE Nachricht", () => {
    // Hacktribes map_fx_param braucht fünf NRPN-Nachrichten; bricht die
    // Übertragung dazwischen ab, bleibt dort eine halbe Zuweisung zurück.
    bridge.setFxControlMap(6, 2, 0x42, 4, 10, 120);
    const f = lastFrame();
    expect(f.sub).toBe(FxSub.SET_CONTROL_MAP);
    expect(f.payload).toEqual([6, 2, 0x42, 4, 10, 120]);
    expect(fxFrames()).toHaveLength(1);  // genau eine, nicht fuenf
  });
});

// ─── Groove ─────────────────────────────────────────────────────────────────

describe("writeGroove / requestGroove", () => {
  it("sendet den Groove mit Slot voran", () => {
    const groove = blob(FX_GROOVE_SIZE, 0x5a);
    bridge.writeGroove(9, groove);
    const f = lastFrame();
    expect(f.sub).toBe(FxSub.WRITE_GROOVE);
    expect(f.payload[0]).toBe(9);
    const decoded = decode7Bit(Uint8Array.from(f.payload.slice(1)));
    expect(Array.from(decoded.slice(0, FX_GROOVE_SIZE))).toEqual(Array.from(groove));
  });

  it("wirft bei falscher Größe", () => {
    expect(() => bridge.writeGroove(0, blob(FX_GROOVE_SIZE + 1))).toThrow(RangeError);
  });

  it("fordert einen Groove mit einem Byte an", () => {
    bridge.requestGroove(42);
    expect(lastFrame()).toMatchObject({ sub: FxSub.READ_GROOVE_REQ, payload: [42] });
  });
});

// ─── Antworten ──────────────────────────────────────────────────────────────

/** Baut einen eingehenden Frame so, wie ihn das Gerät schicken würde. */
function deviceFrame(sub: number, payload: number[]): Uint8Array {
  const len = payload.length;
  let chk = 0;
  for (const b of payload) chk ^= b;
  return Uint8Array.from([
    0xf0, 0x7d, 0x01, 0x02, OtpCmd.FX, sub,
    (len >> 7) & 0x7f, len & 0x7f,
    ...payload, chk & 0x7f, 0xf7,
  ]);
}

describe("Antwort-Ereignisse", () => {
  it("meldet einen empfangenen FX-Preset", () => {
    const preset = blob(FX_PRESET_SIZE, 0x11);
    const handler = vi.fn();
    window.addEventListener("omnitribe:fxPreset", handler as EventListener);

    bridge.__testInject(deviceFrame(FxSub.READ_PRESET_RESP, [
      FX_BANK_MFX, 7, ...Array.from(encode7Bit(preset)),
    ]));

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent<FxPresetEvent>).detail;
    expect(detail.bank).toBe(FX_BANK_MFX);
    expect(detail.slot).toBe(7);
    expect(Array.from(detail.preset)).toEqual(Array.from(preset));

    window.removeEventListener("omnitribe:fxPreset", handler as EventListener);
  });

  it("reicht eine unvollständige Antwort NICHT weiter", () => {
    // Ein halb gefüllter Preset sieht aus wie ein echter und würde still
    // falsch dekodiert — lieber gar kein Ereignis.
    const encoded = Array.from(encode7Bit(blob(FX_PRESET_SIZE)));
    const handler = vi.fn();
    window.addEventListener("omnitribe:fxPreset", handler as EventListener);

    bridge.__testInject(deviceFrame(FxSub.READ_PRESET_RESP, [
      FX_BANK_IFX, 0, ...encoded.slice(0, encoded.length - 40),
    ]));

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener("omnitribe:fxPreset", handler as EventListener);
  });

  it("meldet einen empfangenen Groove", () => {
    const groove = blob(FX_GROOVE_SIZE, 0x22);
    const handler = vi.fn();
    window.addEventListener("omnitribe:fxGroove", handler as EventListener);

    bridge.__testInject(deviceFrame(FxSub.READ_GROOVE_RESP, [
      5, ...Array.from(encode7Bit(groove)),
    ]));

    const detail = (handler.mock.calls[0][0] as CustomEvent<FxGrooveEvent>).detail;
    expect(detail.slot).toBe(5);
    expect(Array.from(detail.groove)).toEqual(Array.from(groove));

    window.removeEventListener("omnitribe:fxGroove", handler as EventListener);
  });

  it("ignoriert einen unbekannten SUB still", () => {
    const handler = vi.fn();
    window.addEventListener("omnitribe:fxPreset", handler as EventListener);
    window.addEventListener("omnitribe:fxGroove", handler as EventListener);

    expect(() => bridge.__testInject(deviceFrame(0x7f, [0]))).not.toThrow();
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("omnitribe:fxPreset", handler as EventListener);
    window.removeEventListener("omnitribe:fxGroove", handler as EventListener);
  });
});
