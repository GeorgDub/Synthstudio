#!/usr/bin/env node
/**
 * scripts/generate-sandbox-source.mjs
 *
 * Build-Time Codegen für den Sandbox-Worker-Quelltext (TASK-108, v1.18 Hardening).
 *
 * ─── Was dieses Skript tut ──────────────────────────────────────────────────
 * 1. Liest `client/src/sandbox/sandbox-runtime.ts` (Single Source of Truth).
 * 2. Transpiliert die TypeScript-Datei via esbuild zu deterministischem ES2020-
 *    JavaScript (kein Bundle nötig — die Datei hat keine Imports).
 * 3. Schreibt das Resultat als String-Konstante nach
 *    `client/src/sandbox/sandbox-runtime.generated.ts`.
 *
 * Der String wird in `useScriptSandbox.ts` als SANDBOX_WORKER_SOURCE importiert
 * und zur Runtime via Blob-URL in einen Web Worker geladen.
 *
 * ─── Warum kein "?raw"-Import? ──────────────────────────────────────────────
 * Die Source-of-Truth-Datei ist TypeScript (Type-Annotations, "as unknown"-
 * Casts). Ein Browser-Worker kann TS nicht direkt ausführen. Wir brauchen also
 * einen Transpilation-Schritt — esbuild ist hierfür ideal: schnell, deter-
 * ministisch, bereits transitive Dev-Dependency.
 *
 * ─── Determinismus / CI-Verhalten ───────────────────────────────────────────
 * Für identischen Input liefert esbuild byte-identischen Output (gleiche
 * Version vorausgesetzt — pnpm-lock.yaml pinned). Der Test in
 * `tests/features/script-sandbox-codegen.test.ts` verifiziert das.
 *
 * Das generierte File wird *committet*, damit:
 *   - Fresh-Checkout + `pnpm install` + `pnpm dev` ohne extra Steps funktioniert
 *   - CI keine Regenerierung benötigt (`pnpm test`/`pnpm check` pre-hooks
 *     regenerieren trotzdem, aber das ist Idempotent).
 *
 * Wenn der Header oder die SANDBOX_RUNTIME_SHA256-Konstante out-of-sync ist,
 * wirft der Build/Test mit klarer Fehlermeldung — siehe Drift-Tests.
 */

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const SOURCE_PATH = resolve(ROOT, "client/src/sandbox/sandbox-runtime.ts");
const OUTPUT_PATH = resolve(ROOT, "client/src/sandbox/sandbox-runtime.generated.ts");

const AUTO_GENERATED_HEADER = `/**
 * client/src/sandbox/sandbox-runtime.generated.ts
 *
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Quelle: client/src/sandbox/sandbox-runtime.ts
 * Generator: scripts/generate-sandbox-source.mjs
 *
 * Dieses File wird beim Pre-Build (predev/prebuild/precheck/pretest) automatisch
 * neu erzeugt. Manuelle Änderungen werden überschrieben — bearbeite stattdessen
 * sandbox-runtime.ts und führe \`pnpm gen:sandbox\` aus.
 *
 * Der String SANDBOX_WORKER_SOURCE ist die ES2020-transpilierte Variante von
 * sandbox-runtime.ts und wird zur Runtime via Blob-URL in einen Web Worker
 * geladen.
 */
`;

/**
 * Transpiliert sandbox-runtime.ts nach ES2020 JavaScript.
 * - bundle:false  — keine Imports auflösen (es gibt keine)
 * - format:"esm" wäre möglich, aber der Worker-Code ist eine top-level IIFE
 *   ohne Exports/Imports → wir nehmen "default" und entfernen den `export {}`
 *   Marker am Ende manuell.
 * - minify:false — Source bleibt diff-bar/lesbar bei Review der .generated.ts.
 * - keepNames:true — Funktionsnamen für Stack-Traces behalten.
 * - charset:"utf8" — keine ASCII-Escapes wo unnötig.
 */
async function transpileSandboxRuntime() {
  const result = await build({
    entryPoints: [SOURCE_PATH],
    bundle: false,
    write: false,
    format: "esm",
    target: ["es2020"],
    platform: "browser",
    minify: false,
    keepNames: true,
    charset: "utf8",
    legalComments: "none",
    sourcemap: false,
    // wichtig: kein "loader"-Override — esbuild erkennt .ts automatisch und
    // erodiert Type-Annotations weg.
  });
  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new Error("esbuild produced no output for sandbox-runtime.ts");
  }
  let js = result.outputFiles[0].text;

  // esbuild emittiert bei ESM-Source ohne Exports einen leeren `export {}`
  // (TS-Marker). Im Worker-Context (kein Modul-Loader) wäre `export` ein
  // SyntaxError. Wir strippen ihn defensiv:
  js = js.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, "");

  return js.trimEnd() + "\n";
}

/**
 * Wir prüfen die Source-Hash und betten sie als Konstante ein, damit der
 * Drift-Test sofort entdeckt wenn jemand die .generated.ts manuell editiert
 * ohne sandbox-runtime.ts anzufassen.
 */
function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * String.raw-Literal escapen: nur \` (Backtick) und ${ (Template-Expr-Start)
 * müssen escaped werden, alle anderen Sequenzen bleiben unverändert.
 */
function toRawTemplateLiteral(s) {
  return s.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

async function main() {
  const sourceText = await readFile(SOURCE_PATH, "utf8");
  const sourceSha = sha256(sourceText);

  const transpiled = await transpileSandboxRuntime();
  const outputSha = sha256(transpiled);

  // Datei in den schon-existierenden Ordner schreiben (client/src/sandbox/ ist garantiert da).
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });

  const body = `${AUTO_GENERATED_HEADER}
/* eslint-disable */

/** SHA-256 des Source-Files (sandbox-runtime.ts) zum Zeitpunkt der Generierung. */
export const SANDBOX_RUNTIME_SOURCE_SHA256 = ${JSON.stringify(sourceSha)};

/** SHA-256 des transpilierten Outputs (deterministisch bei gleicher esbuild-Version). */
export const SANDBOX_WORKER_SOURCE_SHA256 = ${JSON.stringify(outputSha)};

/**
 * Transpilierter Sandbox-Worker-Quelltext. Wird zur Runtime via Blob-URL in
 * einen Web Worker geladen.
 */
export const SANDBOX_WORKER_SOURCE = String.raw\`${toRawTemplateLiteral(transpiled)}\`;
`;

  // Idempotenz: nur schreiben, wenn sich der Inhalt geändert hat. Spart
  // mtime-Bumps und reduziert noise in git status.
  let oldContent = "";
  try {
    oldContent = await readFile(OUTPUT_PATH, "utf8");
  } catch {
    /* file doesn't exist yet — first run */
  }

  if (oldContent === body) {
    // No-op log — keeps build output quiet on incremental builds.
    return { changed: false, outputSha, sourceSha };
  }

  await writeFile(OUTPUT_PATH, body, "utf8");
  return { changed: true, outputSha, sourceSha };
}

// CLI-Entry-Point
main()
  .then((r) => {
    const tag = r.changed ? "wrote" : "up-to-date";
    process.stdout.write(
      `[gen:sandbox] ${tag} ${OUTPUT_PATH.replace(ROOT, ".")}  (src=${r.sourceSha.slice(0, 8)}, out=${r.outputSha.slice(0, 8)})\n`,
    );
  })
  .catch((e) => {
    process.stderr.write(`[gen:sandbox] FAILED: ${e?.stack || e?.message || e}\n`);
    process.exit(1);
  });
