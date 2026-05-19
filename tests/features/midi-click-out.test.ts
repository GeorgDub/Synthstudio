/**
 * tests/features/midi-click-out.test.ts
 *
 * Unit-Tests fuer MidiClickOut + useMidiClickStore (v3.98.0).
 *
 * Test-Strategie analog midi-clock-out.test.ts / midi-note-out.test.ts:
 *   - Dependency-Injection-Sender → wir capturen alle gesendeten Bytes in ein
 *     Array. Damit ohne Web-MIDI deterministisch testbar.
 *   - Beat-Detection via detectClickKind (pure) → keine AudioContext-Mocks
 *     noetig.
 *   - localStorage-Round-Trip via __resetMidiClickStoreForTests +
 *     setMidiClickState (Schema v1 = lokales Click-Store-Schema, NICHT das
 *     .synth-Project-Schema).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MidiClickOut,
  detectClickKind,
  buildClickNoteOn,
  buildClickNoteOff,
  clampClickChannel,
  clampClickNote,
  clampClickVelocity,
  defaultClickConfig,
  DEFAULT_ACCENT_NOTE,
  DEFAULT_BEAT_NOTE,
  DEFAULT_ACCENT_VELOCITY,
  DEFAULT_BEAT_VELOCITY,
  DEFAULT_CLICK_CHANNEL,
} from "../../client/src/audio/MidiClickOut";
import {
  __resetMidiClickStoreForTests,
  getMidiClickState,
  setMidiClickEnabled,
  setMidiClickOutputDevice,
  setMidiClickChannel,
  setMidiClickAccentNote,
  setMidiClickBeatNote,
  setMidiClickVelocityAccent,
  setMidiClickVelocityBeat,
  setMidiClickState,
} from "../../client/src/store/useMidiClickStore";

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

beforeEach(() => {
  vi.useRealTimers();
  __resetMidiClickStoreForTests();
});

// ─── detectClickKind (Pure) ───────────────────────────────────────────────────

describe("detectClickKind (v3.98)", () => {
  it("16 Steps / 4 beats: Step 0 → accent, 4/8/12 → beat, sonst null", () => {
    expect(detectClickKind(0, 16, 4)).toBe("accent");
    expect(detectClickKind(4, 16, 4)).toBe("beat");
    expect(detectClickKind(8, 16, 4)).toBe("beat");
    expect(detectClickKind(12, 16, 4)).toBe("beat");
    // Non-Beat-Steps:
    expect(detectClickKind(1, 16, 4)).toBe(null);
    expect(detectClickKind(3, 16, 4)).toBe(null);
    expect(detectClickKind(7, 16, 4)).toBe(null);
    expect(detectClickKind(15, 16, 4)).toBe(null);
  });

  it("32 Steps / 4 beats: Step 0 → accent, 8/16/24 → beat", () => {
    expect(detectClickKind(0, 32, 4)).toBe("accent");
    expect(detectClickKind(8, 32, 4)).toBe("beat");
    expect(detectClickKind(16, 32, 4)).toBe("beat");
    expect(detectClickKind(24, 32, 4)).toBe("beat");
    expect(detectClickKind(5, 32, 4)).toBe(null);
    expect(detectClickKind(31, 32, 4)).toBe(null);
  });

  it("Ungueltige Inputs liefern null (Defense)", () => {
    expect(detectClickKind(-1, 16, 4)).toBe(null);
    expect(detectClickKind(16, 16, 4)).toBe(null);
    expect(detectClickKind(0, 0, 4)).toBe(null);
    expect(detectClickKind(0, 16, 0)).toBe(null);
    expect(detectClickKind(NaN, 16, 4)).toBe(null);
  });
});

// ─── Pure Builders + Clamps ────────────────────────────────────────────────

describe("buildClickNoteOn / buildClickNoteOff (v3.98)", () => {
  it("Note-On Channel 9 (Drum-Ch 10) → Status 0x99", () => {
    expect(buildClickNoteOn(9, 76, 110)).toEqual([0x99, 76, 110]);
  });

  it("Note-Off Channel 9 → Status 0x89, vel=0", () => {
    expect(buildClickNoteOff(9, 76)).toEqual([0x89, 76, 0]);
  });

  it("Clamps Velocity/Note/Channel auf valide Bereiche", () => {
    expect(clampClickVelocity(999)).toBe(127);
    expect(clampClickVelocity(-1)).toBe(0);
    expect(clampClickNote(200)).toBe(127);
    expect(clampClickChannel(20)).toBe(15);
    expect(clampClickChannel(-5)).toBe(0);
    // NaN-Defense:
    expect(clampClickVelocity(NaN)).toBe(0);
    expect(clampClickChannel(NaN)).toBe(DEFAULT_CLICK_CHANNEL);
  });
});

// ─── MidiClickOut Trigger ──────────────────────────────────────────────────

describe("MidiClickOut.triggerStep — enabled + valid (v3.98)", () => {
  it("enabled + step 0 + outputId → accent-note Note-On gesendet", () => {
    const { sender, messages } = captureSender();
    const clock = new MidiClickOut(sender);
    clock.setEnabled(true);
    clock.setConfig({ outputId: "out-1", channel: 9, accentNote: 76, beatNote: 77, accentVelocity: 120, beatVelocity: 80 });

    const fired = clock.triggerStep(0, 16, 4);

    expect(fired).toBe(true);
    expect(messages.length).toBe(1);
    expect(messages[0].outputId).toBe("out-1");
    // Note-On Channel 9, Note 76 (accent), Velocity 120:
    expect(messages[0].bytes).toEqual([0x99, 76, 120]);
  });

  it("step 4/8/12 (16-step, 4 beats) → beat-note Note-On gesendet", () => {
    const { sender, messages } = captureSender();
    const clock = new MidiClickOut(sender);
    clock.setEnabled(true);
    clock.setConfig({ outputId: "out-1", channel: 9, accentNote: 76, beatNote: 77, accentVelocity: 120, beatVelocity: 80 });

    clock.triggerStep(4, 16, 4);
    clock.triggerStep(8, 16, 4);
    clock.triggerStep(12, 16, 4);

    expect(messages.length).toBe(3);
    expect(messages[0].bytes).toEqual([0x99, 77, 80]);
    expect(messages[1].bytes).toEqual([0x99, 77, 80]);
    expect(messages[2].bytes).toEqual([0x99, 77, 80]);
  });

  it("non-beat steps (1/2/3/5/7/15) → keine MIDI-Send", () => {
    const { sender, messages } = captureSender();
    const clock = new MidiClickOut(sender);
    clock.setEnabled(true);
    clock.setConfig({ outputId: "out-1" });

    [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].forEach(i => {
      clock.triggerStep(i, 16, 4);
    });

    expect(messages.length).toBe(0);
  });
});

describe("MidiClickOut.triggerStep — disabled + missing config (v3.98)", () => {
  it("disabled → kein Send selbst bei Beat-Step", () => {
    const { sender, messages } = captureSender();
    const clock = new MidiClickOut(sender);
    // setEnabled NICHT aufgerufen → default false
    clock.setConfig({ outputId: "out-1" });

    const fired = clock.triggerStep(0, 16, 4);

    expect(fired).toBe(false);
    expect(messages.length).toBe(0);
  });

  it("enabled aber kein outputId → kein Send", () => {
    const { sender, messages } = captureSender();
    const clock = new MidiClickOut(sender);
    clock.setEnabled(true);
    // outputId default = null

    const fired = clock.triggerStep(0, 16, 4);

    expect(fired).toBe(false);
    expect(messages.length).toBe(0);
  });

  it("setEnabled(false) waehrend pending Note-Off → flusht sofort Note-Off", async () => {
    vi.useFakeTimers();
    const { sender, messages } = captureSender();
    const clock = new MidiClickOut(sender);
    clock.setEnabled(true);
    clock.setConfig({ outputId: "out-1", accentNote: 76, channel: 9 });

    clock.triggerStep(0, 16, 4);
    expect(messages.length).toBe(1); // Note-On

    // Disable BEVOR der 50ms-Timer abgelaufen ist:
    clock.setEnabled(false);
    // Note-Off muss sofort gesendet sein:
    expect(messages.length).toBe(2);
    expect(messages[1].bytes).toEqual([0x89, 76, 0]);

    // Selbst wenn Timer feuert, kein doppelter Off (Timer wurde gecleart):
    vi.advanceTimersByTime(100);
    expect(messages.length).toBe(2);
    vi.useRealTimers();
  });
});

// ─── Store — Persistence + Round-Trip ──────────────────────────────────────

describe("useMidiClickStore — Persistence (v3.98 Schema v1)", () => {
  it("Default-State: disabled, outputDeviceId=null, channel=9, notes=76/77", () => {
    const s = getMidiClickState();
    expect(s.enabled).toBe(false);
    expect(s.outputDeviceId).toBe(null);
    expect(s.channel).toBe(DEFAULT_CLICK_CHANNEL);
    expect(s.accentNote).toBe(DEFAULT_ACCENT_NOTE);
    expect(s.beatNote).toBe(DEFAULT_BEAT_NOTE);
    expect(s.velocityAccent).toBe(DEFAULT_ACCENT_VELOCITY);
    expect(s.velocityBeat).toBe(DEFAULT_BEAT_VELOCITY);
  });

  it("Round-Trip: setMidiClickState → localStorage → reload mantains Werte", () => {
    setMidiClickState({
      enabled: true,
      outputDeviceId: "korg-volca-out",
      channel: 5,
      accentNote: 60,
      beatNote: 62,
      velocityAccent: 100,
      velocityBeat: 50,
    });

    const persisted = localStorage.getItem("synthstudio:midi:clickout:v1");
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted!);
    expect(parsed.enabled).toBe(true);
    expect(parsed.outputDeviceId).toBe("korg-volca-out");
    expect(parsed.channel).toBe(5);
    expect(parsed.accentNote).toBe(60);
    expect(parsed.beatNote).toBe(62);
    expect(parsed.velocityAccent).toBe(100);
    expect(parsed.velocityBeat).toBe(50);

    // Aktueller State spiegelt die Werte:
    const s = getMidiClickState();
    expect(s.enabled).toBe(true);
    expect(s.outputDeviceId).toBe("korg-volca-out");
    expect(s.channel).toBe(5);
  });

  it("Setter clampen invaliden Input (Defense gegen User-Garbage)", () => {
    setMidiClickChannel(99);
    expect(getMidiClickState().channel).toBe(15);
    setMidiClickAccentNote(-10);
    expect(getMidiClickState().accentNote).toBe(0);
    setMidiClickVelocityAccent(999);
    expect(getMidiClickState().velocityAccent).toBe(127);
    setMidiClickVelocityBeat(-5);
    expect(getMidiClickState().velocityBeat).toBe(0);
  });

  it("setMidiClickEnabled + Device-Toggle wirken idempotent (kein-notify-bei-Gleich)", () => {
    setMidiClickEnabled(true);
    expect(getMidiClickState().enabled).toBe(true);
    setMidiClickEnabled(true); // idempotent
    expect(getMidiClickState().enabled).toBe(true);

    setMidiClickOutputDevice("dev-1");
    expect(getMidiClickState().outputDeviceId).toBe("dev-1");
    setMidiClickOutputDevice("");
    expect(getMidiClickState().outputDeviceId).toBe(null);
  });
});

// ─── defaultClickConfig + Integration ──────────────────────────────────────

describe("defaultClickConfig + MidiClickOut Integration (v3.98)", () => {
  it("defaultClickConfig liefert sinnvolle Defaults (Drum-Ch 10, Wood-Block-Notes)", () => {
    const c = defaultClickConfig();
    expect(c.outputId).toBe(null);
    expect(c.channel).toBe(9);
    expect(c.accentNote).toBe(76);
    expect(c.beatNote).toBe(77);
    expect(c.accentVelocity).toBe(110);
    expect(c.beatVelocity).toBe(80);
  });

  it("setConfig partial-update preserved nicht-gesetzte Felder", () => {
    const clock = new MidiClickOut();
    clock.setConfig({ outputId: "out-1", channel: 5 });
    const c1 = clock.getConfig();
    expect(c1.outputId).toBe("out-1");
    expect(c1.channel).toBe(5);
    expect(c1.accentNote).toBe(76); // unchanged

    clock.setConfig({ accentNote: 60 });
    const c2 = clock.getConfig();
    expect(c2.outputId).toBe("out-1"); // preserved
    expect(c2.accentNote).toBe(60);
  });
});
