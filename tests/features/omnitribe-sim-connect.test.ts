// @vitest-environment jsdom
/**
 * omnitribe-sim-connect.test.ts — Sprint-97 UI Connect-Button-Tests.
 *
 * Verifiziert:
 *   - useOmniTribe.connectSim() oeffnet WebSocket auf der gegebenen URL
 *   - simConnection-State transitions: idle → connecting → connected
 *   - Fehler-Path: onerror setzt state auf "error"
 *   - DEFAULT_SIM_WS_URL ist ws://localhost:8744
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useOmniTribe, DEFAULT_SIM_WS_URL,
} from "../../client/src/hooks/useOmniTribe";

// ─── Fake WebSocket installiert vor jedem Test ──────────

interface CapturedWs {
  url: string;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: ArrayBuffer | string }) => void) | null;
  binaryType: string;
  closed: boolean;
  sent: unknown[];
}

let capturedWs: CapturedWs | null = null;

class FakeWebSocket {
  url: string;
  binaryType = "";
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer | string }) => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  constructor(url: string) {
    this.url = url;
    capturedWs = this as unknown as CapturedWs;
  }
  send(data: unknown): void { this.sent.push(data); }
  close(): void { this.closed = true; this.onclose?.(); }
}

describe("useOmniTribe.connectSim (Sprint-97)", () => {
  let origWebSocket: typeof WebSocket;

  beforeEach(() => {
    origWebSocket = globalThis.WebSocket;
    // Override with fake
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
    capturedWs = null;
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      origWebSocket;
    capturedWs = null;
  });

  it("DEFAULT_SIM_WS_URL points to localhost:8744", () => {
    expect(DEFAULT_SIM_WS_URL).toBe("ws://localhost:8744");
  });

  it("initial simConnection state is idle", () => {
    const { result } = renderHook(() => useOmniTribe());
    expect(result.current.simConnection.state).toBe("idle");
  });

  it("connectSim with default URL constructs a WebSocket", async () => {
    const { result } = renderHook(() => useOmniTribe());
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.connectSim();
    });
    expect(capturedWs).not.toBeNull();
    expect(capturedWs!.url).toBe(DEFAULT_SIM_WS_URL);
    // State immediately "connecting"
    expect(result.current.simConnection.state).toBe("connecting");
    if (result.current.simConnection.state === "connecting") {
      expect(result.current.simConnection.url).toBe(DEFAULT_SIM_WS_URL);
    }
    // Simulate ws.onopen → Bridge connectWebSocket resolved with true
    await act(async () => {
      capturedWs!.onopen?.(new Event("open"));
      await promise;
    });
    expect(result.current.simConnection.state).toBe("connected");
    expect(result.current.connected).toBe(true);
  });

  it("connectSim with custom URL uses that URL", async () => {
    const { result } = renderHook(() => useOmniTribe());
    const customUrl = "ws://192.168.1.42:9000/sysex";
    act(() => {
      result.current.connectSim(customUrl);
    });
    expect(capturedWs!.url).toBe(customUrl);
    if (result.current.simConnection.state === "connecting") {
      expect(result.current.simConnection.url).toBe(customUrl);
    }
  });

  it("connectSim sets binaryType to arraybuffer", () => {
    const { result } = renderHook(() => useOmniTribe());
    act(() => { result.current.connectSim(); });
    expect(capturedWs!.binaryType).toBe("arraybuffer");
  });

  it("ws.onerror transitions to error state", async () => {
    const { result } = renderHook(() => useOmniTribe());
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.connectSim();
    });
    await act(async () => {
      capturedWs!.onerror?.(new Event("error"));
      const ok = await promise;
      expect(ok).toBe(false);
    });
    expect(result.current.simConnection.state).toBe("error");
    if (result.current.simConnection.state === "error") {
      expect(result.current.simConnection.message).toMatch(/failed/);
    }
  });

  it("disconnect resets simConnection to idle", async () => {
    const { result } = renderHook(() => useOmniTribe());
    let promise!: Promise<boolean>;
    act(() => { promise = result.current.connectSim(); });
    await act(async () => {
      capturedWs!.onopen?.(new Event("open"));
      await promise;
    });
    expect(result.current.simConnection.state).toBe("connected");
    act(() => { result.current.disconnect(); });
    expect(result.current.simConnection.state).toBe("idle");
    expect(result.current.connected).toBe(false);
  });

  it("connectSim while already connected disconnects first", async () => {
    const { result } = renderHook(() => useOmniTribe());
    let promise!: Promise<boolean>;
    act(() => { promise = result.current.connectSim("ws://a"); });
    await act(async () => {
      capturedWs!.onopen?.(new Event("open"));
      await promise;
    });
    expect(result.current.simConnection.state).toBe("connected");
    const firstWs = capturedWs;
    // Connect again with different URL — should open new WS
    act(() => { promise = result.current.connectSim("ws://b"); });
    expect(capturedWs).not.toBe(firstWs);
    expect(capturedWs!.url).toBe("ws://b");
  });
});
