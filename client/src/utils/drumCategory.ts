/**
 * Synthstudio – drumCategory.ts (v3.269)
 *
 * Pure-Helper: leitet aus einem Part-/Sample-Namen eine grobe Drum-Kategorie
 * ab (für Auto-Mix-Target-Lookup u.ä.). Heuristik über Keyword-Matching —
 * kein DOM, kein State, deterministisch (Node-testbar).
 *
 * Die Kategorien spiegeln `DrumCategoryLike` aus useAutoMixStore.
 */
export type DrumCategory =
  | "kick" | "snare" | "hihat-closed" | "hihat-open" | "clap" | "cymbal"
  | "perc" | "loop" | "bass" | "synth" | "vocal" | "fx" | "unknown";

/**
 * Geordnete Regelliste: erstes Match gewinnt. Reihenfolge ist relevant —
 * spezifischere/eindeutigere Begriffe stehen vor generischeren (z.B. "open hat"
 * vor "hat", "sub bass" vor "bass").
 */
const RULES: ReadonlyArray<readonly [DrumCategory, readonly string[]]> = [
  ["hihat-open",   ["openhat", "open hat", "open-hat", "ohat", " oh", "hatopen"]],
  ["hihat-closed", ["closedhat", "closed hat", "hihat", "hi-hat", "chat", " hh", "hat"]],
  ["kick",         ["kick", "bassdrum", "bass drum", " bd", "kik", "808"]],
  ["snare",        ["snare", "snr", " sd", "rimshot", "rim"]],
  ["clap",         ["clap", "clp", "handclap"]],
  ["cymbal",       ["crash", "ride", "cymbal", "splash"]],
  ["perc",         ["perc", "conga", "bongo", "tom", "shaker", "tamb", "cowbell", "block"]],
  ["bass",         ["sub", "bass", "808bass"]],
  ["vocal",        ["vocal", "vox", " voc", "voice", "acapella", "chant"]],
  ["fx",           ["fx", "sweep", "riser", "downlifter", "uplifter", "noise", "impact", "atmos"]],
  ["loop",         ["loop", "break", "groove"]],
  ["synth",        ["synth", "lead", "pad", "pluck", "stab", "chord", "key", "arp", "saw", "wavetable"]],
];

/**
 * Liefert die wahrscheinlichste Drum-Kategorie für einen Namen, sonst "unknown".
 * Case-insensitive; mit führendem/folgendem Whitespace gepolstert, damit
 * Wortgrenzen-Tokens wie " hh" / " oh" sauber matchen.
 */
export function categorizeDrumName(name: string | null | undefined): DrumCategory {
  if (!name || typeof name !== "string") return "unknown";
  const hay = ` ${name.toLowerCase().trim()} `;
  for (const [category, keywords] of RULES) {
    for (const kw of keywords) {
      if (hay.includes(kw)) return category;
    }
  }
  return "unknown";
}
