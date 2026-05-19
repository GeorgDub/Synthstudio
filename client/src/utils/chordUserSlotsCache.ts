/**
 * chordUserSlotsCache.ts — Sprint-97-Begleitung.
 *
 * localStorage-Cache fuer die 4 Chord-User-Slots. Bridge-Roundtrip ist
 * device-abhaengig (Sprint-96 Reverse-Channel) — diese Cache bewahrt das
 * UI-State zwischen Sessions, so dass User-Editier-Arbeit nicht verloren
 * geht wenn das Geraet abgesteckt wird.
 *
 * Schema:
 *   key: "omnitribe.chordUserSlots.v1"
 *   value: { slots: Array<{ slotId: 11..14, csv: string }>, savedAt: epoch_ms }
 *
 * Versionsfeld (v1) erlaubt zukuenftige Migration ohne abruptes Wegwerfen
 * der Daten. Bei Schema-Mismatch wird der Cache ignoriert und neue Defaults
 * uebernommen.
 */

const CACHE_KEY = "omnitribe.chordUserSlots.v1";

export interface ChordUserSlotsCacheEntry {
  slots: Array<{ slotId: number; csv: string }>;
  savedAt: number;
}

export interface ChordUserSlotsMap {
  [slotId: number]: string;
}

const DEFAULT_USER_SLOTS: ChordUserSlotsMap = {
  11: "0,4,7",        // Major (User 1 default)
  12: "0,3,7",        // Minor
  13: "0,4,7,11",     // Maj7
  14: "0,5,7",        // Sus4
};

/**
 * Laed Cache aus localStorage. Bei Fehler (kein Storage, korruptes JSON,
 * Schema-Mismatch) werden defaults zurueckgegeben — UI hat immer einen
 * konsistenten Initial-State.
 */
export function loadChordUserSlotsCache(): ChordUserSlotsMap {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_USER_SLOTS };
  }
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...DEFAULT_USER_SLOTS };
    const parsed = JSON.parse(raw) as ChordUserSlotsCacheEntry;
    if (!parsed || !Array.isArray(parsed.slots)) {
      return { ...DEFAULT_USER_SLOTS };
    }
    const map: ChordUserSlotsMap = { ...DEFAULT_USER_SLOTS };
    for (const entry of parsed.slots) {
      if (typeof entry.slotId !== "number") continue;
      if (entry.slotId < 11 || entry.slotId > 14) continue;
      if (typeof entry.csv !== "string") continue;
      map[entry.slotId] = entry.csv;
    }
    return map;
  } catch {
    return { ...DEFAULT_USER_SLOTS };
  }
}

/**
 * Persistiert die aktuellen User-Slot-Definitionen.
 * Best-Effort — Fehler (Storage voll, QuotaExceeded) werden geschluckt,
 * UI-State bleibt unbeeinflusst.
 */
export function saveChordUserSlotsCache(slots: ChordUserSlotsMap): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const entry: ChordUserSlotsCacheEntry = {
      slots: Object.entries(slots)
        .map(([slotId, csv]) => ({ slotId: Number(slotId), csv }))
        .filter((e) => e.slotId >= 11 && e.slotId <= 14),
      savedAt: Date.now(),
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Quota voll, privat-mode, etc. — kein hard fail.
  }
}

/** Cache komplett loeschen (z.B. nach factory-reset oder logout). */
export function clearChordUserSlotsCache(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* swallow */
  }
}

/** Defaults (z.B. fuer Tests oder als Fallback). */
export function getDefaultChordUserSlots(): ChordUserSlotsMap {
  return { ...DEFAULT_USER_SLOTS };
}
