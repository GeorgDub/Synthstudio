/**
 * tests/features/theme-class-purity.test.ts
 *
 * Regression test for FOLLOWUP-110, TASK-113, TASK-122 and TASK-125.
 *
 * Verifies that React components contain NO hardcoded Tailwind palette colour
 * classes (bg-slate-*, text-cyan-*, hover:bg-red-*, bg-[#...] etc.) — only
 * semantic tokens (bg-bg-base, text-text-primary, bg-accent-primary, etc.)
 * are allowed.
 *
 * TASK-125 (Glob-Hardening): The previous version hardcoded 19 file paths.
 * New refactored components fell through the net until someone manually
 * added them to the list. This version walks `client/src/components/**` and
 * `electron/components/**` recursively via fs.readdirSync (no new runtime
 * dependency) and registers an `it` block per *.tsx file found. New
 * components are picked up automatically.
 *
 * Approach: read each file as text via fs.readFileSync, run a strict regex
 * over its content. Rendering with jsdom is avoided because most files pull
 * in the AudioEngine / Electron preload globals.
 *
 * The regex is intentionally narrow:
 *   - Tailwind palette names:  slate|cyan|red|yellow|orange|purple|blue|
 *                              green|pink|amber|gray|zinc|neutral|stone|
 *                              lime|emerald|teal|sky|indigo|violet|fuchsia|rose
 *   - Followed by a numeric shade  -100..-950
 *   - Prefixed by bg-/text-/border-/hover:bg-/hover:text-/hover:border-/accent-
 *
 * Arbitrary-value-classes  bg-[#...]  text-[#...]  are also disallowed.
 *
 * Exception: SVG <rect fill="#..."> attributes, SVG <path stroke="#..."> and
 * JS hex literals in inline style props are NOT Tailwind classes and are out
 * of scope.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

// Tailwind utility-class regex: matches palette + numeric shade.
const HARDCODED_TAILWIND_CLASS =
  /\b(?:hover:|focus:|active:|disabled:|group-hover:)?(?:bg|text|border|ring|accent|fill|stroke|from|to|via|placeholder|caret|decoration|outline|divide|shadow)-(?:slate|cyan|red|yellow|orange|purple|blue|green|pink|amber|gray|zinc|neutral|stone|lime|emerald|teal|sky|indigo|violet|fuchsia|rose)-\d{2,4}\b/;

// Arbitrary value with hex literal inside a Tailwind utility.
const ARBITRARY_HEX_CLASS = /\b(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]+\]/;

function findOffenders(content: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (m) out.push(`L${i + 1}: ${m[0]}  (${lines[i].trim()})`);
  }
  return out;
}

/**
 * Recursively walks a directory and returns all matching files (relative
 * paths, POSIX-style for stable test names regardless of OS).
 *
 * @param baseAbs Absolute path of the root being walked.
 * @param matcher Predicate per absolute path. Receives the relative path
 *                (from baseAbs) for filtering.
 * @returns Sorted list of relative paths (POSIX-separated).
 */
function walkSync(baseAbs: string, matcher: (relPath: string) => boolean): string[] {
  const collected: string[] = [];

  function recurse(currentAbs: string): void {
    let entries: string[];
    try {
      entries = readdirSync(currentAbs);
    } catch {
      return; // unreadable dir → skip
    }
    for (const entry of entries) {
      const abs = join(currentAbs, entry);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Skip standard dirs we never care about
        if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
        recurse(abs);
      } else if (st.isFile()) {
        const relPath = relative(baseAbs, abs).split(sep).join("/");
        if (matcher(relPath)) collected.push(relPath);
      }
    }
  }

  recurse(baseAbs);
  return collected.sort();
}

/**
 * Sammelt alle *.tsx-Dateien unter den angegebenen Roots — relativ zu ROOT,
 * POSIX-Separator. Aufgerufen außerhalb von `it()` → Test-Bootstrap-Zeit,
 * damit `it`-Blöcke statisch registriert werden (vitest erlaubt kein
 * dynamisches `it` innerhalb von `it`).
 */
function collectComponentFiles(): string[] {
  const roots = ["client/src/components", "electron/components"];
  const all: string[] = [];
  for (const root of roots) {
    const baseAbs = resolve(ROOT, root);
    if (!existsSync(baseAbs)) continue;
    const found = walkSync(baseAbs, (rel) => rel.endsWith(".tsx"));
    for (const rel of found) all.push(`${root}/${rel}`);
  }
  return all;
}

const COMPONENT_FILES = collectComponentFiles();

// Defensive: wenn der Glob-Walker leer zurückkommt (z.B. Pfad-Annahme falsch),
// soll der Test-Lauf NICHT silent pass — registriere einen Sentinel-Test.
describe("Theme-class purity — component glob discovery (TASK-125)", () => {
  it("finds at least 10 *.tsx components across both roots", () => {
    expect(COMPONENT_FILES.length).toBeGreaterThanOrEqual(10);
  });

  it("includes well-known TASK-122 refactored components", () => {
    // Sanity check: ensure the walker found components we know are refactored.
    const wellKnown = [
      "client/src/components/DrumMachine/DrumMachine.tsx",
      "client/src/components/SongTimeline/SongTimeline.tsx",
      "client/src/components/Settings/ThemeSettings.tsx",
      "electron/components/ElectronDropZone.tsx",
    ];
    for (const file of wellKnown) {
      expect(COMPONENT_FILES, `Missing well-known file: ${file}`).toContain(file);
    }
  });
});

describe("Theme-class purity — no hardcoded Tailwind palette classes", () => {
  for (const relPath of COMPONENT_FILES) {
    it(`${relPath}`, () => {
      const src = readFileSync(resolve(ROOT, relPath), "utf-8");
      const offenders = findOffenders(src, HARDCODED_TAILWIND_CLASS);
      expect(
        offenders,
        `Hardcoded Tailwind classes found in ${relPath}:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
});

describe("Theme-class purity — no arbitrary-value hex classes", () => {
  for (const relPath of COMPONENT_FILES) {
    it(`${relPath}`, () => {
      const src = readFileSync(resolve(ROOT, relPath), "utf-8");
      const offenders = findOffenders(src, ARBITRARY_HEX_CLASS);
      expect(
        offenders,
        `Arbitrary hex classes found in ${relPath}:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
});

describe("Theme-class purity — Regex sanity checks", () => {
  it("Regex actually catches a known offender (sanity check)", () => {
    const sample = `<div className="bg-slate-900 text-cyan-400 hover:bg-red-600">`;
    expect(sample).toMatch(HARDCODED_TAILWIND_CLASS);
  });

  it("Regex actually catches arbitrary hex (sanity check)", () => {
    const sample = `<div className="bg-[#0d0d0d] text-[#fefefe]">`;
    expect(sample).toMatch(ARBITRARY_HEX_CLASS);
  });

  it("Semantic-token classes do NOT trip the regex (sanity check)", () => {
    const sample = `<div className="bg-bg-base text-accent-primary border-border-color hover:bg-accent-danger">`;
    expect(sample).not.toMatch(HARDCODED_TAILWIND_CLASS);
    expect(sample).not.toMatch(ARBITRARY_HEX_CLASS);
  });
});
