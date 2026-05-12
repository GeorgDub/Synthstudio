/**
 * tests/features/theme-class-purity.test.ts
 *
 * Regression test for FOLLOWUP-110, TASK-113 and TASK-122.
 *
 * Verifies that refactored components contain NO hardcoded Tailwind palette
 * colour classes (bg-slate-*, text-cyan-*, hover:bg-red-*, bg-[#...] etc.) —
 * only semantic tokens (bg-bg-base, text-text-primary, bg-accent-primary,
 * etc.) are allowed.
 *
 * TASK-122 (final sweep): all components under client/src/components/ and
 * electron/components/ are individually guarded. New refactored files added:
 *   - CollabSplitView.tsx
 *   - DrumMachine.tsx
 *   - CollabStatus.tsx
 *   - EuclideanControls.tsx
 *   - MixAssistantPanel.tsx
 *   - ModMatrix.tsx
 *   - StepContextMenu.tsx
 *   - Humanizer.tsx
 *   - MidiSettings.tsx
 *   - NewProjectDialog.tsx
 *   - ProjectManager.tsx
 *   - Settings/ThemeSettings.tsx
 *   - SongTimeline.tsx
 *   - UpdateBadge.tsx
 *   - electron/components/ElectronDropZone.tsx
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

/**
 * Helper to assert a single file is free of both hardcoded palette classes
 * AND arbitrary hex classes. Registers TWO `it` blocks so failure messages
 * are precise about which check failed.
 */
function expectNoHardcodedTailwindColors(relPath: string) {
  const absPath = resolve(ROOT, relPath);

  it(`${relPath} – no hardcoded Tailwind palette classes`, () => {
    const src = readFileSync(absPath, "utf-8");
    const offenders = findOffenders(src, HARDCODED_TAILWIND_CLASS);
    expect(
      offenders,
      `Hardcoded Tailwind classes found in ${relPath}:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it(`${relPath} – no arbitrary-value hex classes`, () => {
    const src = readFileSync(absPath, "utf-8");
    const offenders = findOffenders(src, ARBITRARY_HEX_CLASS);
    expect(
      offenders,
      `Arbitrary hex classes found in ${relPath}:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
}

describe("Theme-class purity — FOLLOWUP-110 / TASK-113", () => {
  // Original four files (FOLLOWUP-110 + TASK-113)
  expectNoHardcodedTailwindColors("client/src/components/Mixer/MixerView.tsx");
  expectNoHardcodedTailwindColors("electron/components/ElectronTitleBar.tsx");
  expectNoHardcodedTailwindColors("client/src/components/SampleBrowser/SampleBrowser.tsx");
  expectNoHardcodedTailwindColors("client/src/components/SampleBrowser/AudioInputRecorder.tsx");
});

describe("Theme-class purity — TASK-122 (final sweep)", () => {
  // Final-sweep refactored files
  expectNoHardcodedTailwindColors("client/src/components/CollabSplitView/CollabSplitView.tsx");
  expectNoHardcodedTailwindColors("client/src/components/DrumMachine/DrumMachine.tsx");
  expectNoHardcodedTailwindColors("client/src/components/DrumMachine/CollabStatus.tsx");
  expectNoHardcodedTailwindColors("client/src/components/DrumMachine/EuclideanControls.tsx");
  expectNoHardcodedTailwindColors("client/src/components/DrumMachine/MixAssistantPanel.tsx");
  expectNoHardcodedTailwindColors("client/src/components/DrumMachine/ModMatrix.tsx");
  expectNoHardcodedTailwindColors("client/src/components/DrumMachine/StepContextMenu.tsx");
  expectNoHardcodedTailwindColors("client/src/components/Humanizer/Humanizer.tsx");
  expectNoHardcodedTailwindColors("client/src/components/MidiSettings/MidiSettings.tsx");
  expectNoHardcodedTailwindColors("client/src/components/NewProjectDialog/NewProjectDialog.tsx");
  expectNoHardcodedTailwindColors("client/src/components/ProjectManager/ProjectManager.tsx");
  expectNoHardcodedTailwindColors("client/src/components/Settings/ThemeSettings.tsx");
  expectNoHardcodedTailwindColors("client/src/components/SongTimeline/SongTimeline.tsx");
  expectNoHardcodedTailwindColors("client/src/components/UpdateBadge.tsx");
  expectNoHardcodedTailwindColors("electron/components/ElectronDropZone.tsx");
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
