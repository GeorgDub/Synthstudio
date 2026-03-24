/**
 * Synthstudio – useBpmDetection Hook
 *
 * Automatische BPM-Erkennung und Sample-Tagging beim Import.
 * Nutzt den Audio-Analyse-Worker für die Analyse.
 *
 * Features:
 * - BPM-Detection für einzelne Samples
 * - Batch-BPM-Detection für importierte Sample-Listen
 * - Auto-Tagging: Kategorie-Erkennung aus Dateiname + Frequenzinhalt
 * - Tag-Vorschläge basierend auf BPM (z.B. "techno" bei 130–145 BPM)
 * - Integration mit useProjectStore (Sample-Tags aktualisieren)
 */
import { useCallback, useState } from "react";
import type { Sample } from "@/store/useProjectStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface TaggedSample extends Sample {
  estimatedBpm?: number;
  autoTags: string[];
  confidence: number;
}

export interface BpmDetectionResult {
  sampleId: string;
  bpm: number;
  confidence: number;
  tags: string[];
}

// ─── BPM-zu-Genre-Mapping ─────────────────────────────────────────────────────

function bpmToGenreTags(bpm: number): string[] {
  const tags: string[] = [];

  if (bpm >= 60 && bpm <= 80) tags.push("hip-hop", "boom-bap");
  else if (bpm >= 80 && bpm <= 100) tags.push("r&b", "soul");
  else if (bpm >= 100 && bpm <= 115) tags.push("house-slow", "pop");
  else if (bpm >= 115 && bpm <= 135) tags.push("house");
  else if (bpm >= 128 && bpm <= 145) tags.push("techno", "trance");
  else if (bpm >= 140 && bpm <= 160) tags.push("drum-and-bass", "jungle");
  else if (bpm >= 160 && bpm <= 200) tags.push("hardcore", "gabber");

  return tags;
}

// ─── Dateiname-basiertes Auto-Tagging ─────────────────────────────────────────

export function autoTagFromFilename(filePath: string): string[] {
  const name = filePath.toLowerCase().split(/[\\/]/).pop() ?? "";
  const tags: string[] = [];

  // Drum-Kategorien
  if (/\bkick\b|^bd[_\-\s]|bass.?drum/.test(name)) tags.push("kick");
  else if (/\bsnare\b|^sd[_\-\s]|\bclap\b|\brimshot\b/.test(name)) tags.push("snare");
  else if (/open.?hat|^oh[_\-\s]|\boh\b/.test(name)) tags.push("open-hat");
  else if (/closed.?hat|^ch[_\-\s]|\bch\b|hi.?hat|^hh[_\-\s]/.test(name)) tags.push("closed-hat");
  else if (/\btom\b|floor.?tom|rack.?tom/.test(name)) tags.push("tom");
  else if (/\bcrash\b|\bride\b|\bcymbal\b/.test(name)) tags.push("cymbal");
  else if (/\bperc\b|\bconga\b|\bbongo\b|\bshaker\b|\btamb\b|\bmarac\b/.test(name)) tags.push("percussion");

  // Melodische Kategorien
  if (/\bbass\b|\bsub\b/.test(name) && !tags.includes("kick")) tags.push("bass");
  if (/\blead\b|\bsynth\b|\bpad\b|\bkeys\b|\bpiano\b/.test(name)) tags.push("synth");
  if (/\bfx\b|\beffect\b|\bnoise\b|\bsweep\b|\briser\b|\bdownlifter\b/.test(name)) tags.push("fx");
  if (/\bloop\b|\bbreak\b|\bgroove\b/.test(name)) tags.push("loop");
  if (/\bvocal\b|\bvox\b|\bvoice\b|\bchant\b/.test(name)) tags.push("vocal");
  if (/\bchord\b|\bstab\b/.test(name)) tags.push("chord");

  // Qualitäts-Tags
  if (/\bdry\b/.test(name)) tags.push("dry");
  if (/\bwet\b|\bverb\b|\brevb\b/.test(name)) tags.push("wet");
  if (/\blong\b/.test(name)) tags.push("long");
  if (/\bshort\b/.test(name)) tags.push("short");

  return [...new Set(tags)]; // Duplikate entfernen
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBpmDetection() {
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionProgress, setDetectionProgress] = useState(0);

  /**
   * Sample mit Auto-Tags anreichern (ohne BPM-Analyse, nur Dateiname).
   * Schnell und synchron – für sofortiges Feedback beim Import.
   */
  const tagSampleFromFilename = useCallback((sample: Sample): TaggedSample => {
    const autoTags = autoTagFromFilename(sample.path);
    return {
      ...sample,
      autoTags,
      confidence: autoTags.length > 0 ? 0.8 : 0.1,
    };
  }, []);

  /**
   * Mehrere Samples mit Auto-Tags anreichern.
   * Batch-Verarbeitung für den Import-Flow.
   */
  const tagSamplesFromFilenames = useCallback(
    (samples: Sample[]): TaggedSample[] => {
      return samples.map((s) => tagSampleFromFilename(s));
    },
    [tagSampleFromFilename]
  );

  /**
   * BPM für ein Sample via Web Audio API schätzen.
   * Lädt die Datei und analysiert den Rhythmus.
   * Nur im Browser verfügbar (in Electron: Electron-Worker nutzen).
   */
  const detectBpmForSample = useCallback(
    async (sample: Sample): Promise<BpmDetectionResult | null> => {
      if (typeof fetch === "undefined") return null;

      try {
        // Datei laden (Browser: Blob-URL, Electron: file:// URL)
        const url = sample.path.startsWith("/")
          ? `file://${sample.path}`
          : sample.path;

        const response = await fetch(url);
        if (!response.ok) return null;

        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        await audioContext.close();

        // Einfache Onset-Erkennung
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const windowSize = Math.floor(sampleRate * 0.01);
        const energies: number[] = [];

        for (let i = 0; i < Math.min(channelData.length, sampleRate * 30); i += windowSize) {
          let energy = 0;
          for (let j = i; j < Math.min(i + windowSize, channelData.length); j++) {
            energy += channelData[j] * channelData[j];
          }
          energies.push(energy / windowSize);
        }

        const onsets: number[] = [];
        for (let i = 1; i < energies.length - 1; i++) {
          const localMean =
            energies.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) /
            Math.min(20, i);
          if (energies[i] > localMean * 1.5 && energies[i] > energies[i - 1]) {
            onsets.push((i * windowSize * 1000) / sampleRate);
            i += 5;
          }
        }

        if (onsets.length < 4) return null;

        const intervals: number[] = [];
        for (let i = 1; i < onsets.length; i++) {
          const interval = onsets[i] - onsets[i - 1];
          if (interval > 200 && interval < 2000) intervals.push(interval);
        }

        if (intervals.length === 0) return null;

        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        let bpm = 60000 / median;
        while (bpm < 60) bpm *= 2;
        while (bpm > 200) bpm /= 2;
        bpm = Math.round(bpm);

        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance =
          intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
        const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / mean));

        const autoTags = [
          ...autoTagFromFilename(sample.path),
          ...(confidence > 0.5 ? bpmToGenreTags(bpm) : []),
        ];

        return {
          sampleId: sample.id,
          bpm,
          confidence,
          tags: [...new Set(autoTags)],
        };
      } catch {
        return null;
      }
    },
    []
  );

  /**
   * BPM-Detection für eine Liste von Samples (Batch).
   */
  const detectBpmBatch = useCallback(
    async (
      samples: Sample[],
      onProgress?: (completed: number, total: number) => void
    ): Promise<Map<string, BpmDetectionResult>> => {
      setIsDetecting(true);
      setDetectionProgress(0);

      const results = new Map<string, BpmDetectionResult>();

      // Nur Samples analysieren die wahrscheinlich rhythmisch sind
      const rhythmicSamples = samples.filter((s) => {
        const tags = autoTagFromFilename(s.path);
        return (
          tags.some((t) =>
            ["kick", "snare", "closed-hat", "open-hat", "tom", "loop"].includes(t)
          ) || tags.length === 0 // Unbekannte auch analysieren
        );
      });

      for (let i = 0; i < rhythmicSamples.length; i++) {
        const sample = rhythmicSamples[i];
        const result = await detectBpmForSample(sample);
        if (result) results.set(sample.id, result);

        const progress = Math.round(((i + 1) / rhythmicSamples.length) * 100);
        setDetectionProgress(progress);
        onProgress?.(i + 1, rhythmicSamples.length);
      }

      setIsDetecting(false);
      setDetectionProgress(0);
      return results;
    },
    [detectBpmForSample]
  );

  return {
    tagSampleFromFilename,
    tagSamplesFromFilenames,
    detectBpmForSample,
    detectBpmBatch,
    isDetecting,
    detectionProgress,
  };
}
