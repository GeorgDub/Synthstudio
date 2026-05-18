/**
 * tests/features/midi-note-out.test.ts
 *
 * Unit-Tests für MidiNoteOut (TASK-240 / v2.92.0).
 *
 * Pattern analog zu midi-clock-out.test.ts: Dependency-Injection-Sender,
 * deterministische Mock-Zeit, kein setInterval.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MidiNoteOut,
  buildNoteOn,
  buildNoteOff,
  clampVelocity,
  clampMidiChannel,
  clampMidiNote,
  noteNameFromNumber,
  DEFAULT_NOTE_DURATION_MS,
} from "../../client/src/audio/MidiNoteOut";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function captureSender(): {
  sender: (outputId: string, bytes: number[]) => void;
  messages: Array<{ outputId: string; bytes: number[] }>;
} {
  const messages: Array<{ outputId: string; bytes: number[] }> = [];
  return {
    sender: (outputId: string, bytes: number[]) => {
      messages.push({ outputId, bytes: [...bytes] });
    },
    messages,
  };
}

/** Hilfsfunktion — vergleicht nur die Bytes (kompatibel zu alten Tests). */
function bytesOnly(messages: Array<{ outputId: string; bytes: number[] }>): number[][] {
  return messages.map(m => m.bytes);
}

beforeEach(() => {
  vi.useRealTimers();
});

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

describe("buildNoteOn / buildNoteOff (TASK-240)", () => {
  it("Note-On Channel 0 → Status 0x90", () => {
    expect(buildNoteOn(0, 60, 100)).toEqual([0x90, 60, 100]);
  });

  it("Note-Off Channel 0 → Status 0x80", () => {
    expect(buildNoteOff(0, 60)).toEqual([0x80, 60, 0]);
  });

  it("Channel 9 (= Drum-Kanal 10) → Status 0x99 / 0x89", () => {
    expect(buildNoteOn(9, 36, 127)).toEqual([0x99, 36, 127]);
    expect(buildNoteOff(9, 36)).toEqual([0x89, 36, 0]);
  });

  it("clampVelocity beschneidet auf 0..127", () => {
    expect(clampVelocity(-5)).toBe(0);
    expect(clampVelocity(200)).toBe(127);
    expect(clampVelocity(64)).toBe(64);
    expect(clampVelocity(NaN)).toBe(0);
  });

  it("clampMidiChannel beschneidet auf 0..15", () => {
    expect(clampMidiChannel(-1)).toBe(0);
    expect(clampMidiChannel(16)).toBe(15);
    expect(clampMidiChannel(9)).toBe(9);
  });

  it("clampMidiNote beschneidet auf 0..127", () => {
    expect(clampMidiNote(-10)).toBe(0);
    expect(clampMidiNote(999)).toBe(127);
    expect(clampMidiNote(60)).toBe(60);
  });

  it("noteNameFromNumber liefert C4=60, A4=69 etc.", () => {
    expect(noteNameFromNumber(60)).toBe("C4");
    expect(noteNameFromNumber(69)).toBe("A4");
    expect(noteNameFromNumber(36)).toBe("C2");
    expect(noteNameFromNumber(0)).toBe("C-1");
    expect(noteNameFromNumber(127)).toBe("G9");
  });
});

// ─── Per-Part Config ──────────────────────────────────────────────────────────

describe("MidiNoteOut.setPartConfig / clearPartConfig (TASK-240)", () => {
  it("setPartConfig speichert config und liefert sie via getPartConfig zurück", () => {
    const out = new MidiNoteOut(null);
    out.setPartConfig("part-0", {
      outputId: "device-1",
      channel: 9,
      note: 36,
      noteDurationMs: 80,
    });
    const cfg = out.getPartConfig("part-0");
    expect(cfg).toBeTruthy();
    expect(cfg!.outputId).toBe("device-1");
    expect(cfg!.channel).toBe(9);
    expect(cfg!.note).toBe(36);
    expect(cfg!.noteDurationMs).toBe(80);
  });

  it("setPartConfig clamped channel/note/duration", () => {
    const out = new MidiNoteOut(null);
    out.setPartConfig("part-0", {
      outputId: "dev",
      channel: 99,
      note: 999,
      noteDurationMs: -10,
    });
    const cfg = out.getPartConfig("part-0")!;
    expect(cfg.channel).toBe(15);
    expect(cfg.note).toBe(127);
    expect(cfg.noteDurationMs).toBeGreaterThan(0);
  });

  it("clearPartConfig löscht config — danach kein Trigger mehr", () => {
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("part-0", { outputId: "dev", channel: 0, note: 60 });
    out.clearPartConfig("part-0");
    expect(out.getPartConfig("part-0")).toBeNull();
    out.triggerNote("part-0", 0, 100);
    expect(messages.length).toBe(0);
  });

  it("clearAllConfigs entfernt alle", () => {
    const out = new MidiNoteOut(null);
    out.setPartConfig("a", { outputId: "x", channel: 0, note: 36 });
    out.setPartConfig("b", { outputId: "x", channel: 0, note: 38 });
    out.clearAllConfigs();
    expect(out.getPartConfig("a")).toBeNull();
    expect(out.getPartConfig("b")).toBeNull();
  });

  it("isPartConfigured & getAllConfiguredPartIds", () => {
    const out = new MidiNoteOut(null);
    out.setPartConfig("a", { outputId: "x", channel: 0, note: 36 });
    expect(out.isPartConfigured("a")).toBe(true);
    expect(out.isPartConfigured("b")).toBe(false);
    expect(out.getAllConfiguredPartIds().sort()).toEqual(["a"]);
  });
});

// ─── triggerNote ──────────────────────────────────────────────────────────────

describe("MidiNoteOut.triggerNote (TASK-240)", () => {
  it("sendet Note-On + Note-Off (nach Duration)", async () => {
    vi.useFakeTimers();
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("kick", {
      outputId: "elektribe",
      channel: 9,
      note: 36,
      noteDurationMs: 50,
    });
    out.triggerNote("kick", 0, 100);

    // Note-On muss sofort gesendet sein
    expect(messages.length).toBe(1);
    expect(messages[0].outputId).toBe("elektribe");
    expect(messages[0].bytes).toEqual([0x99, 36, 100]);

    // Note-Off erst nach 50ms
    vi.advanceTimersByTime(49);
    expect(messages.length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(messages.length).toBe(2);
    expect(messages[1].outputId).toBe("elektribe");
    expect(messages[1].bytes).toEqual([0x89, 36, 0]);
    vi.useRealTimers();
  });

  it("respektiert noteDurationMs", async () => {
    vi.useFakeTimers();
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("p", {
      outputId: "x", channel: 0, note: 60, noteDurationMs: 200,
    });
    out.triggerNote("p", 0, 100);
    vi.advanceTimersByTime(199);
    expect(messages.length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(messages.length).toBe(2);
    vi.useRealTimers();
  });

  it("ohne config tut triggerNote nichts (keine Exception, keine Message)", () => {
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.triggerNote("unknown", 0, 100);
    expect(messages.length).toBe(0);
  });

  it("triggerNote sendet nicht wenn !enabled", () => {
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setPartConfig("p", { outputId: "x", channel: 0, note: 60 });
    // setEnabled wurde NICHT aufgerufen
    out.triggerNote("p", 0, 100);
    expect(messages.length).toBe(0);
  });

  it("velocity wird auf 0..127 geclampt", () => {
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("p1", { outputId: "x", channel: 0, note: 60, noteDurationMs: 1000 });
    out.setPartConfig("p2", { outputId: "x", channel: 0, note: 61, noteDurationMs: 1000 });
    out.triggerNote("p1", 0, 200);
    expect(messages[0].bytes).toEqual([0x90, 60, 127]);
    out.triggerNote("p2", 0, -50);
    expect(messages[1].bytes).toEqual([0x90, 61, 0]);
  });

  it("channel + note werden korrekt encodet (Status-Byte = 0x90 | channel)", () => {
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("p", { outputId: "x", channel: 5, note: 64, noteDurationMs: 1000 });
    out.triggerNote("p", 0, 64);
    expect(messages[0].bytes).toEqual([0x95, 64, 64]);
    expect(messages[0].outputId).toBe("x");
  });

  it("triggerNote ohne Sender ist no-op (kein Crash)", () => {
    const out = new MidiNoteOut(null);
    out.setEnabled(true);
    out.setPartConfig("p", { outputId: "x", channel: 0, note: 60 });
    expect(() => out.triggerNote("p", 0, 100)).not.toThrow();
  });

  it("setSender Wechsel routet folgende Trigger an neuen Sender", () => {
    const a = captureSender();
    const b = captureSender();
    const out = new MidiNoteOut(a.sender);
    out.setEnabled(true);
    out.setPartConfig("p1", { outputId: "x", channel: 0, note: 60, noteDurationMs: 1000 });
    out.setPartConfig("p2", { outputId: "x", channel: 0, note: 62, noteDurationMs: 1000 });
    out.triggerNote("p1", 0, 100);
    expect(a.messages.length).toBe(1);
    expect(b.messages.length).toBe(0);
    out.setSender(b.sender);
    // unterschiedlicher partId, damit kein Retrigger-Note-Off in b's Bucket landet
    out.triggerNote("p2", 0, 100);
    expect(a.messages.length).toBe(1);
    expect(b.messages.length).toBe(1);
  });

  it("setEnabled(false) während offene Note → allNotesOff feuert sofortige Note-Offs", () => {
    vi.useFakeTimers();
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("p", { outputId: "x", channel: 0, note: 60, noteDurationMs: 5000 });
    out.triggerNote("p", 0, 100);
    expect(messages.length).toBe(1);
    // Beim Disable müssen pending Note-Offs sofort ausgehen.
    out.setEnabled(false);
    // Note-Off (status 0x80) muss da sein
    const lastSent = messages[messages.length - 1];
    expect(lastSent.bytes[0]).toBe(0x80);
    expect(lastSent.bytes[1]).toBe(60);
    vi.useRealTimers();
  });

  it("Sender-Exception wird geschluckt (kein Crash)", () => {
    const out = new MidiNoteOut((_id, _bytes) => { throw new Error("device disconnected"); });
    out.setEnabled(true);
    out.setPartConfig("p", { outputId: "x", channel: 0, note: 60 });
    expect(() => out.triggerNote("p", 0, 100)).not.toThrow();
  });

  it("noteDurationMs default ist DEFAULT_NOTE_DURATION_MS wenn nicht gesetzt", async () => {
    vi.useFakeTimers();
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("p", { outputId: "x", channel: 0, note: 60 });
    out.triggerNote("p", 0, 100);
    expect(messages.length).toBe(1);
    vi.advanceTimersByTime(DEFAULT_NOTE_DURATION_MS - 1);
    expect(messages.length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(messages.length).toBe(2);
    vi.useRealTimers();
  });

  it("retrigger der gleichen Note feuert sofort Note-Off + Note-On (no overlap)", () => {
    vi.useFakeTimers();
    const { sender, messages } = captureSender();
    const out = new MidiNoteOut(sender);
    out.setEnabled(true);
    out.setPartConfig("p", { outputId: "x", channel: 0, note: 60, noteDurationMs: 1000 });
    out.triggerNote("p", 0, 100);
    expect(messages.length).toBe(1); // erste Note-On
    out.triggerNote("p", 0, 80);
    // Erwartung: Note-Off (vorherige) + Note-On (neu) wurden sofort gefeuert
    expect(messages.length).toBe(3);
    expect(messages[1].bytes).toEqual([0x80, 60, 0]);
    expect(messages[2].bytes).toEqual([0x90, 60, 80]);
    vi.useRealTimers();
  });
});
