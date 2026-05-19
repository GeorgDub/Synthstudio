/**
 * patternCache.ts — Sprint-104/105/107 Step-Sequencer Persistence.
 *
 * Sprint-107: erweitert zu Pattern-Bank (8 Slots + activeSlot).
 *   Key v2: "synthstudio:omnitribe.patternBank.v2"
 * Forward-Compat: liest v1-Daten (key "synthstudio:omnitribe.pattern.v1")
 * und migriert in Slot 0 der v2-Bank — kein User-Data-Loss bei Update.
 */

const CACHE_KEY_V1 = "synthstudio:omnitribe.pattern.v1";
const CACHE_KEY_V2 = "synthstudio:omnitribe.patternBank.v2";
const BANK_SIZE = 8;

export const PATTERN_BANK_SIZE = BANK_SIZE;

export interface PatternState {
  steps: boolean[];          // 16 entries
  velocities: number[];      // 16 entries, 0..127
  pitchOffsets: number[];    // 16 entries, -64..+63
  bpm: number;               // 40..240
  root: number;              // 0..127
}

/** Sprint-108: ein Song-Schritt = welcher Bank-Slot + wie oft loopt er. */
export interface SongStep {
  slot: number;        // 0..BANK_SIZE-1
  repeats: number;     // 1..32
}

export interface PatternBank {
  patterns: PatternState[];   // BANK_SIZE entries
  activeSlot: number;          // 0..BANK_SIZE-1
  /** Sprint-108: Song-Mode. Wenn songMode=true und songSequence nicht leer
   * ist, advanced der Sequencer nach jedem Pattern-Loop-Wrap zum naechsten
   * SongStep (cyclic). */
  songMode: boolean;
  songSequence: SongStep[];
}

export function getDefaultPattern(): PatternState {
  return {
    steps: Array(16).fill(false),
    velocities: Array(16).fill(100),
    pitchOffsets: Array(16).fill(0),
    bpm: 120,
    root: 60,
  };
}

export function getDefaultBank(): PatternBank {
  return {
    patterns: Array.from({ length: BANK_SIZE }, () => getDefaultPattern()),
    activeSlot: 0,
    songMode: false,
    songSequence: [],
  };
}

function parseSongStep(raw: unknown): SongStep | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Partial<SongStep>;
  const slot = clampNum(s.slot, 0, BANK_SIZE - 1, -1);
  if (slot < 0) return null;
  const repeats = Math.floor(clampNum(s.repeats, 1, 32, 1));
  return { slot: Math.floor(slot), repeats };
}

// ─── Defensive Parsers ───────────────────────────────────

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function parsePattern(raw: unknown): PatternState {
  const def = getDefaultPattern();
  if (typeof raw !== "object" || raw === null) return def;
  const p = raw as Partial<PatternState>;
  return {
    steps: Array.isArray(p.steps) && p.steps.length === 16
      ? p.steps.map((s) => Boolean(s))
      : def.steps,
    velocities: Array.isArray(p.velocities) && p.velocities.length === 16
      ? p.velocities.map((v) => clampNum(v, 0, 127, 100))
      : def.velocities,
    pitchOffsets: Array.isArray(p.pitchOffsets) && p.pitchOffsets.length === 16
      ? p.pitchOffsets.map((v) => clampNum(v, -64, 63, 0))
      : def.pitchOffsets,
    bpm: clampNum(p.bpm, 40, 240, def.bpm),
    root: clampNum(p.root, 0, 127, def.root),
  };
}

// ─── Public API ──────────────────────────────────────────

/** Sprint-107: Load Bank. Migriert v1 → v2 falls vorhanden. */
export function loadPatternBank(): PatternBank {
  if (typeof window === "undefined" || !window.localStorage) {
    return getDefaultBank();
  }
  try {
    const rawV2 = window.localStorage.getItem(CACHE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<PatternBank>;
      const patterns = Array.isArray(parsed.patterns) && parsed.patterns.length === BANK_SIZE
        ? parsed.patterns.map(parsePattern)
        : getDefaultBank().patterns;
      const activeSlot = clampNum(parsed.activeSlot, 0, BANK_SIZE - 1, 0);
      // Sprint-108: Song-Mode optional (Forward-Compat)
      const songMode = typeof parsed.songMode === "boolean" ? parsed.songMode : false;
      const songSequence = Array.isArray(parsed.songSequence)
        ? (parsed.songSequence
            .map(parseSongStep)
            .filter((s): s is SongStep => s !== null))
        : [];
      return {
        patterns, activeSlot: Math.floor(activeSlot),
        songMode, songSequence,
      };
    }
    // v1-Migration
    const rawV1 = window.localStorage.getItem(CACHE_KEY_V1);
    if (rawV1) {
      const migrated = getDefaultBank();
      migrated.patterns[0] = parsePattern(JSON.parse(rawV1));
      // v1-Key behalten als Backup — kein dataloss falls Schema-bug
      savePatternBank(migrated);
      return migrated;
    }
    return getDefaultBank();
  } catch {
    return getDefaultBank();
  }
}

export function savePatternBank(bank: PatternBank): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(CACHE_KEY_V2, JSON.stringify(bank));
  } catch { /* */ }
}

export function clearPatternBank(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(CACHE_KEY_V2);
    window.localStorage.removeItem(CACHE_KEY_V1);
  } catch { /* */ }
}

// ─── Backward-Compat Layer (alte Tests + Code) ──────────

/** @deprecated Sprint-107: use loadPatternBank().patterns[activeSlot]. */
export function loadPatternCache(): PatternState {
  const bank = loadPatternBank();
  return bank.patterns[bank.activeSlot] ?? getDefaultPattern();
}

/** @deprecated Sprint-107: use savePatternBank. */
export function savePatternCache(p: PatternState): void {
  const bank = loadPatternBank();
  bank.patterns[bank.activeSlot] = p;
  savePatternBank(bank);
}

/** @deprecated Sprint-107: use clearPatternBank. */
export function clearPatternCache(): void {
  clearPatternBank();
}
