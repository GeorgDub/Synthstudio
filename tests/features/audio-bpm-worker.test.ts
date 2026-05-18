/**
 * tests/features/audio-bpm-worker.test.ts (v3.54.0)
 *
 * Tests für den BPM-Worker-Client (client/src/utils/bpmWorkerClient.ts).
 * Closes v3.53-Caveat (Auto-BPM auf Main-Thread).
 *
 * Coverage:
 *  - encodeBufferToMonoWav: korrektes RIFF/WAVE-Format + 30s-Trim
 *  - analyzeBpmInWorker mit Test-Override (Worker-Roundtrip Mock)
 *  - Worker-Fail → null (silent fallback ist Caller-Responsibility)
 *  - __resetBpmWorkerClientForTests Cleanup
 *
 * env: node — Worker-Global ist undefiniert, ensureWorker() returnt null,
 * Tests nutzen `__bpmWorkerTestOverride` für deterministische Resultate.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  analyzeBpmInWorker,
  encodeBufferToMonoWav,
  __resetBpmWorkerClientForTests,
  __getBpmWorkerPendingCount,
  BPM_WORKER_MAX_DURATION_SEC,
} from "@/utils/bpmWorkerClient";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FakeAudioBuffer {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData: (ch: number) => Float32Array;
  duration: number;
}

function makeFakeBuffer(durationSec: number, sampleRate = 44100): FakeAudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 0.5;
  }
  return {
    sampleRate,
    length,
    numberOfChannels: 1,
    duration: durationSec,
    getChannelData: () => data,
  };
}

function readAscii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  __resetBpmWorkerClientForTests();
});

afterEach(() => {
  __resetBpmWorkerClientForTests();
});

// ─── Tests: WAV-Encoder ──────────────────────────────────────────────────────

describe("v3.54.0 — encodeBufferToMonoWav", () => {
  it("erzeugt gültigen RIFF/WAVE Header (44 Bytes) bei 1 Sekunde Audio", () => {
    const buf = makeFakeBuffer(1.0, 44100);
    const wav = encodeBufferToMonoWav(buf as unknown as AudioBuffer);
    expect(wav).toBeInstanceOf(ArrayBuffer);
    const view = new DataView(wav);

    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(readAscii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // Mono
    expect(view.getUint32(24, true)).toBe(44100); // SR
    expect(view.getUint16(34, true)).toBe(16); // 16-bit
    expect(readAscii(view, 36, 4)).toBe("data");

    // Größe: 44 Header + 44100 * 2 Bytes (16-bit Mono)
    expect(wav.byteLength).toBe(44 + 44100 * 2);
  });

  it("trimmt sehr lange Buffer auf 30 Sekunden", () => {
    const buf = makeFakeBuffer(BPM_WORKER_MAX_DURATION_SEC + 10, 44100);
    const wav = encodeBufferToMonoWav(buf as unknown as AudioBuffer);
    const expectedSamples = BPM_WORKER_MAX_DURATION_SEC * 44100;
    expect(wav.byteLength).toBe(44 + expectedSamples * 2);
  });

  it("clipt Samples auf [-1, 1] vor 16-bit-Konvertierung", () => {
    const buf: FakeAudioBuffer = {
      sampleRate: 100,
      length: 4,
      numberOfChannels: 1,
      duration: 0.04,
      getChannelData: () => new Float32Array([2.0, -2.0, 0.5, -0.5]),
    };
    const wav = encodeBufferToMonoWav(buf as unknown as AudioBuffer);
    const view = new DataView(wav);
    // Erstes Sample: 2.0 → geclamped auf 1.0 → 0x7FFF (32767)
    expect(view.getInt16(44, true)).toBe(0x7fff);
    // Zweites Sample: -2.0 → -1.0 → -0x8000 (-32768)
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});

// ─── Tests: analyzeBpmInWorker mit Test-Override ─────────────────────────────

describe("v3.54.0 — analyzeBpmInWorker (Test-Override-Pfad)", () => {
  it("Worker-Message round-trip via Override liefert {bpm, confidence}", async () => {
    (globalThis as { __bpmWorkerTestOverride?: unknown }).__bpmWorkerTestOverride =
      async (_buf: AudioBuffer) => ({ bpm: 128, confidence: 0.85 });

    const buf = makeFakeBuffer(2.0);
    const r = await analyzeBpmInWorker(buf as unknown as AudioBuffer);
    expect(r).toEqual({ bpm: 128, confidence: 0.85 });
  });

  it("Override kann null returnen → analyzeBpmInWorker liefert null", async () => {
    (globalThis as { __bpmWorkerTestOverride?: unknown }).__bpmWorkerTestOverride =
      async (_buf: AudioBuffer) => null;

    const buf = makeFakeBuffer(2.0);
    const r = await analyzeBpmInWorker(buf as unknown as AudioBuffer);
    expect(r).toBeNull();
  });
});

// ─── Tests: Worker-Fail-Fallback ────────────────────────────────────────────

describe("v3.54.0 — Worker-Fail Silent-Fallback (kein Worker im Node-Env)", () => {
  it("ohne Worker-Global → analyzeBpmInWorker liefert null", async () => {
    // Sicherstellen dass kein Override gesetzt ist
    delete (globalThis as { __bpmWorkerTestOverride?: unknown }).__bpmWorkerTestOverride;
    // Worker-Global ist im Node-Test-Env undefined → ensureWorker() → null

    const buf = makeFakeBuffer(2.0);
    const r = await analyzeBpmInWorker(buf as unknown as AudioBuffer);
    expect(r).toBeNull();
  });

  it("__resetBpmWorkerClientForTests setzt Pending-Count auf 0", () => {
    expect(__getBpmWorkerPendingCount()).toBe(0);
    __resetBpmWorkerClientForTests();
    expect(__getBpmWorkerPendingCount()).toBe(0);
  });
});
