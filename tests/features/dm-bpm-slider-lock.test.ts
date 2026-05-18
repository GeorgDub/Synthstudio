/**
 * tests/features/dm-bpm-slider-lock.test.ts
 *
 * v3.38.0 — Tests for the BPM-Slider disabled-state when external MIDI
 * Clock-IN sync is active.
 *
 * Closes the caveat from v3.35: "Toolbar-BPM-Slider explizit disabled-State
 * im Sync-Mode" — the BPM-Slider in the DrumMachine toolbar must be visually
 * dim AND non-interactive whenever:
 *   - `externalSyncEnabled === true` AND
 *   - `externalSyncStatus` is "running" or "tempo-only"
 *
 * For "off" / "lost" / `enabled=false`, the slider remains writable.
 *
 * Pure-helper test: `isBpmExternallyLocked` is the single source of truth
 * used by the React component. We assert its behaviour exhaustively here
 * so we don't need a JSDOM render in the hot path.
 *
 * Env: node (helper is pure-fn).
 */

import { describe, it, expect } from "vitest";
import { isBpmExternallyLocked } from "../../client/src/components/DrumMachine/DrumMachine";

describe("isBpmExternallyLocked — v3.38.0 BPM-Slider lock predicate", () => {
  it("returns false when externalSyncEnabled is undefined (default Web-Mode)", () => {
    expect(isBpmExternallyLocked(undefined, undefined)).toBe(false);
    expect(isBpmExternallyLocked(undefined, "running")).toBe(false);
    expect(isBpmExternallyLocked(undefined, "tempo-only")).toBe(false);
  });

  it("returns false when externalSyncEnabled is false (user toggle off)", () => {
    expect(isBpmExternallyLocked(false, "running")).toBe(false);
    expect(isBpmExternallyLocked(false, "tempo-only")).toBe(false);
    expect(isBpmExternallyLocked(false, "off")).toBe(false);
    expect(isBpmExternallyLocked(false, "lost")).toBe(false);
  });

  it("returns true when enabled AND status='running' (master actively playing)", () => {
    expect(isBpmExternallyLocked(true, "running")).toBe(true);
  });

  it("returns true when enabled AND status='tempo-only' (clock ticks without 0xFA)", () => {
    expect(isBpmExternallyLocked(true, "tempo-only")).toBe(true);
  });

  it("returns false when enabled AND status='off' (no incoming clock yet)", () => {
    // User has toggled ON but no clock has arrived → slider stays writable.
    expect(isBpmExternallyLocked(true, "off")).toBe(false);
  });

  it("returns false when enabled AND status='lost' (sync was lost — fallback to internal)", () => {
    // Master disconnected → slider must become writable so user can keep playing.
    expect(isBpmExternallyLocked(true, "lost")).toBe(false);
  });

  it("returns false when status is undefined regardless of enabled", () => {
    // Defensive: a half-initialised parent shouldn't lock the slider.
    expect(isBpmExternallyLocked(true, undefined)).toBe(false);
  });
});
