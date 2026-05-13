/**
 * tests/features/pattern-gen-popup-window.test.ts
 *
 * Pinnable Pattern-Generator-Window (Multi-Window-Workspace, post-v1.27.0).
 *
 * Tests die deterministische Logik:
 *  - isPatternGenPopupMode() liest URL-Param ?patternGenPopup=1 korrekt
 *  - PatternGenPopupAction Schema (apply-pattern)
 *  - Validation: ungültige Payloads werden abgewiesen
 *
 * Was NICHT getestet wird (braucht Electron-Runtime):
 *  - createPatternGenWindow() öffnet ein BrowserWindow
 *  - IPC-Forward Popup → Main
 *  - CustomEvent-Dispatch im Main nach IPC-Empfang
 */
import { describe, it, expect } from "vitest";
import type {
  PatternGenPopupAction,
  GeneratedPatternPayload,
} from "../../client/src/components/PatternGenerator/PatternGeneratorPopupApp";

/** Replikation der App.tsx isPatternGenPopupMode-Funktion. */
function isPatternGenPopupMode(search: string): boolean {
  try {
    return new URLSearchParams(search).get("patternGenPopup") === "1";
  } catch {
    return false;
  }
}

/** Replikation der App.tsx-Validation für apply-pattern Actions. */
function isValidApplyPatternAction(payload: unknown): payload is { type: "apply-pattern"; pattern: GeneratedPatternPayload } {
  if (!payload || typeof payload !== "object") return false;
  const action = payload as Record<string, unknown>;
  if (action.type !== "apply-pattern") return false;
  const pattern = action.pattern as { bpm?: unknown; parts?: unknown } | undefined;
  if (!pattern || typeof pattern.bpm !== "number" || !Array.isArray(pattern.parts)) return false;
  return true;
}

describe("Pattern Generator Popup Window — URL-Routing", () => {
  it("erkennt ?patternGenPopup=1", () => {
    expect(isPatternGenPopupMode("?patternGenPopup=1")).toBe(true);
  });

  it("ignoriert andere Werte", () => {
    expect(isPatternGenPopupMode("?patternGenPopup=0")).toBe(false);
    expect(isPatternGenPopupMode("?patternGenPopup=true")).toBe(false);
    expect(isPatternGenPopupMode("?patternGenPopup=")).toBe(false);
  });

  it("returnt false ohne Param", () => {
    expect(isPatternGenPopupMode("")).toBe(false);
    expect(isPatternGenPopupMode("?other=1")).toBe(false);
    expect(isPatternGenPopupMode("?mixerPopup=1")).toBe(false);
    expect(isPatternGenPopupMode("?sampleBrowserPopup=1")).toBe(false);
  });

  it("kommt mit kombinierten Query-Params klar", () => {
    expect(isPatternGenPopupMode("?foo=bar&patternGenPopup=1&baz=qux")).toBe(true);
  });

  it("returnt false bei ungültiger Query-String", () => {
    expect(isPatternGenPopupMode(null as unknown as string)).toBe(false);
  });
});

describe("Pattern Generator Popup — Action-Schema", () => {
  it("apply-pattern enthält pattern mit bpm + parts", () => {
    const a: PatternGenPopupAction = {
      type: "apply-pattern",
      pattern: {
        bpm: 130,
        parts: [
          { name: "Kick", steps: [{ active: true, velocity: 100 }] },
        ],
      },
    };
    expect(a.type).toBe("apply-pattern");
    expect(a.pattern.bpm).toBe(130);
    expect(a.pattern.parts).toHaveLength(1);
  });

  it("parts können beliebig viele Step-Einträge enthalten", () => {
    const pattern: GeneratedPatternPayload = {
      bpm: 120,
      parts: Array.from({ length: 9 }, (_, i) => ({
        name: `Part ${i}`,
        steps: Array.from({ length: 16 }, (_, j) => ({
          active: j % 4 === 0,
          velocity: 100,
        })),
      })),
    };
    expect(pattern.parts).toHaveLength(9);
    expect(pattern.parts[0].steps).toHaveLength(16);
  });
});

describe("Pattern Generator Popup — Validation", () => {
  it("akzeptiert validen apply-pattern Payload", () => {
    expect(isValidApplyPatternAction({
      type: "apply-pattern",
      pattern: { bpm: 120, parts: [] },
    })).toBe(true);
  });

  it("lehnt null oder undefined Payloads ab", () => {
    expect(isValidApplyPatternAction(null)).toBe(false);
    expect(isValidApplyPatternAction(undefined)).toBe(false);
  });

  it("lehnt Payloads ohne type-Feld ab", () => {
    expect(isValidApplyPatternAction({ pattern: { bpm: 120, parts: [] } })).toBe(false);
  });

  it("lehnt Payloads mit anderem type ab", () => {
    expect(isValidApplyPatternAction({ type: "delete-pattern", pattern: { bpm: 120, parts: [] } })).toBe(false);
  });

  it("lehnt Payloads ohne pattern.bpm ab", () => {
    expect(isValidApplyPatternAction({ type: "apply-pattern", pattern: { parts: [] } })).toBe(false);
  });

  it("lehnt Payloads mit non-number bpm ab", () => {
    expect(isValidApplyPatternAction({
      type: "apply-pattern",
      pattern: { bpm: "120", parts: [] },
    })).toBe(false);
  });

  it("lehnt Payloads mit non-array parts ab", () => {
    expect(isValidApplyPatternAction({
      type: "apply-pattern",
      pattern: { bpm: 120, parts: "not-array" },
    })).toBe(false);
  });

  it("lehnt Strings/Numbers als Payload ab", () => {
    expect(isValidApplyPatternAction("apply-pattern")).toBe(false);
    expect(isValidApplyPatternAction(42)).toBe(false);
  });
});
