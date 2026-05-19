/**
 * Pure-Helper: Track-Overview-Aggregator (v3.166).
 *
 * Aggregiert Statistik über ein Projekt: Pattern-Anzahl, Channel-Counts
 * (muted/soloed/silent), Density-Average. Für künftige Project-Dashboards
 * oder Status-Anzeigen. Keine Audio-Engine-Abhängigkeiten — reine Iteration
 * über PatternData[] + Channel-Liste.
 *
 * Public API:
 *   - computeTrackOverview(input) → TrackOverviewResult
 *   - formatTrackOverviewSummary(result) → string
 */
import type { PatternData } from "@/audio/AudioEngine";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ChannelLike {
  id: string;
  name?: string;
  muted?: boolean;
  soloed?: boolean;
  volume?: number;
}

export interface TrackOverviewInput {
  patterns: readonly PatternData[];
  channels: readonly ChannelLike[];
  /** Optional: Total-Sample-Count im Projekt (vom SampleStore). */
  totalSamples?: number;
}

export interface TrackOverviewResult {
  patternCount: number;
  channelCount: number;
  /** Channels mit muted=true. */
  mutedChannelCount: number;
  /** Channels mit soloed=true. */
  soloedChannelCount: number;
  /** Total active steps across all patterns + parts. */
  totalActiveSteps: number;
  /** Total possible steps (patterns × parts × stepCount). */
  totalPossibleSteps: number;
  /** Average density (totalActiveSteps / totalPossibleSteps). */
  averageDensity: number;
  /** Sample count if provided, sonst 0. */
  sampleCount: number;
  /** Channels mit volume === 0 (silent). */
  silentChannelCount: number;
}

// ─── computeTrackOverview ─────────────────────────────────────────────────────

/**
 * Aggregiert ein TrackOverviewResult aus Patterns + Channels.
 *
 * Defensiv: Fehlende Patterns / Parts / Steps führen zu 0-Counts (kein Throw).
 * Channel-Felder muted/soloed/volume sind optional — undefined wird wie
 * false/non-silent behandelt.
 */
export function computeTrackOverview(
  input: TrackOverviewInput,
): TrackOverviewResult {
  const patterns = input.patterns ?? [];
  const channels = input.channels ?? [];

  const patternCount = patterns.length;
  const channelCount = channels.length;

  let mutedChannelCount = 0;
  let soloedChannelCount = 0;
  let silentChannelCount = 0;
  for (const ch of channels) {
    if (ch.muted === true) mutedChannelCount++;
    if (ch.soloed === true) soloedChannelCount++;
    if (ch.volume === 0) silentChannelCount++;
  }

  let totalActiveSteps = 0;
  let totalPossibleSteps = 0;
  for (const pat of patterns) {
    const parts = pat?.parts ?? [];
    for (const part of parts) {
      const steps = part?.steps ?? [];
      totalPossibleSteps += steps.length;
      for (const step of steps) {
        if (step?.active === true) totalActiveSteps++;
      }
    }
  }

  const averageDensity =
    totalPossibleSteps > 0 ? totalActiveSteps / totalPossibleSteps : 0;

  const sampleCount = input.totalSamples ?? 0;

  return {
    patternCount,
    channelCount,
    mutedChannelCount,
    soloedChannelCount,
    totalActiveSteps,
    totalPossibleSteps,
    averageDensity,
    sampleCount,
    silentChannelCount,
  };
}

// ─── formatTrackOverviewSummary ───────────────────────────────────────────────

/**
 * Format ein TrackOverviewResult als kompakten Status-String.
 *
 * Beispiele:
 *   "0 Patterns · 0 Channels · 0% Density"
 *   "8 Patterns · 12 Channels (3 muted) · ~45% Density · 24 Samples"
 *   "4 Patterns · 8 Channels (1 muted/2 solo) · ~30% Density"
 *
 * Regeln:
 *   - mutedChannelCount > 0 → "({N} muted)" inline an Channels
 *   - soloedChannelCount > 0 → "/{N} solo" inline mit muted-Block
 *   - sampleCount > 0 → " · {N} Samples"
 *   - density wird gerundet (Math.round(d*100))
 */
export function formatTrackOverviewSummary(
  result: TrackOverviewResult,
): string {
  const {
    patternCount,
    channelCount,
    mutedChannelCount,
    soloedChannelCount,
    averageDensity,
    sampleCount,
  } = result;

  // Channel-Suffix für muted/solo
  let channelSuffix = "";
  if (mutedChannelCount > 0 || soloedChannelCount > 0) {
    const parts: string[] = [];
    if (mutedChannelCount > 0) parts.push(`${mutedChannelCount} muted`);
    if (soloedChannelCount > 0) parts.push(`${soloedChannelCount} solo`);
    channelSuffix = ` (${parts.join("/")})`;
  }

  const densityPct = Math.round(averageDensity * 100);
  const densityStr =
    averageDensity > 0 ? `~${densityPct}% Density` : `${densityPct}% Density`;

  const samplesSuffix = sampleCount > 0 ? ` · ${sampleCount} Samples` : "";

  return (
    `${patternCount} Patterns · ${channelCount} Channels${channelSuffix}` +
    ` · ${densityStr}${samplesSuffix}`
  );
}
