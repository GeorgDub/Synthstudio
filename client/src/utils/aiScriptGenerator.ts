/**
 * Synthstudio – AI Script Generator (post-v1.24.0 feature, ROADMAP Phase S)
 *
 * Prompt-driven generation of `ss.*`-API-conformant Scripts.
 *
 * Multi-Provider-Support (post-v1.25.0): dispatcht auf Anthropic (Claude) ODER
 * OpenAI (ChatGPT/GPT-4) basierend auf dem aktiven Provider in den Settings.
 *
 * Architektur:
 *   - Pure-Funktion `buildSystemPrompt()` baut den System-Prompt mit voller
 *     ss.*-API-Doku → in Tests verifizierbar (Provider-unabhängig).
 *   - `generateScriptFromPrompt(prompt, apiKey, model, opts)` dispatcht intern
 *     auf den passenden Provider-Endpoint anhand `opts.provider`.
 *   - Validierung: 10kB-Limit (MAX_SCRIPT_CODE_BYTES) + Plausibility-Check
 *     (mind. eine ss.*-Aufruf-Stelle) — gilt für beide Provider.
 *
 * Sicherheit: API-Key wird NIE serialisiert/geloggt. Der generierte Code wird
 * als normaler User-Code behandelt — durchläuft beim Run die übliche
 * Sandbox-Validation auf dem Main-Thread.
 */
import { MAX_SCRIPT_CODE_BYTES } from "@/store/useScriptStore";
import type { AiProvider } from "@/store/useApiSettingsStore";
import { recordAiCall } from "@/store/useAiCostStore";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

/** Liste der erlaubten ss.dispatch()-Actions (muss mit useScriptSandbox synchron sein). */
const ALLOWED_DISPATCH_ACTIONS = [
  "play-stop", "record", "tap-tempo",
  "bpm-up", "bpm-down", "bpm-up-10", "bpm-down-10",
  "pattern-next", "pattern-prev", "pattern-duplicate",
  "pattern-clear", "pattern-fill", "pattern-randomize",
  "pattern-copy-samples-from-prev",
  "part-up", "part-down", "velocity-mode", "pitch-mode",
  "toggle-note-repeat",
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
 * - `provider`: AI-Provider — entweder "anthropic" (default, Claude API) oder
 *   "openai" (GPT/ChatGPT API). Post-v1.25.0 Multi-Provider-Support.
 */
export interface GenerateOptions {
  existingCode?: string;
  provider?: AiProvider;
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
 * Sendet den Prompt an den passenden Provider und liefert validierten Code zurück.
 *
 * @param prompt User-Text, z.B. "Generiere ein Script das BPM von 100 auf 140 rampt"
 * @param apiKey API-Key des aktiven Providers (aus useApiSettingsStore)
 * @param model Modell-ID, z.B. "claude-haiku-4-5-20251001" oder "gpt-4o-mini"
 * @param opts Optional: { existingCode, provider } — provider default "anthropic"
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
  const provider: AiProvider = opts.provider ?? "anthropic";

  try {
    const rawCode = provider === "openai"
      ? await callOpenAi(apiKey, model, userMessage)
      : await callAnthropic(apiKey, model, userMessage);

    const code = stripMarkdownFences(rawCode);
    const byteSize = encodeURIComponent(code).replace(/%[0-9A-F]{2}/g, "_").length;

    const validationError = validateGeneratedCode(code);
    if (validationError) {
      return { ok: false, error: validationError, code, byteSize };
    }

    return { ok: true, code, byteSize };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ─── Provider-spezifische API-Aufrufe ────────────────────────────────────────

async function callAnthropic(apiKey: string, model: string, userMessage: string): Promise<string> {
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
    throw new Error(`Anthropic-API ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  // AI4-B: Cost-Tracking. Anthropic usage-shape: { input_tokens, output_tokens }
  const usage = data?.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  if (usage) {
    recordAiCall("anthropic", usage.input_tokens ?? 0, usage.output_tokens ?? 0);
  }
  return data?.content?.[0]?.text ?? "";
}

async function callOpenAi(apiKey: string, model: string, userMessage: string): Promise<string> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI-API ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  // AI4-B: Cost-Tracking. OpenAI usage-shape: { prompt_tokens, completion_tokens, total_tokens }
  const usage = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  if (usage) {
    recordAiCall("openai", usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
  }
  return data?.choices?.[0]?.message?.content ?? "";
}
