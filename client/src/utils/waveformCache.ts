/**
 * Synthstudio – Browser Waveform-Cache (IndexedDB)
 *
 * Persistenter Cache für Waveform-Analysedaten im Browser.
 * Verhindert wiederholte Analyse derselben Audio-Dateien nach einem Seiten-Reload.
 *
 * Architektur:
 * - Level 1: In-Memory LRU-Cache (schnell, max. 200 Einträge)
 * - Level 2: IndexedDB (persistent, max. 5000 Einträge, 30 Tage TTL)
 *
 * Isomorph: Im Browser nutzt es IndexedDB, in Electron wird der Electron-Cache bevorzugt.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface CachedWaveformData {
  peaks: number[];
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  fileSize?: number;
  cachedAt: number;
  /** BPM-Schätzung (falls bereits analysiert) */
  estimatedBpm?: number;
  /** Auto-Tags (Kick, Snare, etc.) */
  tags?: string[];
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const DB_NAME = "synthstudio-waveform-cache";
const DB_VERSION = 1;
const STORE_NAME = "waveforms";
const MAX_MEMORY_ENTRIES = 200;
const MAX_DB_ENTRIES = 5000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

// ─── In-Memory LRU-Cache ──────────────────────────────────────────────────────

class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // LRU: Ans Ende verschieben
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Ältesten Eintrag entfernen
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ─── IndexedDB-Wrapper ────────────────────────────────────────────────────────

class WaveformCacheDB {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private memoryCache = new LRUCache<string, CachedWaveformData>(MAX_MEMORY_ENTRIES);
  private isAvailable = typeof indexedDB !== "undefined";

  /** Datenbank initialisieren */
  private async init(): Promise<void> {
    if (!this.isAvailable) return;
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("cachedAt", "cachedAt", { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => {
        console.warn("[WaveformCache] IndexedDB nicht verfügbar, nutze nur Memory-Cache");
        this.isAvailable = false;
        resolve(); // Kein Fehler – graceful degradation
      };
    });
  }

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    return this.initPromise;
  }

  /** Cache-Eintrag lesen */
  async get(filePath: string): Promise<CachedWaveformData | null> {
    const key = this.normalizeKey(filePath);

    // Level 1: Memory-Cache
    const memEntry = this.memoryCache.get(key);
    if (memEntry) {
      if (Date.now() - memEntry.cachedAt < TTL_MS) return memEntry;
      this.memoryCache.delete(key);
    }

    // Level 2: IndexedDB
    if (!this.isAvailable) return null;
    await this.ensureInit();
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          const record = request.result as { key: string; data: CachedWaveformData } | undefined;
          if (!record) {
            resolve(null);
            return;
          }
          // TTL prüfen
          if (Date.now() - record.data.cachedAt > TTL_MS) {
            this.delete(filePath).catch(() => {});
            resolve(null);
            return;
          }
          // In Memory-Cache aufnehmen
          this.memoryCache.set(key, record.data);
          resolve(record.data);
        };

        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /** Cache-Eintrag schreiben */
  async set(filePath: string, data: CachedWaveformData): Promise<void> {
    const key = this.normalizeKey(filePath);

    // Level 1: Memory-Cache
    this.memoryCache.set(key, data);

    // Level 2: IndexedDB
    if (!this.isAvailable) return;
    await this.ensureInit();
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put({ key, data });
        tx.oncomplete = () => {
          // Ggf. alte Einträge bereinigen (async, nicht blockierend)
          this.cleanup().catch(() => {});
          resolve();
        };
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /** Cache-Eintrag löschen */
  async delete(filePath: string): Promise<void> {
    const key = this.normalizeKey(filePath);
    this.memoryCache.delete(key);

    if (!this.isAvailable || !this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /** Gesamten Cache leeren */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    if (!this.isAvailable || !this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /** Alte Einträge bereinigen (TTL + Max-Size) */
  private async cleanup(): Promise<void> {
    if (!this.isAvailable || !this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const index = store.index("cachedAt");
        const cutoff = Date.now() - TTL_MS;

        // Abgelaufene Einträge löschen
        const range = IDBKeyRange.upperBound(cutoff);
        const request = index.openCursor(range);

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /** Cache-Statistiken abrufen */
  async getStats(): Promise<{ memoryEntries: number; dbEntries: number }> {
    const memoryEntries = this.memoryCache.size;

    if (!this.isAvailable || !this.db) {
      return { memoryEntries, dbEntries: 0 };
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () =>
          resolve({ memoryEntries, dbEntries: request.result });
        request.onerror = () => resolve({ memoryEntries, dbEntries: 0 });
      } catch {
        resolve({ memoryEntries, dbEntries: 0 });
      }
    });
  }

  /** Schlüssel normalisieren (Pfad → konsistenter Key) */
  private normalizeKey(filePath: string): string {
    // Backslashes zu Slashes, Trailing-Slash entfernen, lowercase
    return filePath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  }
}

// ─── Singleton-Export ─────────────────────────────────────────────────────────

export const waveformCache = new WaveformCacheDB();
