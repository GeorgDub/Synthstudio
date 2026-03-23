"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.waveformCache = exports.WaveformCache = void 0;
// ─── LRU-Cache-Implementierung ────────────────────────────────────────────────
const MAX_CACHE_SIZE = 500;
class WaveformCache {
    constructor() {
        this.cache = new Map();
    }
    /**
     * Gibt den gecachten Waveform-Datensatz zurück oder undefined.
     * Verschiebt den Eintrag ans Ende (LRU-Aktualisierung).
     */
    get(filePath) {
        const entry = this.cache.get(filePath);
        if (!entry)
            return undefined;
        // LRU: Eintrag ans Ende verschieben
        this.cache.delete(filePath);
        this.cache.set(filePath, entry);
        return entry;
    }
    /**
     * Speichert Waveform-Daten im Cache.
     * Entfernt älteste Einträge wenn MAX_CACHE_SIZE überschritten wird.
     */
    set(filePath, data) {
        // Vorhandenen Eintrag entfernen (Position aktualisieren)
        if (this.cache.has(filePath)) {
            this.cache.delete(filePath);
        }
        // Älteste Einträge entfernen wenn nötig
        while (this.cache.size >= MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey)
                this.cache.delete(oldestKey);
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
    invalidate(filePath) {
        return this.cache.delete(filePath);
    }
    /**
     * Entfernt alle Einträge die mit dem angegebenen Präfix beginnen.
     * Nützlich um einen ganzen Ordner zu invalidieren.
     */
    invalidatePrefix(prefix) {
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
    clear() {
        this.cache.clear();
    }
    /**
     * Gibt die aktuelle Anzahl der gecachten Einträge zurück.
     */
    size() {
        return this.cache.size;
    }
    /**
     * Gibt alle gecachten Dateipfade zurück (neueste zuerst).
     */
    keys() {
        return Array.from(this.cache.keys()).reverse();
    }
    /**
     * Prüft ob ein Eintrag im Cache vorhanden ist.
     */
    has(filePath) {
        return this.cache.has(filePath);
    }
    /**
     * Gibt Cache-Statistiken zurück (für Debugging).
     */
    stats() {
        const keys = Array.from(this.cache.keys());
        return {
            size: this.cache.size,
            maxSize: MAX_CACHE_SIZE,
            oldestEntry: keys[0] ?? null,
            newestEntry: keys[keys.length - 1] ?? null,
        };
    }
}
exports.WaveformCache = WaveformCache;
// ─── Singleton-Export ─────────────────────────────────────────────────────────
/** Globale Cache-Instanz – wird im Main-Prozess verwendet */
exports.waveformCache = new WaveformCache();
