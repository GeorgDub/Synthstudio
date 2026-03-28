/**
 * Synthstudio – Waveform-Cache (Audio-Engine-Agent)
 *
 * In-Memory LRU-Cache für Waveform-Analysedaten.
 * Verhindert wiederholte Analyse derselben Dateien.
 * Maximale Größe: 500 Einträge (älteste werden entfernt).
 *
 * Verwendung:
 * ```ts
 * import { waveformCache } from "./waveform-cache";
 * const cached = waveformCache.get("/path/to/file.wav");
 * if (!cached) {
 *   const data = await analyzeFile(...);
 *   waveformCache.set("/path/to/file.wav", data);
 * }
 * ```
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface CachedWaveform {
  /** Normalisierte Peak-Werte (0–1) */
  peaks: number[];
  /** Dauer in Sekunden */
  duration: number;
  /** Sample-Rate in Hz */
  sampleRate: number;
  /** Anzahl der Kanäle */
  channels: number;
  /** Bit-Tiefe (0 = unbekannt / komprimiert) */
  bitDepth: number;
  /** Dateigröße in Bytes */
  fileSize: number;
  /** Zeitstempel der Analyse (Unix-Millisekunden) */
  cachedAt: number;
}

// ─── LRU-Cache-Implementierung ────────────────────────────────────────────────

const MAX_CACHE_SIZE = 500;

export class WaveformCache {
  /** Geordnete Map: älteste Einträge zuerst (Map erhält Einfüge-Reihenfolge) */
  private cache: Map<string, CachedWaveform>;

  constructor() {
    this.cache = new Map();
  }

  /**
   * Gibt den gecachten Waveform-Datensatz zurück oder undefined.
   * Verschiebt den Eintrag ans Ende (LRU-Aktualisierung).
   */
  get(filePath: string): CachedWaveform | undefined {
    const entry = this.cache.get(filePath);
    if (!entry) return undefined;

    // LRU: Eintrag ans Ende verschieben
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);

    return entry;
  }

  /**
   * Speichert Waveform-Daten im Cache.
   * Entfernt älteste Einträge wenn MAX_CACHE_SIZE überschritten wird.
   */
  set(filePath: string, data: Omit<CachedWaveform, "cachedAt">): void {
    // Vorhandenen Eintrag entfernen (Position aktualisieren)
    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    }

    // Älteste Einträge entfernen wenn nötig
    while (this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(filePath, {
      ...data,
      cachedAt: Date.now(),
    });
  }

  /**
   * Entfernt einen einzelnen Eintrag aus dem Cache.
   * Nützlich wenn eine Datei geändert oder gelöscht wurde.
   */
  invalidate(filePath: string): boolean {
    return this.cache.delete(filePath);
  }

  /**
   * Entfernt alle Einträge die mit dem angegebenen Präfix beginnen.
   * Nützlich um einen ganzen Ordner zu invalidieren.
   */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Leert den gesamten Cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Gibt die aktuelle Anzahl der gecachten Einträge zurück.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Gibt alle gecachten Dateipfade zurück (neueste zuerst).
   */
  keys(): string[] {
    return Array.from(this.cache.keys()).reverse();
  }

  /**
   * Prüft ob ein Eintrag im Cache vorhanden ist.
   */
  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /**
   * Gibt Cache-Statistiken zurück (für Debugging).
   */
  stats(): { size: number; maxSize: number; oldestEntry: string | null; newestEntry: string | null } {
    const keys = Array.from(this.cache.keys());
    return {
      size: this.cache.size,
      maxSize: MAX_CACHE_SIZE,
      oldestEntry: keys[0] ?? null,
      newestEntry: keys[keys.length - 1] ?? null,
    };
  }
}

// ─── Singleton-Export ─────────────────────────────────────────────────────────

/** Globale Cache-Instanz – wird im Main-Prozess verwendet */
export const waveformCache = new WaveformCache();
