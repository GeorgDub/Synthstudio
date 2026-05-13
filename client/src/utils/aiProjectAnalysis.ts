/**
 * Synthstudio – aiProjectAnalysis.ts
 *
 * LLM-basierte Projekt-Analyse via Anthropic ODER OpenAI.
 * Sendet eine strukturierte Mix-Snapshot (BPM, Parts, FX, Steps) an Claude
 * oder GPT und liefert natürlich-sprachliche Empfehlungen zurück.
 *
 * Multi-Provider-Support (post-v1.25.0): dispatcht anhand `opts.provider`
 * auf den passenden Provider-Endpoint. Default: anthropic (für Backward-Compat).
 *
 * Benötigt: API-Key + Modell + Provider aus useApiSettingsStore.
 */
import type { AiProvider } from "@/store/useApiSettingsStore";

export interface ProjectSnapshot {
  bpm: number;
  patternName: string;
  stepCount: number;
  /** Pro Part: name, sampleName, volume (0-1), pan (-1..+1), aktive Steps, FX-Status */
  parts: Array<{
    name: string;
    sampleName?: string;
    volume: number;
    pan: number;
    muted: boolean;
    soloed: boolean;
    activeStepCount: number;
    avgVelocity: number;
    fx: {
      filterEnabled: boolean;
      reverbEnabled: boolean;
      delayEnabled: boolean;
      distortionEnabled: boolean;
      compressorEnabled: boolean;
      eqEnabled: boolean;
    };
  }>;
}

export interface AiAnalysisResult {
  summary: string;
  recommendations: Array<{
    title: string;
    severity: "critical" | "warning" | "info";
    detail: string;
    affectedPart?: string;
  }>;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
/** Fallback-Modelle wenn der Caller keins angibt. */
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `Du bist ein professioneller Musik-Produktions-Coach mit Expertise in elektronischer Musik (Techno, House, Hardtekk, Hardcore, Drum & Bass).

Du erhältst einen JSON-Snapshot eines Drum-Machine-Patterns. Analysiere ihn und gib **konkrete, umsetzbare** Empfehlungen.

Fokussiere auf:
- Frequenz-Balance (Bass vs. Mid vs. High)
- Mix-Lautstärken (Headroom, Mute/Solo-Konflikte)
- Pattern-Dichte und Rhythmik
- FX-Übernutzung (zu viel Reverb / Delay)
- Genre-spezifische Tipps basierend auf BPM (z.B. 140+ BPM → Hardtekk-Tendenz)

**Format**: Liefere AUSSCHLIESSLICH valides JSON in dieser Struktur:
\`\`\`json
{
  "summary": "Kurze Gesamtbewertung in 1-2 Sätzen",
  "recommendations": [
    {
      "title": "Kurzer Titel",
      "severity": "critical" | "warning" | "info",
      "detail": "Konkrete Anleitung was zu tun ist",
      "affectedPart": "Optional: Part-Name"
    }
  ]
}
\`\`\`

Maximal 5 Recommendations. Antworte auf Deutsch.`;

/**
 * Optionen für `analyzeProjectWithAi`.
 *
 * - `provider`: AI-Provider — "anthropic" (default) oder "openai".
 * - `model`: Modell-ID. Default je nach Provider.
 * - `signal`: AbortSignal (z.B. zum Cancellen des Calls beim Tab-Switch).
 */
export interface AnalyzeOptions {
  provider?: AiProvider;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Ruft die KI mit dem Projekt-Snapshot auf und liefert Recommendations zurück.
 *
 * Backward-compat: Wird ohne 4. Parameter mit nur einem AbortSignal aufgerufen,
 * läuft die alte Anthropic-Default-Variante.
 */
export async function analyzeProjectWithAi(
  snapshot: ProjectSnapshot,
  apiKey: string,
  optsOrSignal?: AnalyzeOptions | AbortSignal,
): Promise<AiAnalysisResult> {
  if (!apiKey) throw new Error("Kein API-Key gesetzt. Bitte unter Settings → KI & API hinterlegen.");

  // Backward-compat: 3. Param kann ein AbortSignal sein (alte API).
  const opts: AnalyzeOptions =
    optsOrSignal && typeof (optsOrSignal as AbortSignal).aborted === "boolean"
      ? { signal: optsOrSignal as AbortSignal }
      : (optsOrSignal as AnalyzeOptions) ?? {};

  const provider: AiProvider = opts.provider ?? "anthropic";
  const model = opts.model ?? (provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL);
  const userMessage = `Hier ist mein aktuelles Drum-Pattern:\n\n${JSON.stringify(snapshot, null, 2)}\n\nGib mir bitte konkrete Verbesserungs-Vorschläge.`;

  const rawText = provider === "openai"
    ? await callAnalysisOpenAi(apiKey, model, userMessage, opts.signal)
    : await callAnalysisAnthropic(apiKey, model, userMessage, opts.signal);

  if (!rawText) throw new Error("Keine Antwort von der KI erhalten.");

  // JSON aus Markdown-Code-Block extrahieren (falls vorhanden)
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : rawText;

  try {
    const parsed = JSON.parse(jsonStr) as AiAnalysisResult;
    if (!parsed.summary || !Array.isArray(parsed.recommendations)) {
      throw new Error("Ungültiges Antwort-Format");
    }
    return parsed;
  } catch (err) {
    throw new Error(`KI-Antwort konnte nicht geparst werden: ${err instanceof Error ? err.message : "Unbekannt"}\n\nRoh-Antwort:\n${rawText.slice(0, 300)}`);
  }
}

async function callAnalysisAnthropic(
  apiKey: string,
  model: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal,
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unbekannter Fehler");
    throw new Error(`API-Fehler ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  const textBlock = data.content.find(c => c.type === "text");
  return textBlock?.text ?? "";
}

async function callAnalysisOpenAi(
  apiKey: string,
  model: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unbekannter Fehler");
    throw new Error(`API-Fehler ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data?.choices?.[0]?.message?.content ?? "";
}

/** Vereinfachte Snapshot-Variante für den MixAssistant (nur Mix-Metadaten). */
export function buildMixSnapshot(input: {
  bpm: number;
  patternName?: string;
  stepCount?: number;
  parts: Array<{
    name: string;
    volume: number;       // 0–127 in MixAnalysisInput
    pan: number;          // -100..+100 in MixAnalysisInput
    activeSteps: number;
    totalSteps: number;
  }>;
}): ProjectSnapshot {
  return {
    bpm: input.bpm,
    patternName: input.patternName ?? "Aktuelles Pattern",
    stepCount: input.stepCount ?? input.parts[0]?.totalSteps ?? 16,
    parts: input.parts.map(p => ({
      name: p.name,
      volume: p.volume / 127,
      pan: p.pan / 100,
      muted: false,
      soloed: false,
      activeStepCount: p.activeSteps,
      avgVelocity: 100,
      fx: {
        filterEnabled: false, reverbEnabled: false, delayEnabled: false,
        distortionEnabled: false, compressorEnabled: false, eqEnabled: false,
      },
    })),
  };
}

/** Erstellt einen Snapshot aus einem aktuellen Pattern. */
export function buildSnapshot(
  bpm: number,
  pattern: {
    name: string;
    stepCount: number;
    parts: Array<{
      name: string;
      sampleName?: string;
      volume: number;
      pan: number;
      muted: boolean;
      soloed: boolean;
      steps: Array<{ active: boolean; velocity?: number }>;
      fx: {
        filterEnabled: boolean;
        reverbEnabled: boolean;
        delayEnabled: boolean;
        distortionEnabled: boolean;
        compressorEnabled: boolean;
        eqEnabled: boolean;
      };
    }>;
  },
): ProjectSnapshot {
  return {
    bpm,
    patternName: pattern.name,
    stepCount: pattern.stepCount,
    parts: pattern.parts.map(p => {
      const active = p.steps.filter(s => s.active);
      const avgVel = active.length > 0
        ? active.reduce((sum, s) => sum + (s.velocity ?? 100), 0) / active.length
        : 0;
      return {
        name: p.name,
        sampleName: p.sampleName,
        volume: p.volume,
        pan: p.pan,
        muted: p.muted,
        soloed: p.soloed,
        activeStepCount: active.length,
        avgVelocity: Math.round(avgVel),
        fx: { ...p.fx },
      };
    }),
  };
}
