import { useEffect, useMemo, useRef, useState } from "react";
import type { PartData } from "../audio/AudioEngine";
import { SpectrumAnalyzer } from "../audio/SpectrumAnalyzer";
import type { FrequencyBand, SpectrumFrame } from "../audio/SpectrumAnalyzer";
import {
  computeDensityMap,
  detectFlashingPairs,
} from "../utils/patternDensity";
import type { DensityMap } from "../utils/patternDensity";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MixAnalyticsData {
  /** Real-time FFT frame – null until AudioContext is ready */
  spectrum: SpectrumFrame | null;
  /** Standard frequency bands with magnitude / peak */
  bands: FrequencyBand[];
  /** Pattern density (re-computed when parts change) */
  density: DensityMap | null;
  /** Part pairs with co-activation above the clash threshold */
  clashPairs: Array<{ partA: string; partB: string; coActivation: number }>;
  /** Whether real-time spectrum analysis is running */
  isAnalyzing: boolean;
}

export interface MixAnalyticsOptions {
  /** Parts for density analysis */
  parts: PartData[];
  /** AudioContext – omit or pass null for density-only mode */
  audioContext?: AudioContext | null;
  /** Source node to analyse – omit or pass null to skip spectrum */
  sourceNode?: AudioNode | null;
  /** Spectrum update interval in ms (default 100 ms = 10 fps) */
  updateIntervalMs?: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMixAnalytics(options: MixAnalyticsOptions): MixAnalyticsData {
  const {
    parts,
    audioContext,
    sourceNode,
    updateIntervalMs = 100,
  } = options;

  const analyzerRef = useRef<SpectrumAnalyzer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const [spectrum, setSpectrum] = useState<SpectrumFrame | null>(null);
  const [bands, setBands] = useState<FrequencyBand[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // ── Spectrum loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Require both audioContext and sourceNode
    if (!audioContext || !sourceNode) {
      // Clean up any previous analyzer
      analyzerRef.current?.disconnect();
      analyzerRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setIsAnalyzing(false);
      setSpectrum(null);
      setBands([]);
      return;
    }

    const analyzer = new SpectrumAnalyzer(audioContext);
    analyzer.connect(sourceNode);
    analyzerRef.current = analyzer;
    setIsAnalyzing(true);

    const tick = (now: number) => {
      if (now - lastTickRef.current >= updateIntervalMs) {
        lastTickRef.current = now;
        setSpectrum(analyzer.getFrame());
        setBands(analyzer.getBands());
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      analyzer.disconnect();
      analyzerRef.current = null;
      setIsAnalyzing(false);
    };
  }, [audioContext, sourceNode, updateIntervalMs]);

  // ── Density + clashes (static, recomputed on parts change) ────────────────
  const density = useMemo<DensityMap | null>(() => {
    if (parts.length === 0) return null;
    return computeDensityMap(parts);
  }, [parts]);

  const clashPairs = useMemo(
    () => detectFlashingPairs(parts),
    [parts],
  );

  return { spectrum, bands, density, clashPairs, isAnalyzing };
}
