/**
 * tests/features/theme-class-purity.test.ts
 *
 * Regression test for FOLLOWUP-110.
 *
 * Verifies that the two files refactored in TASK-110 (MixerView.tsx and
 * ElectronTitleBar.tsx) contain NO hardcoded Tailwind palette colour classes
 * (bg-slate-*, text-cyan-*, hover:bg-red-*, bg-[#...] etc.) — only semantic
 * tokens (bg-bg-base, text-text-primary, bg-accent-primary, etc.) are allowed.
 *
 * Approach: read each file as text via fs.readFileSync, run a strict regex
 * over its content. Rendering with jsdom is avoided because both files pull
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
 * Exception: SVG <rect fill="#..."> attributes are NOT Tailwind classes and
 * are out of scope.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

// Tailwind utility-class regex: matches palette + numeric shade.
const HARDCODED_TAILWIND_CLASS =
  /\b(?:hover:|focus:|active:|disabled:|group-hover:)?(?:bg|text|border|ring|accent|fill|stroke|from|to|via|placeholder|caret|decoration|outline|divide|shadow)-(?:slate|cyan|red|yellow|orange|purple|blue|green|pink|amber|gray|zinc|neutral|stone|lime|emerald|teal|sky|indigo|violet|fuchsia|rose)-\d{2,4}\b/;

// Arbitrary value with hex literal inside a Tailwind utility.
const ARBITRARY_HEX_CLASS = /\b(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]+\]/;

// Subset of JSX/TSX content we want to scan — strip JS/TS string literals that
// are NOT class attributes? Hard to do generically. We rely on the simple fact
// that both regexes match Tailwind class shapes, which would not be present
// in regular JS strings unless someone is genuinely writing a class.
function findOffenders(content: string, pattern: RegExp): string[] {
  // Split by newline to give exact line + occurrence for human debugging.
  const out: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (m) out.push(`L${i + 1}: ${m[0]}  (${lines[i].trim()})`);
  }
  return out;
}

describe("Theme-class purity — FOLLOWUP-110", () => {
  it("MixerView.tsx contains no hardcoded Tailwind palette classes", () => {
    const path = resolve(ROOT, "client/src/components/Mixer/MixerView.tsx");
    const src = readFileSync(path, "utf-8");
    const offenders = findOffenders(src, HARDCODED_TAILWIND_CLASS);
    expect(offenders, `Hardcoded Tailwind classes found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("MixerView.tsx contains no arbitrary-value hex classes (bg-[#...]/text-[#...])", () => {
    const path = resolve(ROOT, "client/src/components/Mixer/MixerView.tsx");
    const src = readFileSync(path, "utf-8");
    const offenders = findOffenders(src, ARBITRARY_HEX_CLASS);
    expect(offenders, `Arbitrary hex classes found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("ElectronTitleBar.tsx contains no hardcoded Tailwind palette classes", () => {
    const path = resolve(ROOT, "electron/components/ElectronTitleBar.tsx");
    const src = readFileSync(path, "utf-8");
    const offenders = findOffenders(src, HARDCODED_TAILWIND_CLASS);
    expect(offenders, `Hardcoded Tailwind classes found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("ElectronTitleBar.tsx contains no arbitrary-value hex classes (bg-[#...]/text-[#...])", () => {
    const path = resolve(ROOT, "electron/components/ElectronTitleBar.tsx");
    const src = readFileSync(path, "utf-8");
    const offenders = findOffenders(src, ARBITRARY_HEX_CLASS);
    expect(offenders, `Arbitrary hex classes found:\n${offenders.join("\n")}`).toEqual([]);
  });

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
