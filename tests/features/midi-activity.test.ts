/**
 * tests/features/midi-activity.test.ts
 *
 * Pure-Formatter für die MIDI-Live-Aktivitätsanzeige (#11).
 */
import { describe, it, expect } from "vitest";
import { formatMidiActivity, midiNoteName } from "../../client/src/utils/midiActivity";

describe("midiNoteName", () => {
  it("60 = C4 (Standard-Konvention)", () => {
    expect(midiNoteName(60)).toBe("C4");
  });
  it("69 = A4", () => {
    expect(midiNoteName(69)).toBe("A4");
  });
  it("0 = C-1, 127 = G9", () => {
    expect(midiNoteName(0)).toBe("C-1");
    expect(midiNoteName(127)).toBe("G9");
  });
  it("out-of-range → roher Wert", () => {
    expect(midiNoteName(200)).toBe("200");
  });
});

describe("formatMidiActivity", () => {
  it("Note On mit Velocity > 0", () => {
    const r = formatMidiActivity(0x90, 1, 60, 100);
    expect(r.kind).toBe("noteOn");
    expect(r.label).toBe("Note On · Ch1 · C4 (60) v100");
  });

  it("Note On mit Velocity 0 = Note Off", () => {
    const r = formatMidiActivity(0x90, 1, 60, 0);
    expect(r.kind).toBe("noteOff");
    expect(r.label).toMatch(/Note Off/);
  });

  it("0x80 = Note Off", () => {
    expect(formatMidiActivity(0x80, 3, 64, 0).kind).toBe("noteOff");
  });

  it("Control Change", () => {
    const r = formatMidiActivity(0xb0, 1, 7, 127);
    expect(r.kind).toBe("cc");
    expect(r.label).toBe("CC · Ch1 · #7 = 127");
  });

  it("Pitch Bend kombiniert LSB+MSB (14-bit)", () => {
    const r = formatMidiActivity(0xe0, 2, 0x00, 0x40);
    expect(r.kind).toBe("pitchbend");
    expect(r.label).toMatch(/Pitch Bend · Ch2 · 8192/);
  });

  it("Program Change + Channel Aftertouch", () => {
    expect(formatMidiActivity(0xc0, 1, 5, 0).kind).toBe("program");
    expect(formatMidiActivity(0xd0, 1, 90, 0).kind).toBe("aftertouch");
  });

  it("zeigt den richtigen Channel", () => {
    expect(formatMidiActivity(0x90, 10, 36, 120).label).toMatch(/Ch10/);
  });
});
