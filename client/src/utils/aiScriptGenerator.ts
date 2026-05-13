/**
 * Synthstudio – AI Script Generator (post-v1.24.0 feature, ROADMAP Phase S)
 *
 * Prompt-driven generation of `ss.*`-API-conformant Scripts via Anthropic API.
 * Hängt NICHT vom BUG-010-Fix ab — auch wenn die Sandbox-Ausführung kaputt
 * wäre, kann der Generator als reines Code-Generation-Werkzeug genutzt werden.
 *
 * Architektur:
 *   - Pure-Funktion `buildSystemPrompt()` baut den System-Prompt mit voller
 *     ss.*-API-Doku → in Tests verifizierbar
 *   - `generateScriptFromPrompt(prompt, apiKey, model)` ruft die Anthropic
 *     Messages-API, parsed die Code-Response (mit/ohne Markdown-Fences)
 *   - Validierung: 10kB-Limit (MAX_SCRIPT_CODE_BYTES) + Plausibility-Check
 *     (mind. eine ss.*-Aufruf-Stelle)
 *
 * Sicherheit: API-Key wird NIE serialisiert/geloggt. Der generierte Code wird
 * als normaler User-Code behandelt — durchläuft beim Run die übliche
 * Sandbox-Validation auf dem Main-Thread.
 */
import { MAX_SCRIPT_CODE_BYTES } from "@/store/useScriptStore";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/** Liste der erlaubten ss.dispatch()-Actions (muss mit useScriptSandbox synchron sein). */
const ALLOWED_DISPATCH_ACTIONS = [
  "play-stop", "record", "tap-tempo",
  "bpm-up", "bpm-down", "bpm-up-10", "bpm-down-10",
  "pattern-next", "pattern-prev", "pattern-duplicate",
  "pattern-clear", "pattern-fill", "pattern-randomize",
  "part-up", "part-down", "velocity-mode", "pitch-mode",
];

/**
 * Baut den System-Prompt der dem LLM die `ss.*`-API beschreibt.
 * Wird auch für Tests gegen Drift-Detection zwischen API-Doku + tatsächlicher
 * Sandbox-Implementierung verwendet.
 */
export function buildSystemPrompt(): string {
  return [
    "Du bist ein Code-Generator für die Synthstudio Script-Runner-Sandbox.",
    "Du erzeugst kurzen, sicheren JavaScript-Code der NUR die `ss.*`-API nutzt.",
    "",
    "WICHTIG:",
    "  - Antworte AUSSCHLIESSLICH mit dem JavaScript-Code, kein Markdown, kein Erklärtext.",
    "  - Alle `ss.*`-Methoden sind asynchron und liefern Promises — nutze `await`.",
    "  - Kein Zugriff auf `window`, `document`, `fetch`, `XMLHttpRequest`, `electronAPI`, `globalThis`.",
    "  - Keine Module-Imports, kein `eval`, kein `new Function`.",
    "  - Halte den Code unter " + MAX_SCRIPT_CODE_BYTES + " Bytes (ca. 200 Zeilen).",
    "  - Bei Schleifen IMMER `await ss.wait(ms)` zwischen Iterationen einbauen (sonst Timeout-Risk).",
    "  - Default-Timeout: 5 Sekunden Wall-Clock.",
    "",
    "VERFÜGBARE API:",
    "  - `await ss.bpm(value: number)` — Setzt BPM (20-300, clamped).",
    "  - `await ss.play()` — Startet Transport.",
    "  - `await ss.stop()` — Stoppt Transport.",
    "  - `await ss.setStep(partId: string, stepIdx: number, on: boolean)` — Setzt Step (0-63).",
    "  - `await ss.dispatch(action: string)` — Triggert Aktion. Erlaubt: " + ALLOWED_DISPATCH_ACTIONS.join(", ") + ".",
    "  - `ss.log(msg: string)` — Loggt in die Script-Konsole (max 500 Zeichen, rate-limited).",
    "  - `await ss.getMacro(idx: number): Promise<number>` — Liest Macro-Wert (0-7) als 0..1.",
    "  - `await ss.setMacro(idx: number, value: number)` — Setzt Macro-Wert (idx 0-7, value 0-1).",
    "  - `await ss.wait(ms: number)` — Async Delay (max 60 Sekunden).",
    "  - `ss.random(): number` — Zufallszahl 0..1.",
    "  - `ss.now(): number` — Aktuelle Zeit in ms (Date.now()).",
    "",
    "Beispiel für eine BPM-Rampe (kein await unnötig — ist async):",
    "```",
    "for (let bpm = 100; bpm <= 140; bpm += 2) {",
    "  await ss.bpm(bpm);",
    "  await ss.wait(200);",
    "}",
    "```",
  ].join("\n");
}

/** Resultat-Typ — entweder erfolgreich generierter Code oder Fehler-String. */
export interface AiScriptGenerationResult {
  ok: boolean;
  code?: string;
  error?: string;
  /** Anzahl Bytes des generierten Codes (vor Validierung). */
  byteSize?: number;
}

/**
 * Entfernt Markdown-Code-Fences falls der LLM doch welche mitschickt.
 * Akzeptiert ```js, ```javascript, ``` oder gar keine.
 */
export function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  // Opening fence (mit optional language)
  s = s.replace(/^```(?:js|javascript|ts|typescript)?\s*\n?/i, "");
  // Closing fence
  s = s.replace(/\n?```\s*$/, "");
  return s.trim();
}

/**
 * Validiert generierten Code gegen Sandbox-Constraints.
 * Returnt error-String wenn invalid, null wenn ok.
 *
 * Pure Funktion — keine Side-Effects, in Tests nutzbar.
 */
export function validateGeneratedCode(code: string): string | null {
  if (!code || code.trim().length === 0) {
    return "Leerer Code generiert.";
  }
  // 10kB-Limit aus useScriptStore — encodeURIComponent als Byte-Schätzung
  // (genug für UTF-8-Approximation in der gleichen Größenordnung).
  const byteSize = encodeURIComponent(code).replace(/%[0-9A-F]{2}/g, "_").length;
  if (byteSize > MAX_SCRIPT_CODE_BYTES) {
    return `Code zu groß: ${byteSize} Bytes (max ${MAX_SCRIPT_CODE_BYTES}).`;
  }
  // Plausibility-Check: mindestens ein ss.*-Aufruf
  if (!/\bss\.\w+\s*\(/.test(code)) {
    return "Kein einziger ss.*-Aufruf im generierten Code.";
  }
  // Verbotene Pattern (defensive — LLM könnte trotz System-Prompt versuchen)
  const bannedPatterns: Array<{ re: RegExp; label: string }> = [
    { re: /\beval\s*\(/, label: "eval()" },
    { re: /new\s+Function\s*\(/, label: "new Function" },
    { re: /\b(window|document|globalThis|self)\./, label: "globale Browser-API" },
    { re: /\bfetch\s*\(/, label: "fetch()" },
    { re: /XMLHttpRequest|WebSocket|EventSource/, label: "Network-API" },
    { re: /electronAPI/, label: "electronAPI" },
    { re: /\bimport\s+/, label: "import-Statement" },
    { re: /\brequire\s*\(/, label: "require()" },
  ];
  for (const { re, label } of bannedPatterns) {
    if (re.test(code)) {
      return `Generierter Code enthält verbotenes Pattern: ${label}.`;
    }
  }
  return null;
}

/**
 * Optionen für `generateScriptFromPrompt`.
 *
 * - `existingCode`: bestehender Skript-Code. Wenn gesetzt → der Generator
 *   läuft im **Iterate-Mode** und sendet den Code als Kontext mit, so dass
 *   das LLM den existierenden Code verbessert/ändert statt neu zu generieren.
 *   Welle 2 von Phase S (post-v1.25.0).
 */
export interface GenerateOptions {
  existingCode?: string;
}

/**
 * Baut die User-Message für den Anthropic-Call. Im Plain-Mode ist es der
 * Prompt direkt; im Iterate-Mode wird der existierende Code als Kontext
 * vor den Prompt gesetzt damit das LLM den richtigen Bezug hat.
 * Public exportiert für Unit-Tests.
 */
export function buildUserMessage(prompt: string, existingCode?: string): string {
  if (!existingCode || existingCode.trim().length === 0) return prompt;
  return [
    "Hier ist der existierende Script-Code, den du anpassen sollst:",
    "```",
    existingCode.trim(),
    "```",
    "",
    "Verbesserung/Änderung gewünscht:",
    prompt,
  ].join("\n");
}

/**
 * Sendet den Prompt an die Anthropic-API und liefert validierten Code zurück.
 *
 * @param prompt User-Text, z.B. "Generiere ein Script das BPM von 100 auf 140 rampt"
 * @param apiKey Anthropic API-Key aus useApiSettingsStore
 * @param model Modell-ID, z.B. "claude-haiku-4-5-20251001"
 * @param opts Optional: { existingCode } → Iterate-Mode
 */
export async function generateScriptFromPrompt(
  prompt: string,
  apiKey: string,
  model: string,
  opts: GenerateOptions = {},
): Promise<AiScriptGenerationResult> {
  if (!apiKey || apiKey.length === 0) {
    return { ok: false, error: "Kein API-Key gesetzt (Settings → KI & API)." };
  }
  if (!prompt || prompt.trim().length === 0) {
    return { ok: false, error: "Prompt ist leer." };
  }

  const userMessage = buildUserMessage(prompt, opts.existingCode);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Anthropic-API ${response.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = await response.json();
    const rawCode = data?.content?.[0]?.text ?? "";
    const code = stripMarkdownFences(rawCode);
    const byteSize = encodeURIComponent(code).replace(/%[0-9A-F]{2}/g, "_").length;

    const validationError = validateGeneratedCode(code);
    if (validationError) {
      return { ok: false, error: validationError, code, byteSize };
    }

    return { ok: true, code, byteSize };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Netzwerk-/Parse-Fehler: ${msg}` };
  }
}
