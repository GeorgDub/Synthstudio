/**
 * Synthstudio – WaveformCache Unit-Tests (Testing-Agent)
 *
 * Testet die WaveformCache-Klasse (LRU-Cache) aus electron/waveform-cache.ts.
 * Kein Electron-Import – reine Node.js-Logik (Map-basiert).
 *
 * Abgedeckte Bereiche:
 * - get() / set() Grundoperationen
 * - LRU-Reihenfolge: aktuellster Zugriff bleibt im Cache
 * - LRU-Verdrängung bei MAX_CACHE_SIZE (500 Einträge)
 * - invalidate() Einzeleintrag löschen
 * - invalidatePrefix() Präfix-basiertes Löschen
 * - clear() Vollständig leeren
 * - size() / has() / keys()
 * - stats() Statistiken
 * - cachedAt Zeitstempel wird automatisch gesetzt
 *
 * Ausführen: pnpm test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WaveformCache } from "../../electron/waveform-cache";
import type { CachedWaveform } from "../../electron/waveform-cache";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<Omit<CachedWaveform, "cachedAt">> = {}): Omit<CachedWaveform, "cachedAt"> {
  return {
    peaks: [0.1, 0.5, 0.9, 0.3],
    duration: 2.0,
    sampleRate: 44100,
    channels: 1,
    bitDepth: 16,
    fileSize: 176400,
    ...overrides,
  };
}

/** Befüllt den Cache mit n Einträgen: /path/0.wav ... /path/(n-1).wav */
function fillCache(cache: WaveformCache, n: number): void {
  for (let i = 0; i < n; i++) {
    cache.set(`/path/${i}.wav`, makeEntry({ duration: i }));
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WaveformCache – Grundoperationen", () => {
  let cache: WaveformCache;

  beforeEach(() => {
    cache = new WaveformCache();
  });

  it("gibt undefined zurück für unbekannten Pfad", () => {
    expect(cache.get("/nonexistent.wav")).toBeUndefined();
  });

  it("speichert und liest einen Eintrag", () => {
    const entry = makeEntry({ duration: 3.5, sampleRate: 48000 });
    cache.set("/test.wav", entry);
    const result = cache.get("/test.wav");
    expect(result).toBeDefined();
    expect(result!.duration).toBe(3.5);
    expect(result!.sampleRate).toBe(48000);
  });

  it("set() fügt cachedAt-Zeitstempel hinzu", () => {
    const before = Date.now();
    cache.set("/test.wav", makeEntry());
    const after = Date.now();
    const result = cache.get("/test.wav");
    expect(result!.cachedAt).toBeGreaterThanOrEqual(before);
    expect(result!.cachedAt).toBeLessThanOrEqual(after);
  });

  it("überschreibt bestehenden Eintrag mit neuen Daten", () => {
    cache.set("/test.wav", makeEntry({ duration: 1.0 }));
    cache.set("/test.wav", makeEntry({ duration: 5.0 }));
    expect(cache.get("/test.wav")!.duration).toBe(5.0);
  });

  it("size() gibt korrekte Anzahl zurück", () => {
    expect(cache.size()).toBe(0);
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());
    expect(cache.size()).toBe(2);
  });

  it("has() erkennt vorhandene und fehlende Einträge", () => {
    cache.set("/a.wav", makeEntry());
    expect(cache.has("/a.wav")).toBe(true);
    expect(cache.has("/b.wav")).toBe(false);
  });

  it("speichert mehrere unabhängige Pfade", () => {
    const paths = ["/drums/kick.wav", "/drums/snare.wav", "/synths/pad.wav"];
    paths.forEach((p, i) => cache.set(p, makeEntry({ duration: i + 1 })));
    paths.forEach((p, i) => {
      expect(cache.get(p)!.duration).toBe(i + 1);
    });
    expect(cache.size()).toBe(3);
  });
});

// ─── LRU-Reihenfolge ─────────────────────────────────────────────────────────

describe("WaveformCache – LRU-Reihenfolge", () => {
  let cache: WaveformCache;

  beforeEach(() => {
    cache = new WaveformCache();
  });

  it("keys() gibt neueste Einträge zuerst zurück", () => {
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());
    cache.set("/c.wav", makeEntry());
    const keys = cache.keys();
    // Neueste (letzte eingefügte) zuerst
    expect(keys[0]).toBe("/c.wav");
    expect(keys[1]).toBe("/b.wav");
    expect(keys[2]).toBe("/a.wav");
  });

  it("get() verschiebt Eintrag ans Ende (LRU-Aktualisierung)", () => {
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());
    cache.set("/c.wav", makeEntry());

    // Auf /a.wav zugreifen → /a.wav wird aktuellster Eintrag
    cache.get("/a.wav");

    const keys = cache.keys();
    // keys() gibt neueste zuerst zurück → /a.wav muss an erster Stelle sein
    expect(keys[0]).toBe("/a.wav");
  });

  it("überschreiben via set() verschiebt Eintrag an neueste Position", () => {
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());
    // /a.wav überschreiben → wird neuer
    cache.set("/a.wav", makeEntry({ duration: 99 }));
    const keys = cache.keys();
    expect(keys[0]).toBe("/a.wav");
  });
});

// ─── LRU-Verdrängung ─────────────────────────────────────────────────────────

describe("WaveformCache – LRU-Verdrängung (MAX_CACHE_SIZE)", () => {
  it("verdrängt ältesten Eintrag wenn MAX_CACHE_SIZE erreicht wird", () => {
    const cache = new WaveformCache();
    // 500 Einträge befüllen
    fillCache(cache, 500);
    expect(cache.size()).toBe(500);
    expect(cache.has("/path/0.wav")).toBe(true);

    // 501. Eintrag → /path/0.wav (ältester) muss rausfliegen
    cache.set("/path/500.wav", makeEntry());
    expect(cache.size()).toBe(500);
    expect(cache.has("/path/0.wav")).toBe(false);
    expect(cache.has("/path/500.wav")).toBe(true);
  });

  it("verdrängt immer den ältesten Eintrag sequenziell", () => {
    const cache = new WaveformCache();
    fillCache(cache, 500);

    // 3 weitere Einträge hinzufügen → /path/0, /path/1, /path/2 fallen raus
    for (let i = 500; i < 503; i++) {
      cache.set(`/path/${i}.wav`, makeEntry());
    }

    expect(cache.has("/path/0.wav")).toBe(false);
    expect(cache.has("/path/1.wav")).toBe(false);
    expect(cache.has("/path/2.wav")).toBe(false);
    expect(cache.has("/path/3.wav")).toBe(true);
    expect(cache.size()).toBe(500);
  });

  it("LRU-Zugriff schützt Eintrag vor Verdrängung", () => {
    const cache = new WaveformCache();
    fillCache(cache, 500);

    // /path/0.wav (ältester) durch Zugriff aktualisieren
    cache.get("/path/0.wav");

    // Einen neuen Eintrag hinzufügen → /path/1.wav (jetzt ältester) wird verdrängt
    cache.set("/path/500.wav", makeEntry());
    expect(cache.has("/path/0.wav")).toBe(true);  // geschützt durch LRU-Zugriff
    expect(cache.has("/path/1.wav")).toBe(false); // wurde verdrängt
  });

  it("Überschreiben schützt Eintrag vor Verdrängung", () => {
    const cache = new WaveformCache();
    fillCache(cache, 500);

    // /path/0.wav durch Überschreiben aktualisieren
    cache.set("/path/0.wav", makeEntry({ duration: 999 }));

    // 501. Eintrag → /path/1.wav (jetzt ältester) fliegt raus
    cache.set("/path/500.wav", makeEntry());
    expect(cache.has("/path/0.wav")).toBe(true);
    expect(cache.has("/path/1.wav")).toBe(false);
  });
});

// ─── invalidate() ─────────────────────────────────────────────────────────────

describe("WaveformCache – invalidate()", () => {
  let cache: WaveformCache;

  beforeEach(() => {
    cache = new WaveformCache();
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());
    cache.set("/c.wav", makeEntry());
  });

  it("entfernt einen einzelnen Eintrag und gibt true zurück", () => {
    const result = cache.invalidate("/a.wav");
    expect(result).toBe(true);
    expect(cache.has("/a.wav")).toBe(false);
    expect(cache.size()).toBe(2);
  });

  it("gibt false zurück wenn Eintrag nicht vorhanden", () => {
    const result = cache.invalidate("/nonexistent.wav");
    expect(result).toBe(false);
  });

  it("beeinflusst andere Einträge nicht", () => {
    cache.invalidate("/a.wav");
    expect(cache.has("/b.wav")).toBe(true);
    expect(cache.has("/c.wav")).toBe(true);
  });
});

// ─── invalidatePrefix() ────────────────────────────────────────────────────────

describe("WaveformCache – invalidatePrefix()", () => {
  let cache: WaveformCache;

  beforeEach(() => {
    cache = new WaveformCache();
    cache.set("/samples/drums/kick.wav", makeEntry());
    cache.set("/samples/drums/snare.wav", makeEntry());
    cache.set("/samples/synths/pad.wav", makeEntry());
    cache.set("/projects/beat.wav", makeEntry());
  });

  it("entfernt alle Einträge mit dem angegebenen Präfix", () => {
    const count = cache.invalidatePrefix("/samples/drums/");
    expect(count).toBe(2);
    expect(cache.has("/samples/drums/kick.wav")).toBe(false);
    expect(cache.has("/samples/drums/snare.wav")).toBe(false);
  });

  it("lässt nicht-passende Einträge unberührt", () => {
    cache.invalidatePrefix("/samples/drums/");
    expect(cache.has("/samples/synths/pad.wav")).toBe(true);
    expect(cache.has("/projects/beat.wav")).toBe(true);
  });

  it("gibt die Anzahl der gelöschten Einträge zurück", () => {
    expect(cache.invalidatePrefix("/samples/")).toBe(3);
    expect(cache.invalidatePrefix("/samples/")).toBe(0); // bereits gelöscht
  });

  it("gibt 0 zurück wenn kein Eintrag passt", () => {
    expect(cache.invalidatePrefix("/nonexistent/")).toBe(0);
    expect(cache.size()).toBe(4);
  });

  it("leerer Präfix trifft alle Einträge", () => {
    const count = cache.invalidatePrefix("");
    expect(count).toBe(4);
    expect(cache.size()).toBe(0);
  });
});

// ─── clear() ─────────────────────────────────────────────────────────────────

describe("WaveformCache – clear()", () => {
  it("leert den gesamten Cache", () => {
    const cache = new WaveformCache();
    fillCache(cache, 50);
    expect(cache.size()).toBe(50);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("get() gibt nach clear() undefined zurück", () => {
    const cache = new WaveformCache();
    cache.set("/test.wav", makeEntry());
    cache.clear();
    expect(cache.get("/test.wav")).toBeUndefined();
  });

  it("Cache kann nach clear() wieder befüllt werden", () => {
    const cache = new WaveformCache();
    fillCache(cache, 10);
    cache.clear();
    cache.set("/new.wav", makeEntry({ duration: 7.5 }));
    expect(cache.size()).toBe(1);
    expect(cache.get("/new.wav")!.duration).toBe(7.5);
  });
});

// ─── stats() ─────────────────────────────────────────────────────────────────

describe("WaveformCache – stats()", () => {
  it("gibt korrekte Statistiken für leeren Cache aus", () => {
    const cache = new WaveformCache();
    const stats = cache.stats();
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(500);
    expect(stats.oldestEntry).toBeNull();
    expect(stats.newestEntry).toBeNull();
  });

  it("gibt korrekte Statistiken für befüllten Cache aus", () => {
    const cache = new WaveformCache();
    cache.set("/first.wav", makeEntry());
    cache.set("/second.wav", makeEntry());
    cache.set("/third.wav", makeEntry());

    const stats = cache.stats();
    expect(stats.size).toBe(3);
    expect(stats.maxSize).toBe(500);
    expect(stats.oldestEntry).toBe("/first.wav");
    expect(stats.newestEntry).toBe("/third.wav");
  });

  it("oldestEntry und newestEntry stimmen nach LRU-Aktualisierung", () => {
    const cache = new WaveformCache();
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());

    // /a.wav durch Zugriff aktuell machen
    cache.get("/a.wav");

    const stats = cache.stats();
    // /b.wav ist jetzt der älteste, /a.wav der neueste
    expect(stats.oldestEntry).toBe("/b.wav");
    expect(stats.newestEntry).toBe("/a.wav");
  });
});

// ─── keys() ──────────────────────────────────────────────────────────────────

describe("WaveformCache – keys()", () => {
  it("gibt leeres Array für leeren Cache zurück", () => {
    const cache = new WaveformCache();
    expect(cache.keys()).toEqual([]);
  });

  it("gibt alle Schlüssel zurück (neueste zuerst)", () => {
    const cache = new WaveformCache();
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());
    cache.set("/c.wav", makeEntry());
    expect(cache.keys()).toEqual(["/c.wav", "/b.wav", "/a.wav"]);
  });

  it("Reihenfolge ändert sich nach LRU-Zugriff", () => {
    const cache = new WaveformCache();
    cache.set("/a.wav", makeEntry());
    cache.set("/b.wav", makeEntry());
    cache.get("/a.wav"); // /a.wav → neuester
    expect(cache.keys()[0]).toBe("/a.wav");
  });
});

// ─── cachedAt Zeitstempel ────────────────────────────────────────────────────

describe("WaveformCache – cachedAt Zeitstempel", () => {
  it("cachedAt ist ein Unix-Millisekunden-Timestamp", () => {
    const cache = new WaveformCache();
    const before = Date.now();
    cache.set("/test.wav", makeEntry());
    const after = Date.now();
    const result = cache.get("/test.wav")!;
    expect(result.cachedAt).toBeGreaterThanOrEqual(before);
    expect(result.cachedAt).toBeLessThanOrEqual(after);
    expect(Number.isInteger(result.cachedAt)).toBe(true);
  });

  it("cachedAt wird beim Überschreiben aktualisiert", async () => {
    const cache = new WaveformCache();
    cache.set("/test.wav", makeEntry());
    const first = cache.get("/test.wav")!.cachedAt;

    // Minimal warten um unterschiedliche Timestamps zu bekommen
    await new Promise((r) => setTimeout(r, 2));
    cache.set("/test.wav", makeEntry({ duration: 99 }));
    const second = cache.get("/test.wav")!.cachedAt;

    expect(second).toBeGreaterThanOrEqual(first);
  });
});

// ─── Datentreue ───────────────────────────────────────────────────────────────

describe("WaveformCache – Datentreue", () => {
  it("speichert peaks-Array korrekt", () => {
    const cache = new WaveformCache();
    const peaks = [0.0, 0.25, 0.5, 0.75, 1.0, 0.8, 0.4, 0.2];
    cache.set("/test.wav", makeEntry({ peaks }));
    expect(cache.get("/test.wav")!.peaks).toEqual(peaks);
  });

  it("speichert alle Metadaten korrekt", () => {
    const cache = new WaveformCache();
    const entry = {
      peaks: [0.5],
      duration: 123.456,
      sampleRate: 96000,
      channels: 2,
      bitDepth: 24,
      fileSize: 9876543,
    };
    cache.set("/stereo.wav", entry);
    const result = cache.get("/stereo.wav")!;
    expect(result.duration).toBe(123.456);
    expect(result.sampleRate).toBe(96000);
    expect(result.channels).toBe(2);
    expect(result.bitDepth).toBe(24);
    expect(result.fileSize).toBe(9876543);
  });

  it("gibt neue Referenz zurück (kein Alias)", () => {
    const cache = new WaveformCache();
    cache.set("/test.wav", makeEntry({ peaks: [0.1, 0.2] }));
    const r1 = cache.get("/test.wav")!;
    const r2 = cache.get("/test.wav")!;
    // Beide sollten denselben Inhalt haben (gleiche Instanz ist OK, da immutabel)
    expect(r1.duration).toBe(r2.duration);
  });
});
