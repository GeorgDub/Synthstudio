// @vitest-environment jsdom
/**
 * tests/features/use-audio-input-hook.test.ts (TASK-CVG-USE-AUDIO-INPUT / v2.74)
 *
 * Hook-Coverage für useAudioInput + den pure-helper formatRecordingDuration.
 *
 * Mock-Strategie (alles globale Web-Audio/Media-APIs):
 *  - navigator.mediaDevices.getUserMedia + enumerateDevices
 *  - MediaRecorder global (constructor + isTypeSupported + start/stop + onstop)
 *  - AudioContext global (createMediaStreamSource + createAnalyser + close)
 *  - URL.createObjectURL / revokeObjectURL
 *  - requestAnimationFrame / cancelAnimationFrame
 *
 * Wir prüfen damit: Permission-Flow, Constraints inkl. deviceId, recorder.start +
 * ondataavailable + onstop, pendingSample-Lifecycle (confirm/discard) und
 * Cleanup beim Unmount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// ─── Globale DOM-API-Mocks (vor Hook-Import) ─────────────────────────────────

interface FakeMediaTrack { stop: ReturnType<typeof vi.fn>; kind: string; }
interface FakeMediaStream {
  getTracks: () => FakeMediaTrack[];
}

const mediaState = {
  lastConstraints: null as MediaStreamConstraints | null,
  lastStream: null as FakeMediaStream | null,
  enumerateDevicesResult: [] as Array<{ deviceId: string; kind: string; label: string }>,
  getUserMediaShouldFail: false,
  failureError: null as Error | null,
};

const getUserMediaMock = vi.fn(async (constraints: MediaStreamConstraints) => {
  mediaState.lastConstraints = constraints;
  if (mediaState.getUserMediaShouldFail) {
    throw mediaState.failureError ?? new Error("Permission denied");
  }
  const tracks: FakeMediaTrack[] = [{ stop: vi.fn(), kind: "audio" }];
  const stream: FakeMediaStream = { getTracks: () => tracks };
  mediaState.lastStream = stream;
  return stream as unknown as MediaStream;
});

const enumerateDevicesMock = vi.fn(async () => mediaState.enumerateDevicesResult);

Object.defineProperty(navigator, "mediaDevices", {
  value: {
    getUserMedia: getUserMediaMock,
    enumerateDevices: enumerateDevicesMock,
  },
  configurable: true,
  writable: true,
});

// ─── MediaRecorder Mock ──────────────────────────────────────────────────────

const recorderState = {
  lastInstance: null as FakeRecorder | null,
};

class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => { this.onstop?.(); });
  constructor(_stream: unknown, _opts: unknown) {
    recorderState.lastInstance = this;
  }
}
(globalThis as unknown as { MediaRecorder: typeof FakeRecorder }).MediaRecorder = FakeRecorder;

// ─── AudioContext Mock ───────────────────────────────────────────────────────

class FakeAnalyser {
  fftSize = 0;
  frequencyBinCount = 128;
  getByteTimeDomainData(_buf: Uint8Array): void { /* no-op */ }
}
class FakeAudioContext {
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => new FakeAnalyser());
  close = vi.fn(async () => {});
}
(globalThis as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext = FakeAudioContext;

// ─── URL Mocks ───────────────────────────────────────────────────────────────

const createObjectURLMock = vi.fn(() => "blob:fake-url");
const revokeObjectURLMock = vi.fn();
(globalThis.URL as unknown as { createObjectURL: typeof createObjectURLMock }).createObjectURL = createObjectURLMock;
(globalThis.URL as unknown as { revokeObjectURL: typeof revokeObjectURLMock }).revokeObjectURL = revokeObjectURLMock;

// ─── rAF Mock (synchronous-ish) ──────────────────────────────────────────────
// jsdom hat schon requestAnimationFrame; wir lassen das so.

import { useAudioInput, formatRecordingDuration } from "@/hooks/useAudioInput";

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  mediaState.lastConstraints = null;
  mediaState.lastStream = null;
  mediaState.getUserMediaShouldFail = false;
  mediaState.failureError = null;
  mediaState.enumerateDevicesResult = [];
  recorderState.lastInstance = null;
  getUserMediaMock.mockClear();
  enumerateDevicesMock.mockClear();
  createObjectURLMock.mockClear();
  revokeObjectURLMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─── formatRecordingDuration (pure) ──────────────────────────────────────────

describe("formatRecordingDuration – pure-helper", () => {
  it("0ms → '00:00'", () => expect(formatRecordingDuration(0)).toBe("00:00"));
  it("999ms → '00:00' (sub-second truncated)", () => expect(formatRecordingDuration(999)).toBe("00:00"));
  it("5000ms → '00:05'", () => expect(formatRecordingDuration(5000)).toBe("00:05"));
  it("65000ms → '01:05'", () => expect(formatRecordingDuration(65000)).toBe("01:05"));
  it("3600_000ms → '1:00:00' (Stunden-Format)", () => {
    expect(formatRecordingDuration(3_600_000)).toBe("1:00:00");
  });
  it("3725_000ms → '1:02:05'", () => {
    expect(formatRecordingDuration(3_725_000)).toBe("1:02:05");
  });
  it("Stunden-Anteil ohne führende Null beim h-Element", () => {
    expect(formatRecordingDuration(12 * 3600 * 1000)).toBe("12:00:00");
  });
});

// ─── isAvailable Detection ───────────────────────────────────────────────────

describe("useAudioInput – isAvailable", () => {
  it("true wenn navigator.mediaDevices.getUserMedia existiert", () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    expect(result.current.isAvailable).toBe(true);
  });
});

// ─── Initial-State ───────────────────────────────────────────────────────────

describe("useAudioInput – Initial-State", () => {
  it("isRecording=false, error=null, level=0, pendingSample=null, deviceId=undefined", () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.level).toBe(0);
    expect(result.current.pendingSample).toBeNull();
    expect(result.current.deviceId).toBeUndefined();
    expect(result.current.recordingDurationMs).toBe(0);
  });

  it("setDeviceId aktualisiert deviceId-State", () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    act(() => result.current.setDeviceId("mic-1"));
    expect(result.current.deviceId).toBe("mic-1");
  });
});

// ─── refreshDevices ──────────────────────────────────────────────────────────

describe("useAudioInput – refreshDevices", () => {
  it("filtert nur audioinput-Devices und mappt mit Default-Label", async () => {
    mediaState.enumerateDevicesResult = [
      { deviceId: "mic-1", kind: "audioinput", label: "Built-in Mic" },
      { deviceId: "speaker-1", kind: "audiooutput", label: "Built-in Speaker" },
      { deviceId: "mic-2", kind: "audioinput", label: "" }, // empty label
      { deviceId: "cam-1", kind: "videoinput", label: "Camera" },
    ];
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.refreshDevices(); });
    expect(result.current.availableDevices).toHaveLength(2);
    expect(result.current.availableDevices[0]).toEqual({ deviceId: "mic-1", label: "Built-in Mic" });
    expect(result.current.availableDevices[1].label).toMatch(/^Eingang /);
  });

  it("Wenn enumerateDevices wirft: availableDevices bleibt unverändert (silent catch)", async () => {
    enumerateDevicesMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.refreshDevices(); });
    expect(result.current.availableDevices).toEqual([]);
  });
});

// ─── start() Permission-Flow ─────────────────────────────────────────────────

describe("useAudioInput – start()", () => {
  it("ruft getUserMedia mit Standard-Constraints ohne deviceId", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    const constraints = mediaState.lastConstraints!.audio as MediaTrackConstraints;
    expect(constraints.echoCancellation).toBe(true);
    expect(constraints.noiseSuppression).toBe(true);
    expect((constraints as unknown as { deviceId?: unknown }).deviceId).toBeUndefined();
  });

  it("Mit deviceId: Constraints enthält {exact: deviceId}", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    act(() => result.current.setDeviceId("mic-1"));
    await act(async () => { await result.current.start(); });
    const constraints = mediaState.lastConstraints!.audio as MediaTrackConstraints &
      { deviceId?: { exact: string } };
    expect(constraints.deviceId).toEqual({ exact: "mic-1" });
  });

  it("setzt isRecording=true nach erfolgreichem start", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    expect(result.current.isRecording).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("Permission-Denied → error wird gesetzt, isRecording bleibt false", async () => {
    mediaState.getUserMediaShouldFail = true;
    mediaState.failureError = new Error("Permission denied");
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    expect(result.current.error).toBe("Permission denied");
    expect(result.current.isRecording).toBe(false);
  });

  it("Fallback-Error-Message wenn err nicht Error-Instanz", async () => {
    mediaState.getUserMediaShouldFail = true;
    getUserMediaMock.mockImplementationOnce(async () => {
      throw "string-error";
    });
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    expect(result.current.error).toBe("Mikrofon-Zugriff verweigert");
  });

  it("Doppelter start(): kein zweiter getUserMedia-Call (Idempotenz)", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.start(); });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });

  it("MediaRecorder wird mit start(100) für 100ms-Chunks aufgerufen", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    expect(recorderState.lastInstance!.start).toHaveBeenCalledWith(100);
  });
});

// ─── Duration-Timer ──────────────────────────────────────────────────────────

describe("useAudioInput – Duration-Timer", () => {
  it("recordingDurationMs aktualisiert sich nach setInterval-Tick", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    expect(result.current.recordingDurationMs).toBe(0);

    act(() => { vi.advanceTimersByTime(550); });
    // Der Timer tickt alle 100ms — nach 550ms sollte der Wert > 0 sein.
    expect(result.current.recordingDurationMs).toBeGreaterThan(0);
  });
});

// ─── stop() + onstop → pendingSample ─────────────────────────────────────────

describe("useAudioInput – stop() → pendingSample-Lifecycle", () => {
  it("stop() triggered recorder.stop + isRecording=false", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    const stopSpy = recorderState.lastInstance!.stop;
    act(() => result.current.stop());
    expect(stopSpy).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });

  it("recorder.onstop setzt pendingSample mit URL + defaultName + durationSec", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    act(() => result.current.stop());
    expect(result.current.pendingSample).not.toBeNull();
    expect(result.current.pendingSample!.url).toBe("blob:fake-url");
    expect(result.current.pendingSample!.defaultName).toMatch(/^Recording \d+ \([\d.]+s\)$/);
    expect(typeof result.current.pendingSample!.durationSec).toBe("number");
  });

  it("Bei onstop werden alle Stream-Tracks gestoppt", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    const trackStopSpy = mediaState.lastStream!.getTracks()[0].stop;
    act(() => result.current.stop());
    expect(trackStopSpy).toHaveBeenCalled();
  });

  it("stop() ohne aktive Aufnahme ist no-op", () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    expect(() => act(() => result.current.stop())).not.toThrow();
  });
});

// ─── confirmPendingSample + discardPendingSample ─────────────────────────────

describe("useAudioInput – pendingSample confirm/discard", () => {
  it("confirmPendingSample(name) ruft onSample mit getrimmtem Namen", async () => {
    const onSample = vi.fn();
    const { result } = renderHook(() => useAudioInput({ onSample }));
    await act(async () => { await result.current.start(); });
    act(() => result.current.stop());
    act(() => result.current.confirmPendingSample("  My Take  "));
    expect(onSample).toHaveBeenCalledWith("blob:fake-url", "My Take", expect.any(Number));
    expect(result.current.pendingSample).toBeNull();
  });

  it("confirmPendingSample('') → defaultName wird benutzt", async () => {
    const onSample = vi.fn();
    const { result } = renderHook(() => useAudioInput({ onSample }));
    await act(async () => { await result.current.start(); });
    act(() => result.current.stop());
    const defaultName = result.current.pendingSample!.defaultName;
    act(() => result.current.confirmPendingSample(""));
    expect(onSample).toHaveBeenCalledWith("blob:fake-url", defaultName, expect.any(Number));
  });

  it("confirmPendingSample ohne pendingSample: no-op (onSample NICHT aufgerufen)", () => {
    const onSample = vi.fn();
    const { result } = renderHook(() => useAudioInput({ onSample }));
    act(() => result.current.confirmPendingSample("name"));
    expect(onSample).not.toHaveBeenCalled();
  });

  it("discardPendingSample revoked die Blob-URL + clearet pendingSample", async () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    act(() => result.current.stop());
    expect(result.current.pendingSample).not.toBeNull();

    act(() => result.current.discardPendingSample());
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:fake-url");
    expect(result.current.pendingSample).toBeNull();
  });

  it("discardPendingSample ohne pendingSample: kein revoke, kein crash", () => {
    const { result } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    act(() => result.current.discardPendingSample());
    expect(revokeObjectURLMock).not.toHaveBeenCalled();
  });
});

// ─── Cleanup beim Unmount ────────────────────────────────────────────────────

describe("useAudioInput – Cleanup beim Unmount", () => {
  it("Aktive Aufnahme: Unmount stoppt Stream-Tracks", async () => {
    const { result, unmount } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    await act(async () => { await result.current.start(); });
    const trackStopSpy = mediaState.lastStream!.getTracks()[0].stop;
    unmount();
    expect(trackStopSpy).toHaveBeenCalled();
  });

  it("Ohne Aufnahme: Unmount crasht nicht", () => {
    const { unmount } = renderHook(() => useAudioInput({ onSample: vi.fn() }));
    expect(() => unmount()).not.toThrow();
  });
});
