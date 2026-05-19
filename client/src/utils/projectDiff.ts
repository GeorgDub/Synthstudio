/**
 * Synthstudio – projectDiff.ts (v3.118.0)
 *
 * Pure, side-effect-freie Diff-Engine für .synth-Projekt-Files.
 *
 * Vergleicht zwei `SynthProject`-Objekte (aus `projectSerializer.ts`) feld-
 * weise und liefert einen strukturierten `ProjectDiff`, der von der UI
 * (Side-by-Side-View) und Markdown-Export konsumiert wird.
 *
 * Eigenschaften:
 *  - Pure: keine Module-Singletons, kein localStorage, kein fetch.
 *  - Defensive: tolerant gegen partiell-invalide Inputs (Defaults für
 *    fehlende Felder, `null` wird wie `undefined` behandelt).
 *  - Float-Vergleich mit epsilon-Toleranz (1e-4) — minimaler Re-Save-Drift
 *    durch FX-Param-Rundung soll NICHT als Diff durchschlagen.
 *  - Reference-stabile Outputs: `{added:[], removed:[], changed:[]}` immer,
 *    nie `undefined`. Konsumenten dürfen ohne null-Checks iterieren.
 *
 * Was wird NICHT gediff'd:
 *  - Embedded Slice-Pad-Buffer-Frames (Float32-Arrays mit ~Million Werten).
 *    Wir diff'en nur Slot-Metadata (sampleName, sliceIndex, sampleRate).
 *  - Frame-für-Frame-Vergleiche von Sample-Tag-Reihenfolgen.
 */

import type { SynthProject } from "./projectSerializer";
import type { Sample } from "@/store/useProjectStore";
import type { PatternData, PartData } from "@/audio/AudioEngine";

// ─── Diff-Typen ───────────────────────────────────────────────────────────────

/**
 * Eine einzelne Feld-Änderung. `path` ist ein punkt-separierter Pfad
 * relativ zum übergeordneten Container (z.B. `"steps[3].velocity"`).
 * `before`/`after` sind JSON-serialisierbare Snapshots (string|number|
 * boolean|null|Array|Object) — kein React-State, keine Funktionen.
 */
export interface FieldDiff {
  path: string;
  before: unknown;
  after: unknown;
}

export interface PatternChange {
  id: string;
  name: string;
  fieldDiffs: FieldDiff[];
}

export interface ChannelChange {
  /** Part-ID (Channel-Identifier in der Engine). */
  id: string;
  name: string;
  fieldDiffs: FieldDiff[];
}

export interface SampleChange {
  id: string;
  name: string;
  fieldDiffs: FieldDiff[];
}

export interface ArrayDiff<T> {
  added: T[];
  removed: T[];
  changed: Array<T & { fieldDiffs: FieldDiff[] }>;
}

/**
 * Top-level Result-Struktur. Section-Container haben immer `added/removed/
 * changed`-Arrays, nie `undefined` — die UI kann iterieren ohne null-Check.
 */
export interface ProjectDiff {
  metadata: {
    fieldDiffs: FieldDiff[];
  };
  patterns: {
    added: PatternData[];
    removed: PatternData[];
    changed: PatternChange[];
  };
  samples: {
    added: Sample[];
    removed: Sample[];
    changed: SampleChange[];
  };
  channels: {
    added: PartData[];
    removed: PartData[];
    changed: ChannelChange[];
  };
  mixer: {
    fieldDiffs: FieldDiff[];
  };
  macros: {
    fieldDiffs: FieldDiff[];
  };
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

/** Float-Toleranz für equal-compare (FX-Param, BPM-Bruchteile). */
export const FLOAT_EPSILON = 1e-4;

/**
 * Top-level Felder von SynthProject die NICHT in `metadata.fieldDiffs`
 * landen sollen — sie werden in eigenen Sections behandelt oder bewusst
 * ignoriert (z.B. savedAt unterscheidet sich bei jedem Save).
 */
const METADATA_IGNORE_KEYS = new Set<string>([
  "savedAt",
  "samples",
  "patterns",
  "mixer",
  "macros",
  "humanizer",
  "automation",
  "audioTracks",
  "scripts",
  "padBank",
  "liveInputs",
  "midiNoteOut",
  "slicePads",
  "song",
  "masterFx",
  "subMixBuses",
  "midiFxChain",
  "tempoMap",
]);

// ─── Pure-Helper: equal-compare ───────────────────────────────────────────────

/** True wenn `a` und `b` für unseren Diff-Zweck als gleich gelten. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    // Beide null/undefined ist schon oben durch ===; einer von beiden ist
    // anders → ungleich (außer null/undefined-Cross-Match wird hier NICHT
    // als gleich behandelt, damit explizites null im File sichtbar bleibt).
    return a == b; // == 0 / == undefined-Cross-Match
  }
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= FLOAT_EPSILON;
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set<string>([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) {
      if (!valuesEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

// ─── Pure-Helper: diffObject ──────────────────────────────────────────────────

/**
 * Recursive shallow→deep Diff zweier plain-Objekte. Ignoriert Keys aus
 * `ignoreKeys`. Liefert eine Liste an `FieldDiff` mit punkt-separierten
 * Pfaden (z.B. `"fx.reverbMix"`, `"steps[2].velocity"`).
 *
 * Spezialfälle:
 *  - Arrays werden als Ganzes verglichen (ein Diff am Array-Path), NICHT
 *    Element-für-Element — der Caller entscheidet bei Bedarf via diffArrays.
 *  - Nullsafe: `a` oder `b` darf undefined/null sein.
 *
 * @param a              Linkes Objekt
 * @param b              Rechtes Objekt
 * @param ignoreKeys     Top-level + nested Key-Namen die übersprungen werden
 * @param basePath       Interner Recursion-Pfad (Caller lässt leer)
 */
export function diffObject(
  a: unknown,
  b: unknown,
  ignoreKeys: Set<string> = new Set(),
  basePath: string = "",
): FieldDiff[] {
  const out: FieldDiff[] = [];

  // Beide nullish → kein Diff.
  if ((a === undefined || a === null) && (b === undefined || b === null)) {
    return out;
  }
  // Genau eines nullish → komplettes Replace.
  if (a === undefined || a === null || b === undefined || b === null) {
    out.push({ path: basePath || "<root>", before: a ?? null, after: b ?? null });
    return out;
  }

  // Primitive / Arrays → einzelner Diff am basePath wenn ungleich.
  if (typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) {
    if (!valuesEqual(a, b)) {
      out.push({ path: basePath || "<root>", before: a, after: b });
    }
    return out;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (ignoreKeys.has(k)) continue;
    const child = basePath ? `${basePath}.${k}` : k;
    const av = ao[k];
    const bv = bo[k];

    if (valuesEqual(av, bv)) continue;

    // Beide sind plain objects → tiefer rekursieren.
    if (
      av && bv &&
      typeof av === "object" && typeof bv === "object" &&
      !Array.isArray(av) && !Array.isArray(bv)
    ) {
      out.push(...diffObject(av, bv, ignoreKeys, child));
    } else {
      out.push({ path: child, before: av ?? null, after: bv ?? null });
    }
  }

  return out;
}

// ─── Pure-Helper: diffArrays ──────────────────────────────────────────────────

/**
 * Diff zweier ID-tragenden Array-Items. Liefert `added` (nur in `b`),
 * `removed` (nur in `a`), `changed` (in beiden, aber FieldDiffs nonempty).
 *
 * @param a          Vorher-Array
 * @param b          Nachher-Array
 * @param idKey      Property-Name der eindeutigen ID (default: `"id"`)
 * @param ignoreKeys Keys die innerhalb jedes Items beim Diff ignoriert werden
 */
export function diffArrays<T extends { id?: string | number } = { id?: string | number }>(
  a: T[] | undefined | null,
  b: T[] | undefined | null,
  idKey: keyof T = "id" as keyof T,
  ignoreKeys: Set<string> = new Set(),
): { added: T[]; removed: T[]; changed: Array<T & { fieldDiffs: FieldDiff[] }> } {
  const aArr = Array.isArray(a) ? a : [];
  const bArr = Array.isArray(b) ? b : [];
  const aMap = new Map<unknown, T>();
  const bMap = new Map<unknown, T>();
  for (const item of aArr) aMap.set((item as Record<string, unknown>)[idKey as string], item);
  for (const item of bArr) bMap.set((item as Record<string, unknown>)[idKey as string], item);

  const added: T[] = [];
  const removed: T[] = [];
  const changed: Array<T & { fieldDiffs: FieldDiff[] }> = [];

  for (const [id, item] of bMap) {
    if (!aMap.has(id)) added.push(item);
  }
  for (const [id, item] of aMap) {
    if (!bMap.has(id)) removed.push(item);
  }
  for (const [id, aItem] of aMap) {
    const bItem = bMap.get(id);
    if (!bItem) continue;
    const fieldDiffs = diffObject(aItem, bItem, ignoreKeys);
    if (fieldDiffs.length > 0) {
      changed.push({ ...bItem, fieldDiffs });
    }
  }

  return { added, removed, changed };
}

// ─── Top-level: diffProjects ──────────────────────────────────────────────────

/**
 * Liefert die strukturierte Diff zweier `SynthProject`-Snapshots.
 *
 * Reihenfolge ist gerichtet: `a` ist "Vorher / Project A", `b` ist
 * "Nachher / Project B". Ein hinzugefügtes Item in `b` landet in `added`.
 */
export function diffProjects(a: SynthProject, b: SynthProject): ProjectDiff {
  // ─── Metadata (top-level Felder außer den großen Sections) ────────────
  const metadataDiffs = diffObject(a, b, METADATA_IGNORE_KEYS);

  // ─── Patterns ─────────────────────────────────────────────────────────
  // Wir behandeln `parts` als eigenständige Channel-Section pro Pattern,
  // diff'en aber zusätzlich auf Pattern-Ebene (stepCount, bpm, name, …).
  const patternsRaw = diffArrays<PatternData>(
    a.patterns,
    b.patterns,
    "id",
  );
  const patternsChanged: PatternChange[] = patternsRaw.changed.map((p) => ({
    id: String(p.id),
    name: String(p.name ?? p.id),
    fieldDiffs: p.fieldDiffs,
  }));

  // ─── Channels (über alle Patterns aggregiert by Part-ID) ─────────────
  // Engine-Channel-Identität ist `part.id`; identische Part-IDs in beiden
  // Projekten gelten als derselbe Channel.
  const allPartsA = collectAllParts(a);
  const allPartsB = collectAllParts(b);
  const channelsRaw = diffArrays<PartData>(allPartsA, allPartsB, "id");
  const channelsChanged: ChannelChange[] = channelsRaw.changed.map((p) => ({
    id: String(p.id),
    name: String(p.name ?? p.id),
    fieldDiffs: p.fieldDiffs,
  }));

  // ─── Samples ──────────────────────────────────────────────────────────
  const samplesRaw = diffArrays<Sample>(a.samples, b.samples, "id");
  const samplesChanged: SampleChange[] = samplesRaw.changed.map((s) => ({
    id: String(s.id),
    name: String(s.name ?? s.id),
    fieldDiffs: s.fieldDiffs,
  }));

  // ─── Mixer ────────────────────────────────────────────────────────────
  const mixerDiffs = diffObject(a.mixer ?? {}, b.mixer ?? {}, new Set());

  // ─── Macros ───────────────────────────────────────────────────────────
  // `macros` ist Array<QuickActionMacro> | undefined. Wir diff'en als Block.
  const macrosDiffs = diffObject(
    { items: a.macros ?? [] },
    { items: b.macros ?? [] },
    new Set(),
  );

  return {
    metadata: { fieldDiffs: metadataDiffs },
    patterns: {
      added: patternsRaw.added,
      removed: patternsRaw.removed,
      changed: patternsChanged,
    },
    samples: {
      added: samplesRaw.added,
      removed: samplesRaw.removed,
      changed: samplesChanged,
    },
    channels: {
      added: channelsRaw.added,
      removed: channelsRaw.removed,
      changed: channelsChanged,
    },
    mixer: { fieldDiffs: mixerDiffs },
    macros: { fieldDiffs: macrosDiffs },
  };
}

/** Sammelt alle Parts aus allen Patterns; Duplikate (selbe Part-ID in
 * mehreren Patterns) werden by-id dedupliziert — last-write-wins. */
function collectAllParts(p: SynthProject): PartData[] {
  const map = new Map<string, PartData>();
  for (const pat of p.patterns ?? []) {
    for (const part of pat.parts ?? []) {
      map.set(part.id, part);
    }
  }
  return Array.from(map.values());
}

// ─── Summary-Formatter ────────────────────────────────────────────────────────

/**
 * Liefert eine kurze, human-readable Beschreibung der Diff (eine Zeile).
 * Beispiel: `"BPM: 120→128 · +2 Patterns · -1 Channel · 3 Mixer-Felder"`.
 * Wird in der UI-Header-Bar + Markdown-Export verwendet.
 */
export function formatDiffSummary(diff: ProjectDiff): string {
  const parts: string[] = [];

  // BPM speziell hervorheben (häufigster Quick-Check).
  const bpmDiff = diff.metadata.fieldDiffs.find((d) => d.path === "bpm");
  if (bpmDiff) {
    parts.push(`BPM: ${formatValue(bpmDiff.before)}→${formatValue(bpmDiff.after)}`);
  }
  const nameDiff = diff.metadata.fieldDiffs.find((d) => d.path === "projectName");
  if (nameDiff) {
    parts.push(`Name: "${formatValue(nameDiff.before)}"→"${formatValue(nameDiff.after)}"`);
  }

  if (diff.patterns.added.length) parts.push(`+${diff.patterns.added.length} Patterns`);
  if (diff.patterns.removed.length) parts.push(`-${diff.patterns.removed.length} Patterns`);
  if (diff.patterns.changed.length) parts.push(`${diff.patterns.changed.length} Patterns geändert`);

  if (diff.samples.added.length) parts.push(`+${diff.samples.added.length} Samples`);
  if (diff.samples.removed.length) parts.push(`-${diff.samples.removed.length} Samples`);

  if (diff.channels.added.length) parts.push(`+${diff.channels.added.length} Channels`);
  if (diff.channels.removed.length) parts.push(`-${diff.channels.removed.length} Channels`);
  if (diff.channels.changed.length) parts.push(`${diff.channels.changed.length} Channels FX geändert`);

  if (diff.mixer.fieldDiffs.length) parts.push(`${diff.mixer.fieldDiffs.length} Mixer-Felder`);
  if (diff.macros.fieldDiffs.length) parts.push(`Macros geändert`);

  if (parts.length === 0) return "Keine Unterschiede";
  return parts.join(" · ");
}

/**
 * Liefert eine Markdown-Repräsentation der Diff für Export/Clipboard.
 * Sections nur ausgegeben wenn nichtleer.
 */
export function formatDiffMarkdown(diff: ProjectDiff): string {
  const lines: string[] = [];
  lines.push(`# Project Diff`);
  lines.push("");
  lines.push(`**Summary:** ${formatDiffSummary(diff)}`);
  lines.push("");

  if (diff.metadata.fieldDiffs.length) {
    lines.push(`## Metadata`);
    for (const d of diff.metadata.fieldDiffs) {
      lines.push(`- \`${d.path}\`: ${formatValue(d.before)} → ${formatValue(d.after)}`);
    }
    lines.push("");
  }

  if (diff.patterns.added.length || diff.patterns.removed.length || diff.patterns.changed.length) {
    lines.push(`## Patterns`);
    for (const p of diff.patterns.added) lines.push(`- **Added:** ${p.name ?? p.id} (\`${p.id}\`)`);
    for (const p of diff.patterns.removed) lines.push(`- **Removed:** ${p.name ?? p.id} (\`${p.id}\`)`);
    for (const p of diff.patterns.changed) {
      lines.push(`- **Changed:** ${p.name} (\`${p.id}\`) — ${p.fieldDiffs.length} Felder`);
      for (const fd of p.fieldDiffs.slice(0, 8)) {
        lines.push(`  - \`${fd.path}\`: ${formatValue(fd.before)} → ${formatValue(fd.after)}`);
      }
      if (p.fieldDiffs.length > 8) lines.push(`  - … +${p.fieldDiffs.length - 8} weitere`);
    }
    lines.push("");
  }

  if (diff.samples.added.length || diff.samples.removed.length || diff.samples.changed.length) {
    lines.push(`## Samples`);
    for (const s of diff.samples.added) lines.push(`- **Added:** ${s.name}`);
    for (const s of diff.samples.removed) lines.push(`- **Removed:** ${s.name}`);
    for (const s of diff.samples.changed) lines.push(`- **Changed:** ${s.name} — ${s.fieldDiffs.length} Felder`);
    lines.push("");
  }

  if (diff.channels.added.length || diff.channels.removed.length || diff.channels.changed.length) {
    lines.push(`## Channels`);
    for (const c of diff.channels.added) lines.push(`- **Added:** ${c.name} (\`${c.id}\`)`);
    for (const c of diff.channels.removed) lines.push(`- **Removed:** ${c.name} (\`${c.id}\`)`);
    for (const c of diff.channels.changed) {
      lines.push(`- **Changed:** ${c.name} (\`${c.id}\`)`);
      for (const fd of c.fieldDiffs.slice(0, 8)) {
        lines.push(`  - \`${fd.path}\`: ${formatValue(fd.before)} → ${formatValue(fd.after)}`);
      }
      if (c.fieldDiffs.length > 8) lines.push(`  - … +${c.fieldDiffs.length - 8} weitere`);
    }
    lines.push("");
  }

  if (diff.mixer.fieldDiffs.length) {
    lines.push(`## Mixer`);
    for (const d of diff.mixer.fieldDiffs.slice(0, 20)) {
      lines.push(`- \`${d.path}\`: ${formatValue(d.before)} → ${formatValue(d.after)}`);
    }
    if (diff.mixer.fieldDiffs.length > 20) {
      lines.push(`- … +${diff.mixer.fieldDiffs.length - 20} weitere`);
    }
    lines.push("");
  }

  if (diff.macros.fieldDiffs.length) {
    lines.push(`## Macros`);
    lines.push(`- ${diff.macros.fieldDiffs.length} Felder geändert`);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

/** Snapshot eines Wertes für die Anzeige (kurz, lossy, nie Crash). */
export function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "string") {
    if (v.length > 60) return JSON.stringify(v.slice(0, 60) + "…");
    return JSON.stringify(v);
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    return Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6
      ? v.toExponential(3)
      : Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === "object") {
    try {
      const json = JSON.stringify(v);
      return json.length > 80 ? json.slice(0, 80) + "…" : json;
    } catch {
      return "[Object]";
    }
  }
  return String(v);
}

/** True wenn der Diff komplett leer ist (alle Sections empty). */
export function isEmptyDiff(diff: ProjectDiff): boolean {
  return (
    diff.metadata.fieldDiffs.length === 0 &&
    diff.patterns.added.length === 0 &&
    diff.patterns.removed.length === 0 &&
    diff.patterns.changed.length === 0 &&
    diff.samples.added.length === 0 &&
    diff.samples.removed.length === 0 &&
    diff.samples.changed.length === 0 &&
    diff.channels.added.length === 0 &&
    diff.channels.removed.length === 0 &&
    diff.channels.changed.length === 0 &&
    diff.mixer.fieldDiffs.length === 0 &&
    diff.macros.fieldDiffs.length === 0
  );
}
