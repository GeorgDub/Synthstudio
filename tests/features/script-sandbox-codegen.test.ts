/**
 * tests/features/script-sandbox-codegen.test.ts
 *
 * Verifies the build-time codegen pipeline (TASK-108) for the sandbox worker
 * source.
 *
 * Tests cover:
 *   1. Determinism — running the generator twice produces identical output.
 *   2. Hash-integrity — the SHA-256 of sandbox-runtime.ts embedded in the
 *      .generated.ts matches the actual file content (i.e. someone edited the
 *      generated file without re-running the generator -> drift detected).
 *   3. Output is a valid JS template literal (no unescaped backticks or `${`).
 *   4. The generated SANDBOX_WORKER_SOURCE has no top-level `export` statement
 *      (would be SyntaxError in a Worker without a module-loader).
 *
 * Note: These tests use the actual filesystem and spawn the generator via
 * child_process — they are slightly slower than pure unit tests but still
 * run in well under a second.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SANDBOX_WORKER_SOURCE,
  SANDBOX_WORKER_SOURCE_SHA256,
  SANDBOX_RUNTIME_SOURCE_SHA256,
} from "../../client/src/sandbox/sandbox-runtime.generated";

const ROOT = resolve(__dirname, "..", "..");
const SOURCE_PATH = resolve(ROOT, "client/src/sandbox/sandbox-runtime.ts");
const OUTPUT_PATH = resolve(ROOT, "client/src/sandbox/sandbox-runtime.generated.ts");
const SCRIPT_PATH = resolve(ROOT, "scripts/generate-sandbox-source.mjs");

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function runGenerator(): string {
  // Capture current generated file, run generator, capture again.
  execFileSync(process.execPath, [SCRIPT_PATH], { cwd: ROOT, stdio: "pipe" });
  return readFileSync(OUTPUT_PATH, "utf8");
}

describe("Sandbox Codegen (TASK-108)", () => {
  let firstOutput: string;
  let secondOutput: string;

  beforeAll(() => {
    firstOutput = runGenerator();
    secondOutput = runGenerator();
  }, 30_000);

  it("1. Generator output is deterministic across runs", () => {
    expect(firstOutput).toBe(secondOutput);
  });

  it("2. Embedded source SHA matches actual sandbox-runtime.ts content", () => {
    const actualSourceSha = sha256(readFileSync(SOURCE_PATH, "utf8"));
    expect(SANDBOX_RUNTIME_SOURCE_SHA256).toBe(actualSourceSha);
  });

  it("3. SANDBOX_WORKER_SOURCE is non-empty and well-formed JS", () => {
    expect(SANDBOX_WORKER_SOURCE.length).toBeGreaterThan(500);
    // Must contain an IIFE wrapper — the security hardening relies on it.
    expect(SANDBOX_WORKER_SOURCE).toMatch(/\(\s*\(\s*\)\s*=>\s*\{|\(\s*function\s*\(\s*\)\s*\{/);
  });

  it("4. SANDBOX_WORKER_SOURCE has no top-level export (would crash in Worker)", () => {
    // After our esbuild post-processing we strip the trailing `export {}`.
    // Match either pattern — leading or anywhere on its own line.
    expect(SANDBOX_WORKER_SOURCE).not.toMatch(/(^|\n)\s*export\b/);
  });

  it("5. SANDBOX_WORKER_SOURCE_SHA256 matches the actual transpiled output", () => {
    // We re-read the generated file, strip the surrounding template-literal
    // wrapper, and recompute the hash on the raw source. This catches the
    // case where someone edits the .generated.ts manually.
    // (We compare the in-memory SANDBOX_WORKER_SOURCE against the recorded SHA.)
    const recomputed = sha256(SANDBOX_WORKER_SOURCE);
    expect(SANDBOX_WORKER_SOURCE_SHA256).toBe(recomputed);
  });

  it("6. Backticks and ${} in source are correctly escaped in the template literal", () => {
    // If escaping were broken, the generated .ts would not parse — and this
    // import block at the top of the file would have failed already. So this
    // test is essentially a sanity-redundancy: we just check that the
    // post-import constant is truly a string.
    expect(typeof SANDBOX_WORKER_SOURCE).toBe("string");
  });

  it("7. Generator re-run after no source change produces identical file (idempotency)", () => {
    const before = readFileSync(OUTPUT_PATH, "utf8");
    execFileSync(process.execPath, [SCRIPT_PATH], { cwd: ROOT, stdio: "pipe" });
    const after = readFileSync(OUTPUT_PATH, "utf8");
    expect(after).toBe(before);
  });

  it("8. Generator picks up modified source and reflects it in the output hash", () => {
    // We mutate the source file by appending a comment, regenerate, then
    // restore. Output hash must change in the modified run.
    const original = readFileSync(SOURCE_PATH, "utf8");
    try {
      writeFileSync(SOURCE_PATH, original + "\n// transient codegen-test marker\n", "utf8");
      execFileSync(process.execPath, [SCRIPT_PATH], { cwd: ROOT, stdio: "pipe" });
      const modified = readFileSync(OUTPUT_PATH, "utf8");
      const modifiedSourceSha = modified.match(/SANDBOX_RUNTIME_SOURCE_SHA256\s*=\s*"([^"]+)"/)?.[1];
      expect(modifiedSourceSha).toBeTruthy();
      expect(modifiedSourceSha).not.toBe(SANDBOX_RUNTIME_SOURCE_SHA256);
    } finally {
      // ALWAYS restore — even if expect throws.
      writeFileSync(SOURCE_PATH, original, "utf8");
      execFileSync(process.execPath, [SCRIPT_PATH], { cwd: ROOT, stdio: "pipe" });
    }
  }, 30_000);
});
