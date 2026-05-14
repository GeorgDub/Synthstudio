/**
 * tests/features/built-in-scripts.test.ts
 *
 * Validiert dass jedes Built-In aus `client/src/utils/builtInScripts.ts`
 * sandbox-konform ist:
 *   - enthält mind. einen ss.*-Aufruf
 *   - enthält keine verbotenen Pattern (eval, fetch, etc.)
 *   - bleibt unter MAX_SCRIPT_CODE_BYTES (10 kB)
 *   - dispatcht nur erlaubte Actions
 *
 * Damit verhindert der Test Regressions wenn jemand ein neues Built-In
 * hinzufügt das z.B. `eval()` benutzt — bevor es in Production landet.
 */
import { describe, it, expect } from "vitest";
import {
  BUILT_IN_SCRIPTS,
  groupBuiltInsByCategory,
  findBuiltIn,
} from "../../client/src/utils/builtInScripts";
import { validateGeneratedCode } from "../../client/src/utils/aiScriptGenerator";

describe("Built-In Scripts (v1.75)", () => {
  it("Registry enthält mindestens ein Script", () => {
    expect(BUILT_IN_SCRIPTS.length).toBeGreaterThan(0);
  });

  it("jedes Built-In hat alle Pflichtfelder", () => {
    BUILT_IN_SCRIPTS.forEach((s) => {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.code.length).toBeGreaterThan(0);
    });
  });

  it("alle IDs sind eindeutig", () => {
    const ids = BUILT_IN_SCRIPTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("alle Built-Ins sind sandbox-konform (validateGeneratedCode → null)", () => {
    BUILT_IN_SCRIPTS.forEach((s) => {
      const err = validateGeneratedCode(s.code);
      // null = OK; ein String wäre der Validation-Error
      expect(err, `Built-In "${s.id}" failed validation: ${err}`).toBeNull();
    });
  });

  it("alle Built-Ins enthalten mind. einen ss.*-Aufruf", () => {
    BUILT_IN_SCRIPTS.forEach((s) => {
      expect(s.code).toMatch(/\bss\.\w+\s*\(/);
    });
  });

  it("kein Built-In nutzt verbotene Patterns (eval/fetch/import/etc.)", () => {
    const banned = [
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /\bimport\s+/,
      /\brequire\s*\(/,
      /electronAPI/,
      /\b(window|document|globalThis|self)\./,
    ];
    BUILT_IN_SCRIPTS.forEach((s) => {
      banned.forEach((re) => {
        expect(re.test(s.code), `Built-In "${s.id}" enthält verbotenes Pattern: ${re}`).toBe(false);
      });
    });
  });

  it("findBuiltIn findet existierende ID", () => {
    expect(findBuiltIn("duplicate-current-pattern")).toBeDefined();
  });

  it("findBuiltIn gibt undefined für unbekannte ID", () => {
    expect(findBuiltIn("nicht-existent")).toBeUndefined();
  });

  it("groupBuiltInsByCategory partitioniert vollständig", () => {
    const groups = groupBuiltInsByCategory();
    const grouped = Object.values(groups).flat();
    expect(grouped).toHaveLength(BUILT_IN_SCRIPTS.length);
    // Jedes Script taucht in genau einer Kategorie auf
    const ids = grouped.map((s) => s.id);
    expect(new Set(ids).size).toBe(BUILT_IN_SCRIPTS.length);
  });

  // ─── User-Request-spezifisch ─────────────────────────────────────────────
  it("'Pattern duplizieren' ist verfügbar (User-Request)", () => {
    const s = findBuiltIn("duplicate-current-pattern");
    expect(s).toBeDefined();
    expect(s!.code).toContain("pattern-duplicate");
  });

  it("alle ss.dispatch-Action-Strings sind in der Allowlist", () => {
    // Sync mit ALLOWED_DISPATCH_ACTIONS aus aiScriptGenerator.ts
    const allowed = new Set([
      "play-stop", "record", "tap-tempo",
      "bpm-up", "bpm-down", "bpm-up-10", "bpm-down-10",
      "pattern-next", "pattern-prev", "pattern-duplicate",
      "pattern-clear", "pattern-fill", "pattern-randomize",
      "pattern-copy-samples-from-prev",
      "toggle-note-repeat",
      "part-up", "part-down", "velocity-mode", "pitch-mode",
    ]);
    BUILT_IN_SCRIPTS.forEach((s) => {
      const matches = s.code.matchAll(/ss\.dispatch\(\s*['"]([^'"]+)['"]/g);
      for (const m of matches) {
        const action = m[1];
        expect(allowed.has(action), `Built-In "${s.id}" dispatcht unbekannte action: ${action}`).toBe(true);
      }
    });
  });
});
