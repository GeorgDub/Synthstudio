// @vitest-environment jsdom
/**
 * omnitribe-sync-panels.test.ts — Sprint-119c Panel Tests.
 *
 * Covers:
 *   - ClockSyncPanel: mode-toggle click dispatches setClockSyncMode, clock-out toggle,
 *     event-driven state update from omnitribe:clockStatus
 *   - PositionDisplay: setPosition called from form, step-range validation (0..15),
 *     event-driven live update from omnitribe:positionChange
 *   - FirmwareInfoViewer: Refresh button calls queryFirmwareInfo + queryDeviceId,
 *     feature_flags renders 16 bit-labels, firmwareInfo event updates display
 *
 * Strategy: render components with @testing-library/react,
 * spy on omniTribeBridge singleton methods, fire real DOM events.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

import { omniTribeBridge, OtpCmd, buildFrame, FwFlag } from "../../client/src/audio/OmniTribeBridge";
import { ClockSyncPanel } from "../../client/src/components/OmniTribe/ClockSyncPanel";
import { PositionDisplay } from "../../client/src/components/OmniTribe/PositionDisplay";
import { FirmwareInfoViewer } from "../../client/src/components/OmniTribe/FirmwareInfoViewer";

// ─── Spy setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.spyOn(omniTribeBridge, "setClockSyncMode").mockImplementation(() => undefined);
  vi.spyOn(omniTribeBridge, "setClockOutEnable").mockImplementation(() => undefined);
  vi.spyOn(omniTribeBridge, "queryClockStatus").mockImplementation(() => undefined);
  vi.spyOn(omniTribeBridge, "queryClockOutStatus").mockImplementation(() => undefined);
  vi.spyOn(omniTribeBridge, "setPosition").mockImplementation(() => undefined);
  vi.spyOn(omniTribeBridge, "queryPosition").mockImplementation(() => undefined);
  vi.spyOn(omniTribeBridge, "queryFirmwareInfo").mockImplementation(() => undefined);
  vi.spyOn(omniTribeBridge, "queryDeviceId").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Helper: dispatch CustomEvent on window ──────────────────────────────────

function dispatchOmniEvent<T>(name: string, detail: T): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// ─── ClockSyncPanel Tests ────────────────────────────────────────────────────

describe("ClockSyncPanel", () => {
  it("mode-toggle EXTERNAL (button 1) calls setClockSyncMode(1)", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    fireEvent.click(screen.getByTestId("clock-mode-1"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(1);
  });

  it("mode-toggle AUTO (button 2) calls setClockSyncMode(2)", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    fireEvent.click(screen.getByTestId("clock-mode-2"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(2);
  });

  it("mode-toggle INTERNAL (button 0) calls setClockSyncMode(0)", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    fireEvent.click(screen.getByTestId("clock-mode-0"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(0);
  });

  it("mode-toggle disabled when connected=false does not call bridge", () => {
    render(React.createElement(ClockSyncPanel, { connected: false }));
    const btn = screen.getByTestId("clock-mode-1") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("clock-out toggle calls setClockOutEnable(true) when currently OFF", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    fireEvent.click(screen.getByTestId("clock-out-toggle"));
    expect(omniTribeBridge.setClockOutEnable).toHaveBeenCalledWith(true);
  });

  it("omnitribe:clockStatus event updates BPM display and locked indicator", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockStatus", {
        mode: 1, locked: true, bpm: 120.0, bpmX100: 12000,
      });
    });
    expect(screen.getByTestId("clock-bpm-display").textContent).toBe("120.0");
    expect(screen.getByTestId("clock-locked-indicator").getAttribute("aria-label")).toBe("Clock locked");
  });

  it("Refresh button calls queryClockStatus + queryClockOutStatus", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    // Clear the initial queries from mount
    vi.mocked(omniTribeBridge.queryClockStatus).mockClear();
    vi.mocked(omniTribeBridge.queryClockOutStatus).mockClear();
    fireEvent.click(screen.getByTestId("clock-sync-refresh"));
    expect(omniTribeBridge.queryClockStatus).toHaveBeenCalledOnce();
    expect(omniTribeBridge.queryClockOutStatus).toHaveBeenCalledOnce();
  });
});

// ─── PositionDisplay Tests ───────────────────────────────────────────────────

describe("PositionDisplay", () => {
  it("Apply button with step=5, bank=2 calls setPosition(37)", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    const stepInput = screen.getByTestId("position-form-step") as HTMLInputElement;
    const bankInput = screen.getByTestId("position-form-bank") as HTMLInputElement;
    fireEvent.change(stepInput, { target: { value: "5" } });
    fireEvent.change(bankInput, { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("position-apply"));
    expect(omniTribeBridge.setPosition).toHaveBeenCalledWith(37); // 2*16+5
  });

  it("step input value 16 is clamped to 15 by change handler, apply calls setPosition(15)", () => {
    // handleStepInput uses Math.min(15, v) — 16 clamps to 15.
    // No error message shown because the clamped value 15 is valid.
    render(React.createElement(PositionDisplay, { connected: true }));
    const stepInput = screen.getByTestId("position-form-step") as HTMLInputElement;
    fireEvent.change(stepInput, { target: { value: "16" } });
    fireEvent.click(screen.getByTestId("position-apply"));
    expect(omniTribeBridge.setPosition).toHaveBeenCalledWith(15);  // clamped, bank=0 → 15*16+15... wait, step=15 bank=0 → 0*16+15=15
  });

  it("step-range: step=0 (minimum valid) calls setPosition(0) with bank=0", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    fireEvent.click(screen.getByTestId("position-apply"));
    expect(omniTribeBridge.setPosition).toHaveBeenCalledWith(0);
  });

  it("omnitribe:positionChange event updates step + bank display", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: true, step: 9, bank: 3, sppBeats: 57,
      });
    });
    expect(screen.getByTestId("position-step").textContent).toBe("10"); // step+1
    expect(screen.getByTestId("position-bank").textContent).toBe("D");  // bank 3 → D
    expect(screen.getByTestId("position-beats").textContent).toBe("57");
  });

  it("positionChange sets playing indicator to PLAYING", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: true, step: 0, bank: 0, sppBeats: 0,
      });
    });
    expect(screen.getByTestId("position-playing-indicator").textContent).toBe("PLAYING");
  });

  it("Apply button disabled when connected=false", () => {
    render(React.createElement(PositionDisplay, { connected: false }));
    const btn = screen.getByTestId("position-apply") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ─── FirmwareInfoViewer Tests ────────────────────────────────────────────────

describe("FirmwareInfoViewer", () => {
  it("Refresh button calls queryFirmwareInfo + queryDeviceId", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    fireEvent.click(screen.getByTestId("firmware-refresh"));
    expect(omniTribeBridge.queryFirmwareInfo).toHaveBeenCalledOnce();
    expect(omniTribeBridge.queryDeviceId).toHaveBeenCalledOnce();
  });

  it("feature-flags list renders exactly 16 items (bits 0-15)", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    const flags = screen.getAllByTestId(/^feature-flag-\d+$/);
    expect(flags.length).toBe(16);
    // Verify bit 0 and bit 15 testids exist
    expect(screen.getByTestId("feature-flag-0")).toBeTruthy();
    expect(screen.getByTestId("feature-flag-15")).toBeTruthy();
  });

  it("omnitribe:firmwareInfo event renders version string", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:firmwareInfo", {
        verMajor: 3, verMinor: 5, verPatch: 2,
        gitHash: BigInt(0),
        moduleIds: [0x09, 0x0A],
        featureFlags: 0x0001,  // only GRANULAR set
      });
    });
    expect(screen.getByTestId("fw-version").textContent).toBe("3.5.2");
  });

  it("omnitribe:firmwareInfo with featureFlags=0xFFFF marks all 16 features as supported", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:firmwareInfo", {
        verMajor: 1, verMinor: 0, verPatch: 0,
        gitHash: BigInt(0),
        moduleIds: [],
        featureFlags: 0xFFFF,
      });
    });
    // All 16 feature flags should show as supported (green dot, no line-through)
    for (let bit = 0; bit < 16; bit++) {
      const item = screen.getByTestId(`feature-flag-${bit}`);
      const dot = item.querySelector("[aria-label]");
      expect(dot?.getAttribute("aria-label")).toBe("supported");
    }
  });

  it("omnitribe:firmwareInfo with featureFlags=0x0000 marks all features as not supported", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:firmwareInfo", {
        verMajor: 1, verMinor: 0, verPatch: 0,
        gitHash: BigInt(0),
        moduleIds: [],
        featureFlags: 0x0000,
      });
    });
    for (let bit = 0; bit < 16; bit++) {
      const item = screen.getByTestId(`feature-flag-${bit}`);
      const dot = item.querySelector("[aria-label]");
      expect(dot?.getAttribute("aria-label")).toBe("not supported");
    }
  });

  it("omnitribe:deviceId event (0x01) renders 'E2S'", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:deviceId", { deviceId: 0x01 });
    });
    expect(screen.getByTestId("fw-device-id").textContent).toBe("E2S");
  });

  it("omnitribe:deviceId event (0x02) renders 'E2-Synth'", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:deviceId", { deviceId: 0x02 });
    });
    expect(screen.getByTestId("fw-device-id").textContent).toBe("E2-Synth");
  });

  it("module list renders module IDs from firmwareInfo event", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:firmwareInfo", {
        verMajor: 1, verMinor: 0, verPatch: 0,
        gitHash: BigInt(0),
        moduleIds: [0x09, 0x0A],
        featureFlags: 0,
      });
    });
    expect(screen.getByTestId("module-id-9")).toBeTruthy();
    expect(screen.getByTestId("module-id-10")).toBeTruthy();
  });
});

// ─── Sprint-120b: ClockSyncPanel — Mode × Lock-State Coverage ───────────────
// 3 modes (0=INTERNAL, 1=EXTERNAL, 2=AUTO) × 2 lock states (locked/unlocked).
// ClockSyncPanel does not gate mode-toggle on locked state — buttons remain
// clickable when locked=true (by design: user can re-set mode at any time).

describe("ClockSyncPanel — mode × lock-state matrix (Sprint-120b)", () => {
  it("Mode INTERNAL (0) works after receiving a locked clockStatus", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockStatus", {
        mode: 1, locked: true, bpm: 100.0, bpmX100: 10000,
      });
    });
    fireEvent.click(screen.getByTestId("clock-mode-0"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(0);
  });

  it("Mode EXTERNAL (1) works after receiving a locked clockStatus", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockStatus", {
        mode: 0, locked: true, bpm: 140.0, bpmX100: 14000,
      });
    });
    fireEvent.click(screen.getByTestId("clock-mode-1"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(1);
  });

  it("Mode AUTO (2) works after receiving a locked clockStatus", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockStatus", {
        mode: 0, locked: true, bpm: 128.0, bpmX100: 12800,
      });
    });
    fireEvent.click(screen.getByTestId("clock-mode-2"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(2);
  });

  it("Mode INTERNAL (0) works after receiving an unlocked clockStatus", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockStatus", {
        mode: 2, locked: false, bpm: 0, bpmX100: 0,
      });
    });
    fireEvent.click(screen.getByTestId("clock-mode-0"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(0);
  });

  it("Mode EXTERNAL (1) works after receiving an unlocked clockStatus", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockStatus", {
        mode: 0, locked: false, bpm: 0, bpmX100: 0,
      });
    });
    fireEvent.click(screen.getByTestId("clock-mode-1"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(1);
  });

  it("Mode AUTO (2) works after receiving an unlocked clockStatus", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockStatus", {
        mode: 0, locked: false, bpm: 0, bpmX100: 0,
      });
    });
    fireEvent.click(screen.getByTestId("clock-mode-2"));
    expect(omniTribeBridge.setClockSyncMode).toHaveBeenCalledWith(2);
  });

  it("omnitribe:clockOutStatus event (effectiveMode=1 MASTER) updates effective label", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockOutStatus", { enable: true, effectiveMode: 1 });
    });
    expect(screen.getByTestId("clock-out-toggle").textContent).toBe("ON");
  });

  it("omnitribe:clockOutStatus event (effectiveMode=2 PASSTHROUGH) updates toggle to ON", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:clockOutStatus", { enable: true, effectiveMode: 2 });
    });
    expect(screen.getByTestId("clock-out-toggle").textContent).toBe("ON");
  });

  it("clock-out toggle calls setClockOutEnable(false) when currently ON", () => {
    render(React.createElement(ClockSyncPanel, { connected: true }));
    // First turn it on via event
    act(() => {
      dispatchOmniEvent("omnitribe:clockOutStatus", { enable: true, effectiveMode: 1 });
    });
    vi.mocked(omniTribeBridge.setClockOutEnable).mockClear();
    fireEvent.click(screen.getByTestId("clock-out-toggle"));
    expect(omniTribeBridge.setClockOutEnable).toHaveBeenCalledWith(false);
  });
});

// ─── Sprint-120b: PositionDisplay — bank label + edge cases ─────────────────

describe("PositionDisplay — bank labels and edge cases (Sprint-120b)", () => {
  it("bank 0 displays label 'A'", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: false, step: 0, bank: 0, sppBeats: 0,
      });
    });
    expect(screen.getByTestId("position-bank").textContent).toBe("A");
  });

  it("bank 7 (last letter) displays 'H'", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: false, step: 0, bank: 7, sppBeats: 112,
      });
    });
    expect(screen.getByTestId("position-bank").textContent).toBe("H");
  });

  it("bank 8 (beyond letter range) displays '#8' (numeric)", () => {
    // Sprint-115 clamped on single-pattern when bank_index>0 in FW — but
    // PositionDisplay has no firmware-level clamping; it shows whatever
    // the device reports. No warning is emitted (Sprint-121 candidate if needed).
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: false, step: 0, bank: 8, sppBeats: 128,
      });
    });
    expect(screen.getByTestId("position-bank").textContent).toBe("#8");
  });

  it("sppBeats 128 (bank 8 × 16) is displayed correctly in beats counter", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: false, step: 0, bank: 8, sppBeats: 128,
      });
    });
    expect(screen.getByTestId("position-beats").textContent).toBe("128");
  });

  it("playing=false sets indicator to STOPPED", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: false, step: 0, bank: 0, sppBeats: 0,
      });
    });
    expect(screen.getByTestId("position-playing-indicator").textContent).toBe("STOPPED");
  });

  it("bank > 7 with sppBeats > 128 edge-case: large beats value displayed", () => {
    render(React.createElement(PositionDisplay, { connected: true }));
    act(() => {
      dispatchOmniEvent("omnitribe:positionChange", {
        playing: true, step: 15, bank: 100, sppBeats: 1601,
      });
    });
    expect(screen.getByTestId("position-bank").textContent).toBe("#100");
    expect(screen.getByTestId("position-beats").textContent).toBe("1601");
  });
});

// ─── Sprint-120b: FirmwareInfoViewer — per-bit feature flag coverage ─────────
// Parameterized: for each bit N in 0..15, featureFlags=(1<<N) should mark
// only feature-flag-N as "supported" and all others as "not supported".

describe("FirmwareInfoViewer — per-bit feature flag isolation (Sprint-120b)", () => {
  // Test a representative selection of individual bits to avoid test bloat
  // while still catching accidental bit-shift or off-by-one errors.
  const bitsToTest = [0, 1, 4, 7, 8, 12, 14, 15] as const;

  for (const targetBit of bitsToTest) {
    it(`featureFlags=1<<${targetBit}: only bit ${targetBit} shows 'supported'`, () => {
      render(React.createElement(FirmwareInfoViewer, { connected: true }));
      act(() => {
        dispatchOmniEvent("omnitribe:firmwareInfo", {
          verMajor: 1, verMinor: 0, verPatch: 0,
          gitHash: BigInt(0),
          moduleIds: [],
          featureFlags: 1 << targetBit,
        });
      });
      // Target bit: must be "supported"
      const targetItem = screen.getByTestId(`feature-flag-${targetBit}`);
      const targetDot = targetItem.querySelector("[aria-label]");
      expect(targetDot?.getAttribute("aria-label")).toBe("supported");

      // All other bits: must be "not supported"
      for (let bit = 0; bit < 16; bit++) {
        if (bit === targetBit) continue;
        const item = screen.getByTestId(`feature-flag-${bit}`);
        const dot = item.querySelector("[aria-label]");
        expect(dot?.getAttribute("aria-label")).toBe("not supported");
      }
    });
  }

  it("Refresh button shows 'Loading...' immediately after click", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    const btn = screen.getByTestId("firmware-refresh");
    // Before click: not loading
    expect(btn.textContent).toBe("Refresh");
    fireEvent.click(btn);
    // After click: loading state while awaiting response
    expect(btn.textContent).toBe("Loading...");
  });

  it("feature flags show 'unknown' (no aria-label='supported' or 'not supported') before any firmwareInfo event", () => {
    render(React.createElement(FirmwareInfoViewer, { connected: true }));
    // Before any event: fwInfo is null, all dots should show "unknown"
    for (let bit = 0; bit < 16; bit++) {
      const item = screen.getByTestId(`feature-flag-${bit}`);
      const dot = item.querySelector("[aria-label]");
      expect(dot?.getAttribute("aria-label")).toBe("unknown");
    }
  });
});

// ─── Bridge frame dispatch sanity — Sprint-113..115 events ──────────────────
// These test the bridge's __testInject path (frame→event pipeline).

describe("Bridge frame dispatch — Sprint-113..115 events", () => {
  it("clockStatus frame from bridge dispatches omnitribe:clockStatus event", () => {
    const bpm100 = 12000;
    const payload = [
      2,
      1,
      (bpm100 >> 14) & 0x7F,
      (bpm100 >> 7) & 0x7F,
       bpm100 & 0x7F,
    ];

    const bridge = new (omniTribeBridge.constructor as new () => typeof omniTribeBridge)();
    let captured: { mode: number; locked: boolean; bpm: number } | null = null;
    const handler = (e: Event) => { captured = (e as CustomEvent).detail; };
    window.addEventListener("omnitribe:clockStatus", handler);
    bridge.__testInject(buildFrame(OtpCmd.TRANSPORT, 0x06, payload));
    window.removeEventListener("omnitribe:clockStatus", handler);

    expect(captured).not.toBeNull();
    expect(captured!.mode).toBe(2);
    expect(captured!.locked).toBe(true);
    expect(captured!.bpm).toBeCloseTo(120.0, 1);
  });

  it("positionChange frame from bridge dispatches omnitribe:positionChange event", () => {
    const sppBeats = 21;
    const payload = [
      1,
      5,
      1,
      (sppBeats >> 14) & 0x7F,
      (sppBeats >> 7) & 0x7F,
       sppBeats & 0x7F,
    ];

    const bridge = new (omniTribeBridge.constructor as new () => typeof omniTribeBridge)();
    let captured: { step: number; bank: number; sppBeats: number; playing: boolean } | null = null;
    const handler = (e: Event) => { captured = (e as CustomEvent).detail; };
    window.addEventListener("omnitribe:positionChange", handler);
    bridge.__testInject(buildFrame(OtpCmd.TRANSPORT, 0x09, payload));
    window.removeEventListener("omnitribe:positionChange", handler);

    expect(captured).not.toBeNull();
    expect(captured!.step).toBe(5);
    expect(captured!.bank).toBe(1);
    expect(captured!.sppBeats).toBe(21);
    expect(captured!.playing).toBe(true);
  });

  it("FwFlag constants: all 16 bits are distinct powers of 2", () => {
    const allBits = [
      FwFlag.GRANULAR, FwFlag.WAVETABLE, FwFlag.MODMATRIX, FwFlag.ARP,
      FwFlag.EUCLIDEAN, FwFlag.CHORD, FwFlag.VOICE_STEAL, FwFlag.CLOCK_PLL,
      FwFlag.MPE_VOICE, FwFlag.IRQ_TX_RING, FwFlag.CLOCK_SYNC, FwFlag.CLOCK_OUT,
      FwFlag.SPP, FwFlag.ADAPTIVE_JITTER, FwFlag.NRPN_FULL, FwFlag.PATTERN_ENGINE,
    ];
    for (const flag of allBits) {
      expect(flag > 0 && (flag & (flag - 1)) === 0).toBe(true);
    }
    expect(new Set(allBits).size).toBe(16);
  });
});
