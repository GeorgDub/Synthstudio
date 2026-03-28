/**
 * mixAnalysis.ts
 *
 * Regelbasierter KI-Mix-Assistent für Synthstudio.
 * Analysiert den aktuellen Pattern-State und gibt priorisierte
 * Empfehlungen zurück – ohne LLM-Abhängigkeit.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface PartSnapshot {
  id: string;
  name: string;
  /** 0–127 */
  volume: number;
  /** -100 (links) bis +100 (rechts) */
  pan: number;
  /** Anzahl aktiver Steps */
  activeSteps: number;
  /** Gesamtanzahl Steps */
  totalSteps: number;
  /** Hat Low-Pass-Filter: Cutoff-Frequenz in Hz (optional) */
  filterCutoff?: number;
  /** Reverb-Send-Level 0–100 */
  reverbSend?: number;
  /** Spur-Typ-Hint (Kick, Snare, HiHat, Bass, Pad, …) */
  trackType?: string;
}

export interface MixAnalysisInput {
  /** BPM des aktuellen Patterns */
  bpm: number;
  /** Alle aktiven Parts */
  parts: PartSnapshot[];
  /** Gesamte Lautstärke des Masters (0–127) */
  masterVolume: number;
}

export type RecommendationSeverity = "info" | "warning" | "critical";
export type RecommendationCategory = "volume" | "panning" | "density" | "filter" | "fx" | "bpm";

export interface MixRecommendation {
  id: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  message: string;
  /** Betroffene Part-ID (falls zutreffend) */
  partId?: string;
  /** Optionaler Zielwert für automatisches Anwenden */
  suggestedValue?: number;
  /** Welche Property soll geändert werden? */
  targetProperty?: keyof PartSnapshot | "masterVolume";
}

// ─── Konstanten ────────────────────────────────────────────────────────────────

const KICK_TYPES = ["kick", "bd", "bass drum", "bassdrum"];
const SNARE_TYPES = ["snare", "sd", "clap"];
const HAT_TYPES = ["hihat", "hh", "hat", "cymbal"];
const BASS_TYPES = ["bass", "subbass", "sub"];

function matchesType(trackType: string | undefined, keywords: string[]): boolean {
  if (!trackType) return false;
  const lower = trackType.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

// ─── Einzelregel-Prüfungen ────────────────────────────────────────────────────

function checkKickVolume(parts: PartSnapshot[]): MixRecommendation[] {
  const recs: MixRecommendation[] = [];
  const kicks = parts.filter(p => matchesType(p.trackType, KICK_TYPES));
  kicks.forEach(k => {
    if (k.volume > 110) {
      recs.push({
        id: `vol-kick-loud-${k.id}`,
        category: "volume",
        severity: "warning",
        message: `"${k.name}" (Kick) ist sehr laut (${k.volume}/127). Lautstärke auf 90–100 reduzieren.`,
        partId: k.id,
        suggestedValue: 100,
        targetProperty: "volume",
      });
    }
    if (k.volume < 60) {
      recs.push({
        id: `vol-kick-quiet-${k.id}`,
        category: "volume",
        severity: "info",
        message: `"${k.name}" (Kick) ist relativ leise (${k.volume}/127). Im Mix ggf. auf 80+ anheben.`,
        partId: k.id,
        suggestedValue: 80,
        targetProperty: "volume",
      });
    }
  });
  return recs;
}

function checkLowEndBalance(parts: PartSnapshot[]): MixRecommendation[] {
  const recs: MixRecommendation[] = [];
  const kickParts = parts.filter(p => matchesType(p.trackType, KICK_TYPES));
  const bassParts = parts.filter(p => matchesType(p.trackType, BASS_TYPES));

  if (kickParts.length > 0 && bassParts.length > 0) {
    const avgKick = kickParts.reduce((s, p) => s + p.volume, 0) / kickParts.length;
    const avgBass = bassParts.reduce((s, p) => s + p.volume, 0) / bassParts.length;
    if (avgKick > 0 && avgBass > 0 && Math.abs(avgKick - avgBass) < 5) {
      recs.push({
        id: "balance-kick-bass",
        category: "volume",
        severity: "info",
        message: "Kick und Bass haben ähnliche Lautstärken – Sidechain/Ducking könnte die Klarheit verbessern.",
      });
    }
  }
  return recs;
}

function checkPanning(parts: PartSnapshot[]): MixRecommendation[] {
  const recs: MixRecommendation[] = [];

  // Kick und Snare sollten Center-nah sein
  const centerParts = parts.filter(p =>
    matchesType(p.trackType, KICK_TYPES) || matchesType(p.trackType, SNARE_TYPES)
  );
  centerParts.forEach(p => {
    if (Math.abs(p.pan) > 20) {
      recs.push({
        id: `pan-center-${p.id}`,
        category: "panning",
        severity: "warning",
        message: `"${p.name}" ist zu stark von der Mitte (${p.pan > 0 ? "+" : ""}${p.pan}). Kick/Snare sollten nah am Center bleiben.`,
        partId: p.id,
        suggestedValue: 0,
        targetProperty: "pan",
      });
    }
  });

  // Alle Parts links oder alle rechts → Unbalanced Mix
  const leftBias = parts.filter(p => p.pan < -30).length;
  const rightBias = parts.filter(p => p.pan > 30).length;
  if (leftBias > parts.length * 0.6) {
    recs.push({
      id: "pan-all-left",
      category: "panning",
      severity: "warning",
      message: "Die meisten Spuren sind stark links gepannt – Mix ist unausgewogen.",
    });
  }
  if (rightBias > parts.length * 0.6) {
    recs.push({
      id: "pan-all-right",
      category: "panning",
      severity: "warning",
      message: "Die meisten Spuren sind stark rechts gepannt – Mix ist unausgewogen.",
    });
  }

  return recs;
}

function checkDensity(parts: PartSnapshot[]): MixRecommendation[] {
  const recs: MixRecommendation[] = [];
  parts.forEach(p => {
    if (p.totalSteps === 0) return;
    const density = p.activeSteps / p.totalSteps;
    if (density > 0.85 && matchesType(p.trackType, HAT_TYPES)) {
      recs.push({
        id: `density-hat-${p.id}`,
        category: "density",
        severity: "info",
        message: `"${p.name}" ist sehr dicht (${p.activeSteps}/${p.totalSteps} Steps aktiv). HiHats klingen mit weniger Steps oft groove-voller.`,
        partId: p.id,
      });
    }
    if (density === 0 && p.activeSteps === 0) {
      recs.push({
        id: `density-silent-${p.id}`,
        category: "density",
        severity: "info",
        message: `"${p.name}" hat keine aktiven Steps – ggf. aus Pattern entfernen oder ausblenden.`,
        partId: p.id,
      });
    }
  });
  return recs;
}

function checkBpm(bpm: number): MixRecommendation[] {
  const recs: MixRecommendation[] = [];
  if (bpm > 200) {
    recs.push({
      id: "bpm-high",
      category: "bpm",
      severity: "warning",
      message: `BPM ${bpm} ist sehr hoch. Überprüfen ob das Pattern korrekt klingt.`,
    });
  }
  if (bpm < 60) {
    recs.push({
      id: "bpm-low",
      category: "bpm",
      severity: "info",
      message: `BPM ${bpm} ist sehr niedrig. Für Hip-Hop/Trap typisch, sonst ggf. anpassen.`,
    });
  }
  return recs;
}

function checkMasterVolume(masterVolume: number): MixRecommendation[] {
  if (masterVolume > 115) {
    return [{
      id: "master-clipping",
      category: "volume",
      severity: "critical",
      message: `Master-Lautstärke (${masterVolume}/127) ist im Clipping-Bereich. Auf ≤ 110 reduzieren.`,
      suggestedValue: 100,
      targetProperty: "masterVolume",
    }];
  }
  return [];
}

// ─── Haupt-Analyse-Funktion ───────────────────────────────────────────────────

/**
 * Analysiert den Mix und gibt priorisierte Empfehlungen zurück.
 * Critical > Warning > Info, dann alphabetisch nach ID.
 */
export function analyzeMix(input: MixAnalysisInput): MixRecommendation[] {
  const all: MixRecommendation[] = [
    ...checkMasterVolume(input.masterVolume),
    ...checkBpm(input.bpm),
    ...checkKickVolume(input.parts),
    ...checkLowEndBalance(input.parts),
    ...checkPanning(input.parts),
    ...checkDensity(input.parts),
  ];

  const order: RecommendationSeverity[] = ["critical", "warning", "info"];
  return all.sort((a, b) => {
    const ai = order.indexOf(a.severity);
    const bi = order.indexOf(b.severity);
    if (ai !== bi) return ai - bi;
    return a.id.localeCompare(b.id);
  });
}
