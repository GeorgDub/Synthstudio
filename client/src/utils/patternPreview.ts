/**
 * patternPreview.ts — Pure-Helper für die Pattern-Library-Vorschau.
 *
 * Synth.md-Wunsch: "in der pattern library unter Tools soll auch eine kleine
 * Vorschau oder anhör Funktion vorhanden sein damit man weiß welches pattern
 * man lädt."
 *
 * Berechnet die Sample-Hits eines Patterns (Zeitpunkt + URL + Lautstärke), die
 * dann via AudioEngine.previewSample der Reihe nach abgespielt werden — ohne den
 * laufenden Transport zu stören. Synth-Parts (wavetable/fm/granular) werden für
 * die Vorschau übersprungen (kein Sample-Buffer).
 */

/** Steps pro Beat je Step-Auflösung. */
const STEPS_PER_BEAT: Record<string, number> = {
  "1/8": 2,
  "1/16": 4,
  "1/32": 8,
};

export interface PreviewStep {
  active: boolean;
  velocity?: number;
}

export interface PreviewPart {
  sampleUrl?: string;
  volume?: number;
  sourceType?: string;
  steps: PreviewStep[];
}

export interface PreviewPattern {
  stepCount: number;
  stepResolution?: string;
  bpm?: number | null;
  parts: PreviewPart[];
}

export interface PreviewHit {
  /** Offset ab Vorschau-Start in Millisekunden. */
  timeMs: number;
  sampleUrl: string;
  /** 0–1, kombiniert Step-Velocity und Part-Volume. */
  volume: number;
}

export interface PreviewOptions {
  /** Fallback-BPM, falls das Pattern kein eigenes hat. */
  bpm: number;
  /** Wie viele Pattern-Durchläufe (Default 1). */
  bars?: number;
}

/** Millisekunden pro Step aus BPM + Auflösung. Exportiert für Tests. */
export function msPerStep(bpm: number, stepResolution: string = "1/16"): number {
  const safeBpm = bpm > 0 ? bpm : 120;
  const stepsPerBeat = STEPS_PER_BEAT[stepResolution] ?? 4;
  return 60000 / safeBpm / stepsPerBeat;
}

/**
 * Wandelt ein Pattern in eine zeitlich sortierte Liste abspielbarer Hits.
 * Leeres Ergebnis = nichts Hörbares (kein Sample-Part / keine aktiven Steps).
 */
export function computePatternPreviewHits(
  pattern: PreviewPattern,
  opts: PreviewOptions,
): PreviewHit[] {
  const bpm = pattern.bpm && pattern.bpm > 0 ? pattern.bpm : opts.bpm;
  const stepMs = msPerStep(bpm, pattern.stepResolution ?? "1/16");
  const bars = Math.max(1, opts.bars ?? 1);
  const totalSteps = pattern.stepCount * bars;
  const hits: PreviewHit[] = [];

  for (const part of pattern.parts) {
    // Nur Sample-Parts können via previewSample klingen.
    if (!part.sampleUrl) continue;
    if (part.sourceType && part.sourceType !== "sample") continue;
    const len = part.steps.length;
    if (len === 0) continue;

    const partVol = part.volume != null ? part.volume : 1;
    for (let i = 0; i < totalSteps; i++) {
      const step = part.steps[i % len];
      if (!step?.active) continue;
      const vel = step.velocity != null ? step.velocity / 127 : 1;
      hits.push({
        timeMs: Math.round(i * stepMs),
        sampleUrl: part.sampleUrl,
        volume: Math.max(0, Math.min(1, vel * partVol)),
      });
    }
  }

  return hits.sort((a, b) => a.timeMs - b.timeMs);
}

/** Gesamtdauer der Vorschau in ms (für Auto-Stop nach dem letzten Hit + Tail). */
export function previewDurationMs(
  pattern: PreviewPattern,
  opts: PreviewOptions,
): number {
  const bpm = pattern.bpm && pattern.bpm > 0 ? pattern.bpm : opts.bpm;
  const stepMs = msPerStep(bpm, pattern.stepResolution ?? "1/16");
  const bars = Math.max(1, opts.bars ?? 1);
  return Math.round(pattern.stepCount * bars * stepMs);
}
