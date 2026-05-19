/**
 * Synthstudio – Sample Classifier (v3.106.0)
 *
 * Pure-Helpers für Sample-Pack-Browser:
 *  - classifyByFilename: Heuristisch (Regex / Keyword-Liste) eine Sample-Kategorie ableiten.
 *  - extractTags: Tags aus parent-folder + filename ableiten.
 *  - extractBpm: BPM-Hint aus Filename parsen.
 *
 * Alle Funktionen sind pure, deterministisch, side-effect-frei.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export const SAMPLE_CATEGORIES = [
  "kick",
  "snare",
  "hihat-closed",
  "hihat-open",
  "clap",
  "cymbal",
  "perc",
  "loop",
  "bass",
  "synth",
  "vocal",
  "fx",
  "unknown",
] as const;

export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];

// ─── Klassifizierung ─────────────────────────────────────────────────────────

interface CategoryRule {
  category: SampleCategory;
  patterns: RegExp[];
}

/**
 * Reihenfolge ist signifikant — spezifischere Kategorien zuerst.
 * z.B. "hihat-open" vor "hihat-closed", weil "open" expliziter ist.
 */
const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "hihat-open",
    patterns: [
      /\b(open[\s_-]?hat|oh|ohh|hihat[\s_-]?open|hh[\s_-]?open|open[\s_-]?hh)\b/i,
    ],
  },
  {
    category: "hihat-closed",
    patterns: [
      /\b(closed[\s_-]?hat|ch|chh|hihat[\s_-]?closed|hh[\s_-]?closed|closed[\s_-]?hh)\b/i,
      /\b(hihat|hi[\s_-]?hat|hh)\b/i,
    ],
  },
  {
    category: "clap",
    patterns: [/\b(clap|cp|hand[\s_-]?clap|claps)\b/i],
  },
  {
    category: "cymbal",
    patterns: [/\b(cymbal|crash|ride|splash|china)\b/i],
  },
  {
    category: "kick",
    patterns: [
      /\b(kick|bd|bass[\s_-]?drum|kik|808)\b/i,
    ],
  },
  {
    category: "snare",
    patterns: [/\b(snare|sd|snr|rim[\s_-]?shot|rimshot)\b/i],
  },
  {
    category: "perc",
    patterns: [
      /\b(perc|percussion|conga|bongo|tom|shaker|tamb|tambourine|cowbell|woodblock|clave|triangle)\b/i,
    ],
  },
  {
    category: "loop",
    patterns: [/\b(loop|loops|lp|breakbeat|break|groove)\b/i],
  },
  {
    category: "bass",
    patterns: [/\b(bass|sub[\s_-]?bass|reese|wobble|bassline)\b/i],
  },
  {
    category: "vocal",
    patterns: [
      /\b(vox|vocal|vocals|voice|acapella|adlib|ad[\s_-]?lib|chant)\b/i,
    ],
  },
  {
    category: "fx",
    patterns: [
      /\b(fx|sfx|riser|impact|sweep|whoosh|drone|atmos|texture|noise|downlifter|uplifter|reverse)\b/i,
    ],
  },
  {
    category: "synth",
    patterns: [
      /\b(synth|lead|pad|pluck|arp|chord|stab|key|keys|piano)\b/i,
    ],
  },
];

/**
 * Klassifiziert ein Sample anhand seines Filenamens.
 * Gibt "unknown" zurück wenn keine Regel matcht.
 *
 * Robust gegen:
 *  - Pfade (extrahiert Basename)
 *  - Underscores/Bindestriche zwischen Keywords
 *  - Case-Insensitiv
 *
 * Hinweis: Wir normalisieren _, -, . und / zu Spaces VOR der Regex,
 * damit `\b` zuverlässig matcht (in JS-Regex ist _ ein word-char).
 */
export function classifyByFilename(filename: string): SampleCategory {
  if (typeof filename !== "string" || filename.length === 0) return "unknown";
  // Basename extrahieren (letzter Teil nach / oder \)
  const base = filename.split(/[/\\]/).pop() ?? filename;
  // Extension entfernen
  const noExt = base.replace(/\.[a-zA-Z0-9]+$/, "");
  // Normalisierung: alle Trennzeichen → Space, damit \b funktioniert
  const haystack = noExt.replace(/[_\-.]+/g, " ").trim();

  for (const rule of CATEGORY_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(haystack)) return rule.category;
    }
  }
  return "unknown";
}

// ─── Tag-Extraction ──────────────────────────────────────────────────────────

const TAG_STOPWORDS = new Set<string>([
  "wav", "mp3", "flac", "ogg", "aif", "aiff",
  "a", "an", "the", "of", "in", "to", "by", "for",
  "sample", "samples", "pack", "packs", "vol", "volume",
]);

const TAG_KEEPWORDS = [
  // Genres / Styles
  "trap", "hiphop", "hip-hop", "house", "techno", "dubstep", "drumandbass", "dnb",
  "lofi", "lo-fi", "ambient", "rnb", "r&b", "jazz", "funk", "soul", "rock", "pop",
  "drill", "edm", "future", "retro", "vintage", "modern", "minimal", "deep",
  // Production tags
  "808", "909", "707", "606", "303", "tr8", "tr-8",
  "dry", "wet", "tight", "punchy", "boomy", "deep", "warm", "bright", "dark",
  "analog", "digital", "vinyl", "tape", "saturated",
  "long", "short", "tail", "oneshot", "one-shot",
  // Drum types as tags
  "kick", "snare", "hihat", "clap", "perc", "tom", "ride", "crash", "cymbal",
  "bass", "lead", "pad", "synth", "vox", "vocal", "fx",
];

function _normalizeTagToken(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t.length === 0) return null;
  if (t.length > 24) return null;
  if (/^\d+$/.test(t) && t.length > 4) return null; // pure long numbers skip (counter)
  if (TAG_STOPWORDS.has(t)) return null;
  return t;
}

/**
 * Extrahiert Tags aus Filename + Parent-Folder.
 *
 * Quellen:
 *  - parentFolder gesplittet auf /,\,_,-,space → jedes Wort kann Tag werden
 *  - filename ohne extension → gesplittet wie oben
 *  - Geknappte Liste: 808, snare-suffixes, etc.
 *  - dedupliziert, sortiert nach Auftreten
 *
 * Filtert:
 *  - Stopwords (wav, mp3, vol, ...)
 *  - Pure Counter-Strings (>4 ziffern oder mehr)
 */
export function extractTags(filename: string, parentFolder: string = ""): string[] {
  const found = new Set<string>();
  const out: string[] = [];

  const addToken = (raw: string) => {
    const n = _normalizeTagToken(raw);
    if (n === null) return;
    if (found.has(n)) return;
    // Akzeptiere nur Tokens, die entweder in KEEPWORDS sind ODER
    // alpha-numerisch mit min 3 chars sind.
    const isKeep = TAG_KEEPWORDS.includes(n);
    const isAlphaShort = /^[a-z0-9]{3,}$/.test(n);
    if (!isKeep && !isAlphaShort) return;
    found.add(n);
    out.push(n);
  };

  const splitWords = (s: string): string[] => {
    return s
      .split(/[\\\/_\-\s]+/)
      .map((w) => w.replace(/\.[a-zA-Z0-9]+$/, ""))
      .filter((w) => w.length > 0);
  };

  // Parent-folder tokens first (more general → more important context)
  if (typeof parentFolder === "string" && parentFolder.length > 0) {
    for (const word of splitWords(parentFolder)) {
      addToken(word);
    }
  }

  // Filename tokens
  if (typeof filename === "string" && filename.length > 0) {
    const base = filename.split(/[/\\]/).pop() ?? filename;
    for (const word of splitWords(base)) {
      addToken(word);
    }
  }

  return out;
}

// ─── BPM-Extraction ──────────────────────────────────────────────────────────

/**
 * Extrahiert BPM-Hint aus Filename.
 * Pattern: "120bpm", "120 bpm", "120-bpm", "120_BPM", "bpm120", "bpm_120".
 * Range-Check: 40..300 (außerhalb → null).
 *
 * Liefert null wenn nichts gefunden wird.
 */
export function extractBpm(filename: string): number | null {
  if (typeof filename !== "string" || filename.length === 0) return null;
  const base = filename.split(/[/\\]/).pop() ?? filename;

  // Versuch 1: <num>bpm
  const m1 = base.match(/(\d{2,3})\s*[_\-\s]?\s*bpm/i);
  if (m1) {
    const bpm = parseInt(m1[1], 10);
    if (bpm >= 40 && bpm <= 300) return bpm;
  }
  // Versuch 2: bpm<num>
  const m2 = base.match(/bpm\s*[_\-\s]?\s*(\d{2,3})/i);
  if (m2) {
    const bpm = parseInt(m2[1], 10);
    if (bpm >= 40 && bpm <= 300) return bpm;
  }

  return null;
}

// ─── Audio-Extension-Check ───────────────────────────────────────────────────

export const AUDIO_EXTENSIONS = [
  ".wav", ".mp3", ".flac", ".ogg", ".aif", ".aiff", ".m4a",
] as const;

export function isAudioFilename(filename: string): boolean {
  if (typeof filename !== "string") return false;
  const lower = filename.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
