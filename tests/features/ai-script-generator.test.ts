/**
 * tests/features/ai-script-generator.test.ts
 *
 * Unit-Tests für die pure Logik des AI Script Generators (post-v1.24.0):
 *  - buildSystemPrompt() — enthält alle wichtigen ss.*-API-Methoden + Constraints
 *  - stripMarkdownFences() — entfernt ```js, ```javascript, ``` Wrapper
 *  - validateGeneratedCode() — 10kB-Limit, ss.*-Plausibility, banned-Patterns
 *
 * Die generateScriptFromPrompt()-Funktion selbst ist NICHT getestet —
 * sie macht echte API-Calls (Anthropic). Wir testen nur die deterministische
 * Logik die rund um den Call läuft.
 */
import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  stripMarkdownFences,
  validateGeneratedCode,
  buildUserMessage,
} from "../../client/src/utils/aiScriptGenerator";
import { MAX_SCRIPT_CODE_BYTES } from "../../client/src/store/useScriptStore";

// ─── buildSystemPrompt ───────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("erwähnt alle 10 ss.*-Methoden", () => {
    const methods = [
      "ss.bpm", "ss.play", "ss.stop", "ss.setStep", "ss.dispatch",
      "ss.log", "ss.getMacro", "ss.setMacro", "ss.wait", "ss.random",
    ];
    for (const m of methods) {
      expect(prompt).toContain(m);
    }
  });

  it("erwähnt die ALLOWED_DISPATCH_ACTIONS", () => {
    expect(prompt).toMatch(/play-stop/);
    expect(prompt).toMatch(/pattern-next/);
    expect(prompt).toMatch(/bpm-up/);
  });

  it("erwähnt das 10kB-Code-Limit", () => {
    expect(prompt).toContain(String(MAX_SCRIPT_CODE_BYTES));
  });

  it("erwähnt Sandbox-Constraints (kein window, fetch, eval)", () => {
    expect(prompt).toMatch(/window/);
    expect(prompt).toMatch(/fetch/);
    expect(prompt).toMatch(/eval/);
  });

  it("erklärt async/await für ss.*-Aufrufe", () => {
    expect(prompt).toMatch(/asynchron/i);
    expect(prompt).toMatch(/await/);
  });
});

// ─── stripMarkdownFences ─────────────────────────────────────────────────────

describe("stripMarkdownFences", () => {
  it("entfernt ```js-Fence", () => {
    const input = "```js\nss.bpm(120);\n```";
    expect(stripMarkdownFences(input)).toBe("ss.bpm(120);");
  });

  it("entfernt ```javascript-Fence", () => {
    const input = "```javascript\nss.log('hi');\n```";
    expect(stripMarkdownFences(input)).toBe("ss.log('hi');");
  });

  it("entfernt nackten ``` Fence ohne Sprache", () => {
    const input = "```\nss.stop();\n```";
    expect(stripMarkdownFences(input)).toBe("ss.stop();");
  });

  it("entfernt ```ts und ```typescript", () => {
    expect(stripMarkdownFences("```ts\ncode\n```")).toBe("code");
    expect(stripMarkdownFences("```typescript\ncode\n```")).toBe("code");
  });

  it("lässt Code ohne Fences unverändert", () => {
    const input = "ss.bpm(120);\nss.play();";
    expect(stripMarkdownFences(input)).toBe(input);
  });

  it("trimmt führende + abschließende Whitespaces", () => {
    expect(stripMarkdownFences("  \n  ss.log('x');  \n  ")).toBe("ss.log('x');");
  });

  it("entfernt nur die ÄUSSEREN Fences, nicht inline-Backticks", () => {
    const input = "```js\nconst s = `inline template`;\nss.log(s);\n```";
    const result = stripMarkdownFences(input);
    expect(result).toContain("`inline template`");
    expect(result).not.toMatch(/^```/);
    expect(result).not.toMatch(/```$/);
  });
});

// ─── validateGeneratedCode ───────────────────────────────────────────────────

describe("validateGeneratedCode", () => {
  it("akzeptiert validen Code mit ss.*-Aufruf", () => {
    expect(validateGeneratedCode("await ss.bpm(120);")).toBeNull();
    expect(validateGeneratedCode("ss.log('hello');")).toBeNull();
  });

  it("akzeptiert mehrzeiligen Code mit await + Schleifen", () => {
    const code = `
for (let bpm = 100; bpm <= 140; bpm += 2) {
  await ss.bpm(bpm);
  await ss.wait(200);
}
`;
    expect(validateGeneratedCode(code)).toBeNull();
  });

  it("lehnt leeren Code ab", () => {
    expect(validateGeneratedCode("")).toMatch(/leer/i);
    expect(validateGeneratedCode("   \n  ")).toMatch(/leer/i);
  });

  it("lehnt Code OHNE ss.*-Aufruf ab", () => {
    expect(validateGeneratedCode("console.log('x');")).toMatch(/ss\.\*/);
    expect(validateGeneratedCode("const x = 5;")).toMatch(/ss\.\*/);
  });

  it("lehnt Code mit eval() ab", () => {
    expect(validateGeneratedCode("ss.log('x'); eval('1+1');")).toMatch(/eval/);
  });

  it("lehnt Code mit new Function ab", () => {
    expect(validateGeneratedCode("ss.log('x'); const f = new Function('return 1');")).toMatch(/new Function/);
  });

  it("lehnt Code mit fetch() ab", () => {
    expect(validateGeneratedCode("ss.log('x'); fetch('https://evil.com');")).toMatch(/fetch/);
  });

  it("lehnt Code mit window.* ab", () => {
    expect(validateGeneratedCode("ss.log('x'); window.alert('hi');")).toMatch(/globale Browser-API/);
  });

  it("lehnt Code mit document.* ab", () => {
    expect(validateGeneratedCode("ss.log('x'); document.body.innerHTML = '';")).toMatch(/globale Browser-API/);
  });

  it("lehnt Code mit electronAPI ab", () => {
    expect(validateGeneratedCode("ss.log('x'); electronAPI.openFile();")).toMatch(/electronAPI/);
  });

  it("lehnt Code mit import-Statement ab", () => {
    expect(validateGeneratedCode("import fs from 'fs';\nss.log('x');")).toMatch(/import/);
  });

  it("lehnt Code mit require() ab", () => {
    expect(validateGeneratedCode("const fs = require('fs');\nss.log('x');")).toMatch(/require/);
  });

  it("lehnt Code über 10kB ab", () => {
    const huge = "ss.log('" + "x".repeat(MAX_SCRIPT_CODE_BYTES + 100) + "');";
    const err = validateGeneratedCode(huge);
    expect(err).toMatch(/zu groß/i);
    expect(err).toContain(String(MAX_SCRIPT_CODE_BYTES));
  });

  it("akzeptiert Code genau an der 10kB-Grenze", () => {
    // Padding so dass byteSize knapp unter MAX liegt
    const pad = "x".repeat(MAX_SCRIPT_CODE_BYTES - 50);
    const code = `ss.log('${pad}');`;
    expect(validateGeneratedCode(code)).toBeNull();
  });

  it("erkennt WebSocket / XMLHttpRequest / EventSource", () => {
    expect(validateGeneratedCode("ss.log('x'); new WebSocket('ws://x');")).toMatch(/Network/);
    expect(validateGeneratedCode("ss.log('x'); new XMLHttpRequest();")).toMatch(/Network/);
    expect(validateGeneratedCode("ss.log('x'); new EventSource('/x');")).toMatch(/Network/);
  });
});

// ─── buildUserMessage (Welle 2 — Iterate-Mode) ───────────────────────────────

describe("buildUserMessage (Iterate-Mode, Welle 2)", () => {
  it("plain mode: gibt den Prompt unverändert zurück", () => {
    expect(buildUserMessage("rampe BPM von 100 auf 140")).toBe("rampe BPM von 100 auf 140");
  });

  it("plain mode: existingCode=undefined → kein Wrapping", () => {
    expect(buildUserMessage("test", undefined)).toBe("test");
  });

  it("plain mode: existingCode='' → kein Wrapping (treat empty wie undefined)", () => {
    expect(buildUserMessage("test", "")).toBe("test");
  });

  it("plain mode: existingCode='   ' → kein Wrapping (whitespace-only)", () => {
    expect(buildUserMessage("test", "   \n  \t  ")).toBe("test");
  });

  it("iterate mode: existingCode wird vor den Prompt gesetzt mit Markdown-Block", () => {
    const result = buildUserMessage("mach es schneller", "ss.bpm(120);\nawait ss.wait(500);");
    expect(result).toContain("```");
    expect(result).toContain("ss.bpm(120);");
    expect(result).toContain("await ss.wait(500);");
    expect(result).toContain("mach es schneller");
    // Der existing-code-Block muss VOR dem User-Prompt stehen
    const codeIdx = result.indexOf("ss.bpm(120);");
    const promptIdx = result.indexOf("mach es schneller");
    expect(codeIdx).toBeLessThan(promptIdx);
  });

  it("iterate mode: User-Prompt erscheint nach dem code-Block mit 'Verbesserung' Marker", () => {
    const result = buildUserMessage("logge nach jedem Step", "ss.bpm(120);");
    expect(result).toMatch(/Verbesserung/i);
  });

  it("iterate mode: existingCode wird getrimmt", () => {
    const result = buildUserMessage("test", "  \n  ss.log('x');\n  ");
    // Inner code soll getrimmt sein — die ``` Marker sollen direkt das ss.log() umschließen
    expect(result).toMatch(/```\nss\.log\('x'\);\n```/);
  });
});
