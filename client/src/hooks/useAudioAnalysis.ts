/**
 * Synthstudio – useAudioAnalysis Hook
 *
 * Kombiniert Web Worker (Browser) und Electron-IPC (Desktop) für die Audio-Analyse.
 * Nutzt den IndexedDB-Cache um wiederholte Analysen zu vermeiden.
 *
 * Features:
 * - Worker-Pool: Bis zu 4 parallele Analyse-Worker
 * - Cache-Integration: Ergebnisse werden in IndexedDB gespeichert
 * - BPM-Detection: Automatische BPM-Schätzung beim Import
 * - Auto-Tagging: Kategorisierung basierend auf Dateiname und Frequenzinhalt
 * - Fortschrittsanzeige: Echtzeit-Feedback während der Analyse
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { waveformCache, type CachedWaveformData } from "@/utils/waveformCache";
import { useElectron } from "../../../electron/useElectron";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface AnalysisResult extends CachedWaveformData {
  filePath: string;
}

export interface AnalysisProgress {
  total: number;
  completed: number;
  percentage: number;
  currentFile?: string;
}

export interface UseAudioAnalysisReturn {
  /** Einzelne Datei analysieren */
  analyzeFile: (filePath: string, audioData?: ArrayBuffer) => Promise<AnalysisResult | null>;
  /** Mehrere Dateien analysieren (mit Worker-Pool) */
  analyzeFiles: (
    files: Array<{ path: string; data?: ArrayBuffer }>,
    onProgress?: (progress: AnalysisProgress) => void
  ) => Promise<AnalysisResult[]>;
  /** BPM für eine Datei ermitteln */
  detectBpm: (filePath: string, audioData: ArrayBuffer) => Promise<number | null>;
  /** Cache-Eintrag für eine Datei löschen */
  invalidateCache: (filePath: string) => Promise<void>;
  /** Gesamten Cache leeren */
  clearCache: () => Promise<void>;
  /** Ob gerade eine Analyse läuft */
  isAnalyzing: boolean;
  /** Aktueller Fortschritt */
  progress: AnalysisProgress | null;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const MAX_WORKERS = 4;
const DEFAULT_NUM_PEAKS = 200;

// ─── Auto-Tagging ─────────────────────────────────────────────────────────────

function autoTag(filePath: string): string[] {
  const name = filePath.toLowerCase().split(/[\\/]/).pop() ?? "";
  const tags: string[] = [];

  // Dateiname-basiertes Tagging
  if (/kick|bd|bass.?drum|bassdrum/.test(name)) tags.push("kick");
  else if (/snare|sd|clap|rimshot/.test(name)) tags.push("snare");
  else if (/hihat|hh|hat|cymbal/.test(name)) {
    if (/open|oh/.test(name)) tags.push("open-hat");
    else tags.push("closed-hat");
  } else if (/tom|floor|rack/.test(name)) tags.push("tom");
  else if (/crash|ride|cym/.test(name)) tags.push("cymbal");
  else if (/perc|conga|bongo|shaker|tamb/.test(name)) tags.push("percussion");
  else if (/bass|sub/.test(name)) tags.push("bass");
  else if (/lead|synth|pad|keys/.test(name)) tags.push("synth");
  else if (/fx|effect|noise|sweep/.test(name)) tags.push("fx");
  else if (/loop|break/.test(name)) tags.push("loop");
  else if (/vocal|vox|voice/.test(name)) tags.push("vocal");

  return tags;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAudioAnalysis(): UseAudioAnalysisReturn {
  const electron = useElectron();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const workersRef = useRef<Worker[]>([]);
  const pendingRef = useRef<Map<string, { resolve: (r: AnalysisResult | null) => void }>>(
    new Map()
  );

  // Worker-Pool initialisieren (nur im Browser)
  useEffect(() => {
    if (electron.isElectron || typeof Worker === "undefined") return;

    // Worker erstellen (Vite-kompatibel)
    try {
      for (let i = 0; i < MAX_WORKERS; i++) {
        const worker = new Worker(
          new URL("../workers/audioAnalysis.worker.ts", import.meta.url),
          { type: "module" }
        );

        worker.onmessage = (event) => {
          const { type, id, ...data } = event.data;
          const pending = pendingRef.current.get(id);

          if (!pending) return;

          if (type === "result") {
            pending.resolve({
              filePath: id,
              peaks: data.peaks,
              duration: data.duration,
              sampleRate: data.sampleRate,
              channels: data.channels,
              cachedAt: Date.now(),
            });
            pendingRef.current.delete(id);
          } else if (type === "error") {
            console.warn(`[AudioAnalysis] Fehler bei ${id}:`, data.message);
            pending.resolve(null);
            pendingRef.current.delete(id);
          }
        };

        workersRef.current.push(worker);
      }
    } catch (err) {
      console.warn("[AudioAnalysis] Worker-Initialisierung fehlgeschlagen:", err);
    }

    return () => {
      workersRef.current.forEach((w) => w.terminate());
      workersRef.current = [];
    };
  }, [electron.isElectron]);

  /** Einzelne Datei analysieren */
  const analyzeFile = useCallback(
    async (filePath: string, audioData?: ArrayBuffer): Promise<AnalysisResult | null> => {
      // Cache prüfen
      const cached = await waveformCache.get(filePath);
      if (cached) {
        return { filePath, ...cached };
      }

      try {
        let result: AnalysisResult | null = null;

        if (electron.isElectron) {
          // Electron: Nativer Worker via IPC
          const waveformResult = await electron.analyzeWaveform(filePath, DEFAULT_NUM_PEAKS);
          if (waveformResult.success && waveformResult.peaks) {
            const tags = autoTag(filePath);
            result = {
              filePath,
              peaks: waveformResult.peaks,
              duration: waveformResult.duration ?? 0,
              sampleRate: waveformResult.sampleRate ?? 44100,
              channels: waveformResult.channels ?? 1,
              bitDepth: waveformResult.bitDepth,
              fileSize: waveformResult.fileSize,
              tags,
              cachedAt: Date.now(),
            };
          }
        } else if (audioData && workersRef.current.length > 0) {
          // Browser: Web Worker
          const workerIndex = pendingRef.current.size % workersRef.current.length;
          const worker = workersRef.current[workerIndex];

          result = await new Promise<AnalysisResult | null>((resolve) => {
            pendingRef.current.set(filePath, { resolve });
            worker.postMessage(
              { type: "analyze", id: filePath, audioData, numPeaks: DEFAULT_NUM_PEAKS },
              [audioData]
            );

            // Timeout nach 30s
            setTimeout(() => {
              if (pendingRef.current.has(filePath)) {
                pendingRef.current.delete(filePath);
                resolve(null);
              }
            }, 30000);
          });

          if (result) {
            result.tags = autoTag(filePath);
          }
        }

        // In Cache speichern
        if (result) {
          await waveformCache.set(filePath, {
            peaks: result.peaks,
            duration: result.duration,
            sampleRate: result.sampleRate,
            channels: result.channels,
            bitDepth: result.bitDepth,
            fileSize: result.fileSize,
            tags: result.tags,
            cachedAt: result.cachedAt,
          });
        }

        return result;
      } catch (err) {
        console.warn(`[AudioAnalysis] Fehler bei ${filePath}:`, err);
        return null;
      }
    },
    [electron]
  );

  /** Mehrere Dateien analysieren mit Worker-Pool */
  const analyzeFiles = useCallback(
    async (
      files: Array<{ path: string; data?: ArrayBuffer }>,
      onProgress?: (progress: AnalysisProgress) => void
    ): Promise<AnalysisResult[]> => {
      setIsAnalyzing(true);
      const results: AnalysisResult[] = [];
      let completed = 0;

      const updateProgress = (currentFile?: string) => {
        const p = {
          total: files.length,
          completed,
          percentage: Math.round((completed / files.length) * 100),
          currentFile,
        };
        setProgress(p);
        onProgress?.(p);
      };

      updateProgress();

      // Batch-Verarbeitung mit Worker-Pool-Größe
      const batchSize = Math.max(1, MAX_WORKERS);
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            updateProgress(file.path.split(/[\\/]/).pop());
            const result = await analyzeFile(file.path, file.data);
            completed++;
            updateProgress();
            return result;
          })
        );
        results.push(...batchResults.filter((r): r is AnalysisResult => r !== null));
      }

      setIsAnalyzing(false);
      setProgress(null);
      return results;
    },
    [analyzeFile]
  );

  /** BPM-Detection */
  const detectBpm = useCallback(
    async (filePath: string, audioData: ArrayBuffer): Promise<number | null> => {
      // Aus Cache lesen falls vorhanden
      const cached = await waveformCache.get(filePath);
      if (cached?.estimatedBpm) return cached.estimatedBpm;

      if (workersRef.current.length === 0) return null;

      return new Promise<number | null>((resolve) => {
        const worker = workersRef.current[0];
        const id = `bpm-${filePath}`;

        const handler = (event: MessageEvent) => {
          if (event.data.id !== id) return;
          if (event.data.type === "bpmResult") {
            worker.removeEventListener("message", handler);
            const bpm = event.data.confidence > 0.5 ? event.data.bpm : null;

            // BPM in Cache speichern
            if (bpm) {
              waveformCache.get(filePath).then((cached) => {
                if (cached) {
                  waveformCache.set(filePath, { ...cached, estimatedBpm: bpm });
                }
              });
            }

            resolve(bpm);
          } else if (event.data.type === "error") {
            worker.removeEventListener("message", handler);
            resolve(null);
          }
        };

        worker.addEventListener("message", handler);
        worker.postMessage(
          { type: "analyzeBpm", id, audioData },
          [audioData]
        );

        setTimeout(() => {
          worker.removeEventListener("message", handler);
          resolve(null);
        }, 15000);
      });
    },
    []
  );

  const invalidateCache = useCallback(
    (filePath: string) => waveformCache.delete(filePath),
    []
  );

  const clearCache = useCallback(() => waveformCache.clear(), []);

  return {
    analyzeFile,
    analyzeFiles,
    detectBpm,
    invalidateCache,
    clearCache,
    isAnalyzing,
    progress,
  };
}
