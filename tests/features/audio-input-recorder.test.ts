/**
 * tests/features/audio-input-recorder.test.ts
 *
 * Pure-Logic-Tests für die Duration-Format-Funktion aus useAudioInput.
 *
 * Was NICHT getestet wird (braucht jsdom + MediaRecorder + getUserMedia):
 *  - Der eigentliche Recording-Flow
 *  - Device-Enumeration (navigator.mediaDevices.enumerateDevices)
 *  - PendingSample state machine
 */
import { describe, it, expect } from "vitest";
import { formatRecordingDuration } from "../../client/src/hooks/useAudioInput";

describe("formatRecordingDuration", () => {
  it("formattiert 0 ms als 00:00", () => {
    expect(formatRecordingDuration(0)).toBe("00:00");
  });

  it("formattiert < 1 Sekunde als 00:00", () => {
    expect(formatRecordingDuration(500)).toBe("00:00");
    expect(formatRecordingDuration(999)).toBe("00:00");
  });

  it("formattiert exakte Sekunden", () => {
    expect(formatRecordingDuration(1000)).toBe("00:01");
    expect(formatRecordingDuration(15000)).toBe("00:15");
    expect(formatRecordingDuration(59000)).toBe("00:59");
  });

  it("formattiert Minuten mit Sekunden-padding", () => {
    expect(formatRecordingDuration(60000)).toBe("01:00");
    expect(formatRecordingDuration(60500)).toBe("01:00");
    expect(formatRecordingDuration(65000)).toBe("01:05");
    expect(formatRecordingDuration(125000)).toBe("02:05");
  });

  it("formattiert genau 10 Minuten als 10:00", () => {
    expect(formatRecordingDuration(600000)).toBe("10:00");
  });

  it("formattiert genau 59 Minuten 59 Sekunden als 59:59", () => {
    expect(formatRecordingDuration(59 * 60 * 1000 + 59 * 1000)).toBe("59:59");
  });

  it("formattiert Stunden als h:mm:ss (3 Komponenten)", () => {
    expect(formatRecordingDuration(60 * 60 * 1000)).toBe("1:00:00");
    expect(formatRecordingDuration(60 * 60 * 1000 + 65000)).toBe("1:01:05");
    expect(formatRecordingDuration(2 * 60 * 60 * 1000 + 35 * 60 * 1000 + 12 * 1000))
      .toBe("2:35:12");
  });

  it("rundet abwärts (floor) statt zu runden", () => {
    expect(formatRecordingDuration(1999)).toBe("00:01"); // nicht 00:02
    expect(formatRecordingDuration(59999)).toBe("00:59"); // nicht 01:00
  });

  it("Stunden: padding bleibt 2-stellig für Minuten und Sekunden", () => {
    expect(formatRecordingDuration(60 * 60 * 1000 + 5 * 1000)).toBe("1:00:05");
    expect(formatRecordingDuration(60 * 60 * 1000 + 9 * 60 * 1000)).toBe("1:09:00");
  });
});
