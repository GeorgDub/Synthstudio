/**
 * Synthstudio – midiMappingShare.ts (v3.64.0)
 *
 * Community-Sharing für MIDI-Mappings — analog zum v3.47 Plugin-Chain-Preset-
 * Sharing. Erweitert das bestehende v1-Layout-Format (siehe
 * `midiLayoutExport.ts` / `midiLayoutImport.ts`) um ein **v2-Schema** mit
 * vollständigem Envelope (Metadaten + author + appVersion + createdAt).
 *
 * Designziele:
 *   - **Backward-Compat**: v1-Layout-JSONs bleiben importierbar (Migration im
 *     Import-Pfad).
 *   - **Pretty-printed** JSON für User-Readability (2-Space-Indent).
 *   - **Merge vs Replace** Modi beim Import:
 *       - `replace` → midi.loadTemplate(...) → setzt alle Mappings neu
 *       - `merge`   → midi.addMappings(...)  → existierende werden überschrieben
 *                     bei (cc+channel)-Kollision; Note-Mappings angehängt
 *   - **Missing-Target-Handling**: Importer validiert nicht ob z.B. patternIndex
 *     im aktuellen Projekt existiert — solche Targets werden mit warning behalten
 *     (User entscheidet später). Strukturell ungültige targets (unbekannter
 *     `type`) werden komplett verworfen.
 *   - **Drag-Drop**: `.synthmidi.json` → `midi-mapping:import` CustomEvent.
 *
 * Pure-Funktionen (keine DOM/Storage-Side-Effects). UI-Komponenten serialisieren
 * via Blob+Anchor-Download bzw File-Input. Tests in
 * `tests/features/midi-mapping-share.test.ts`.
 *
 * Schema-Versionen:
 *   - `synthstudio-midi-mapping-v2` (single envelope, current)
 *   - `v1` (legacy, via parseMidiLayoutJson)
 */
import type {
  MidiMapping,
  MidiNoteMapping,
  MidiLearnTarget,
} from "@/hooks/useMidi";
import {
  VALID_TARGET_TYPES,
  isPerformancePadIndexValid,
  parseMidiLayoutJson,
} from "@/utils/midiLayoutImport";

// ─── Schema-Konstanten ───────────────────────────────────────────────────────

/** Schema-Identifier für v2-Single-Envelope (Round-Trip-stable). */
export const MIDI_MAPPING_SHARE_SCHEMA = "synthstudio-midi-mapping-v2" as const;

/**
 * Drag-Drop-Endung für v2-Mapping-Bundles. Compound-Suffix (analog
 * `.synthpreset.json`), damit das normale `.json` weiterhin als "unknown"
 * geroutet wird.
 */
export const MIDI_MAPPING_SHARE_SUFFIX = ".synthmidi.json" as const;

/** Maximal akzeptierte Größe einer Mapping-Datei (Sicherheits-Schranke). */
export const MAX_MAPPING_SHARE_BYTES = 64 * 1024; // 64kB (mehr als v1 da metadata)

// ─── Typen ───────────────────────────────────────────────────────────────────

/**
 * Header-Metadaten für ein geteiltes Mapping. Alle Felder optional außer
 * dem `name` — der wird auch als Default-Filename verwendet.
 */
export interface MidiMappingShareMeta {
  /** Human-readable Name (z.B. "Mein Electribe 2 Setup"). Pflicht. */
  name: string;
  /** Optionale Beschreibung (max ~500 Zeichen). */
  description?: string;
  /**
   * Hardware-Hint: Name des Devices für das dieses Mapping gedacht ist.
   * Zeigt der UI an "made for: <hint>".
   */
  hardwareHint?: string;
  /** Optionaler Autor / Nick. */
  author?: string;
  /** ms epoch. Wird beim Export auf Date.now() gesetzt wenn nicht angegeben. */
  createdAt?: number;
  /** Synthstudio-App-Version für Debug. */
  appVersion?: string;
}

export interface MidiMappingShareEnvelope {
  schema: typeof MIDI_MAPPING_SHARE_SCHEMA;
  meta: MidiMappingShareMeta;
  ccMappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
}

export interface MidiMappingShareInput {
  meta: MidiMappingShareMeta;
  ccMappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
}

export interface MidiMappingImportResult {
  /** True wenn das Mapping erfolgreich geparsed wurde (kann aber 0 Mappings haben). */
  success: boolean;
  /** Strukturfehler (Schema-Mismatch, kaputtes JSON, etc.) — Import abgebrochen. */
  errors: string[];
  /**
   * Soft-Warnings: einzelne übersprungene Mapping-Einträge (z.B. ungültiges
   * target, ungültige cc/note-Range). Andere Mappings im selben File werden
   * trotzdem importiert.
   */
  warnings: string[];
  /** Parsed envelope (bei success=true). Caller wendet via `applyImport` an. */
  envelope?: MidiMappingShareEnvelope;
  /**
   * Indicator dass das geparste File ein v1-Legacy-Layout war und auf v2
   * gehoben wurde. UI kann das als Hinweis anzeigen.
   */
  migratedFromV1?: boolean;
}

export type MidiMappingImportMode = "merge" | "replace";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface AnyRecord {
  [key: string]: unknown;
}

function isObject(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCcValid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 127;
}

function isNoteValid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 127;
}

function isChannelValid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 16;
}

function isTargetValid(v: unknown): v is MidiLearnTarget {
  if (!isObject(v)) return false;
  if (typeof v.type !== "string") return false;
  return VALID_TARGET_TYPES.has(v.type);
}

function sanitizeCcMapping(raw: unknown, idx: number, warnings: string[]): MidiMapping | null {
  if (!isObject(raw)) {
    warnings.push(`ccMappings[${idx}] ist kein Objekt — übersprungen.`);
    return null;
  }
  if (!isCcValid(raw.cc)) {
    warnings.push(`ccMappings[${idx}] ungültiger cc (${String(raw.cc)}) — übersprungen.`);
    return null;
  }
  if (!isChannelValid(raw.channel)) {
    warnings.push(`ccMappings[${idx}] ungültiger channel (${String(raw.channel)}) — übersprungen.`);
    return null;
  }
  if (!isTargetValid(raw.target)) {
    warnings.push(`ccMappings[${idx}] ungültiges target — übersprungen.`);
    return null;
  }
  return {
    cc: raw.cc,
    channel: raw.channel,
    target: raw.target,
    label: typeof raw.label === "string" ? raw.label : `CC ${raw.cc}`,
  };
}

function sanitizeNoteMapping(
  raw: unknown,
  idx: number,
  warnings: string[],
): MidiNoteMapping | null {
  if (!isObject(raw)) {
    warnings.push(`noteMappings[${idx}] ist kein Objekt — übersprungen.`);
    return null;
  }
  if (!isNoteValid(raw.note)) {
    warnings.push(`noteMappings[${idx}] ungültige note (${String(raw.note)}) — übersprungen.`);
    return null;
  }
  if (!isChannelValid(raw.channel)) {
    warnings.push(`noteMappings[${idx}] ungültiger channel (${String(raw.channel)}) — übersprungen.`);
    return null;
  }
  if (typeof raw.partId !== "string" || raw.partId.length === 0) {
    warnings.push(`noteMappings[${idx}] partId fehlt — übersprungen.`);
    return null;
  }
  const mapping: MidiNoteMapping = {
    note: raw.note,
    channel: raw.channel,
    partId: raw.partId,
    label: typeof raw.label === "string" ? raw.label : `Note ${raw.note}`,
  };
  if (raw.performancePadIndex !== undefined) {
    if (isPerformancePadIndexValid(raw.performancePadIndex)) {
      mapping.performancePadIndex = raw.performancePadIndex;
    } else {
      warnings.push(
        `noteMappings[${idx}] ungültiger performancePadIndex (${String(raw.performancePadIndex)}) — Feld ignoriert.`,
      );
    }
  }
  if (raw.target !== undefined) {
    if (isTargetValid(raw.target)) {
      mapping.target = raw.target;
    } else {
      warnings.push(
        `noteMappings[${idx}] ungültiges target — Feld ignoriert.`,
      );
    }
  }
  return mapping;
}

// ─── Export-API ──────────────────────────────────────────────────────────────

/**
 * Baut den v2-Envelope und serialisiert ihn pretty-printed.
 *
 * Garantie: `parseMidiMappingShareJson(buildMidiMappingShareJson(input))`
 * ist round-trip für `meta.name`, `ccMappings`, `noteMappings` und die
 * meta-Felder die der Caller setzt. Siehe Tests.
 */
export function buildMidiMappingShareJson(input: MidiMappingShareInput): string {
  const meta: MidiMappingShareMeta = {
    name: input.meta.name,
    ...(input.meta.description !== undefined ? { description: input.meta.description } : {}),
    ...(input.meta.hardwareHint !== undefined ? { hardwareHint: input.meta.hardwareHint } : {}),
    ...(input.meta.author !== undefined ? { author: input.meta.author } : {}),
    createdAt:
      typeof input.meta.createdAt === "number"
        ? input.meta.createdAt
        : Date.now(),
    ...(input.meta.appVersion !== undefined ? { appVersion: input.meta.appVersion } : {}),
  };
  const envelope: MidiMappingShareEnvelope = {
    schema: MIDI_MAPPING_SHARE_SCHEMA,
    meta,
    ccMappings: input.ccMappings.map((m) => ({
      cc: m.cc,
      channel: m.channel,
      target: m.target,
      label: m.label,
    })),
    noteMappings: input.noteMappings.map((m) => ({
      note: m.note,
      channel: m.channel,
      partId: m.partId,
      label: m.label,
      ...(m.performancePadIndex !== undefined
        ? { performancePadIndex: m.performancePadIndex }
        : {}),
      ...(m.target !== undefined ? { target: m.target } : {}),
    })),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * User-Input-Name → safe-Filename. Identisch zur Logik in
 * `sanitizeLayoutFileName` aber als eigene Funktion damit das v2-Modul
 * keinen Cross-Modul-Import braucht.
 *
 * Beispiel: "Mein Setup / v2!" → "Mein-Setup-v2"
 */
export function sanitizeMappingFileName(name: string): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "midi-mapping";
}

// ─── Import-API ──────────────────────────────────────────────────────────────

/**
 * Parsed + validated einen v2-Envelope JSON-String. Akzeptiert auch v1-
 * Legacy-Format und migriert das Resultat in einen v2-Envelope (mit
 * default-meta).
 *
 * Liefert IMMER ein Result-Objekt — wirft nicht. Bei `success=false` ist
 * `envelope` undefined und `errors[]` erklärt den Grund.
 */
export function parseMidiMappingShareJson(text: string): MidiMappingImportResult {
  const result: MidiMappingImportResult = {
    success: false,
    errors: [],
    warnings: [],
  };

  if (!text || text.trim().length === 0) {
    result.errors.push("Datei ist leer.");
    return result;
  }
  if (text.length > MAX_MAPPING_SHARE_BYTES) {
    result.errors.push(
      `Datei zu groß: ${text.length} Bytes (max ${MAX_MAPPING_SHARE_BYTES}).`,
    );
    return result;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`JSON-Parse-Fehler: ${msg}`);
    return result;
  }

  if (!isObject(raw)) {
    result.errors.push("Top-Level muss ein Objekt sein.");
    return result;
  }

  // v1 legacy: synthstudioLayout: "v1" → auto-migrate
  if (raw.synthstudioLayout === "v1") {
    const v1 = parseMidiLayoutJson(text);
    if (!v1.ok || !v1.layout) {
      result.errors.push(v1.error ?? "v1-Layout-Parse fehlgeschlagen.");
      return result;
    }
    const meta: MidiMappingShareMeta = {
      name: v1.layout.name ?? "Imported v1 Layout",
      createdAt: Date.now(),
    };
    result.envelope = {
      schema: MIDI_MAPPING_SHARE_SCHEMA,
      meta,
      ccMappings: v1.layout.ccMappings,
      noteMappings: v1.layout.noteMappings,
    };
    result.migratedFromV1 = true;
    if (v1.warnings) result.warnings.push(...v1.warnings);
    result.success = true;
    return result;
  }

  // v2 path
  if (raw.schema !== MIDI_MAPPING_SHARE_SCHEMA) {
    result.errors.push(
      `Unbekanntes Schema: "${String(raw.schema)}". Erwartet: ${MIDI_MAPPING_SHARE_SCHEMA} oder v1-Legacy.`,
    );
    return result;
  }

  if (!isObject(raw.meta) || typeof raw.meta.name !== "string" || raw.meta.name.length === 0) {
    result.errors.push("meta.name fehlt oder leer — Envelope ungültig.");
    return result;
  }

  const meta: MidiMappingShareMeta = {
    name: raw.meta.name,
    ...(typeof raw.meta.description === "string"
      ? { description: raw.meta.description }
      : {}),
    ...(typeof raw.meta.hardwareHint === "string"
      ? { hardwareHint: raw.meta.hardwareHint }
      : {}),
    ...(typeof raw.meta.author === "string" ? { author: raw.meta.author } : {}),
    ...(typeof raw.meta.createdAt === "number" && Number.isFinite(raw.meta.createdAt)
      ? { createdAt: raw.meta.createdAt }
      : {}),
    ...(typeof raw.meta.appVersion === "string"
      ? { appVersion: raw.meta.appVersion }
      : {}),
  };

  const ccMappings: MidiMapping[] = [];
  if (raw.ccMappings !== undefined) {
    if (!Array.isArray(raw.ccMappings)) {
      result.errors.push('"ccMappings" muss ein Array sein.');
      return result;
    }
    raw.ccMappings.forEach((entry, idx) => {
      const m = sanitizeCcMapping(entry, idx, result.warnings);
      if (m) ccMappings.push(m);
    });
  }

  const noteMappings: MidiNoteMapping[] = [];
  if (raw.noteMappings !== undefined) {
    if (!Array.isArray(raw.noteMappings)) {
      result.errors.push('"noteMappings" muss ein Array sein.');
      return result;
    }
    raw.noteMappings.forEach((entry, idx) => {
      const m = sanitizeNoteMapping(entry, idx, result.warnings);
      if (m) noteMappings.push(m);
    });
  }

  if (ccMappings.length === 0 && noteMappings.length === 0) {
    result.errors.push("Envelope enthält keine gültigen Mappings.");
    return result;
  }

  result.envelope = {
    schema: MIDI_MAPPING_SHARE_SCHEMA,
    meta,
    ccMappings,
    noteMappings,
  };
  result.success = true;
  return result;
}

/**
 * Wendet den parsed Envelope an die bestehenden Mappings an — abhängig vom
 * `mode`:
 *   - `replace` → komplettes Replacement (Caller ruft typischerweise
 *     midi.loadTemplate(envelope.ccMappings, envelope.noteMappings))
 *   - `merge`   → bestehende werden ergänzt: gleiche (cc+channel) wird
 *     vom Neuen überschrieben; gleiche (note+channel) ebenfalls
 *
 * Diese Funktion ist **pure** — sie liefert nur das resultierende
 * Mapping-Set zurück, ohne den midi-State zu mutieren. Caller entscheidet
 * ob `loadTemplate` (replace) oder `addMappings`+manuelle Note-Setzung
 * verwendet wird.
 *
 * Zusätzlich: `missingPartIds` listet partIds die nicht in `knownPartIds`
 * vorkommen — UI kann das als warning anzeigen.
 */
export function applyMappingShareImport(
  envelope: MidiMappingShareEnvelope,
  existing: { ccMappings: MidiMapping[]; noteMappings: MidiNoteMapping[] },
  mode: MidiMappingImportMode,
  knownPartIds: string[] = [],
): {
  ccMappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
  missingPartIds: string[];
  addedCount: number;
  replacedCount: number;
} {
  let cc: MidiMapping[];
  let notes: MidiNoteMapping[];
  let addedCount = 0;
  let replacedCount = 0;

  if (mode === "replace") {
    cc = envelope.ccMappings.map((m) => ({ ...m }));
    notes = envelope.noteMappings.map((m) => ({ ...m }));
    addedCount = cc.length + notes.length;
  } else {
    // merge: dedupe by (cc+channel) and (note+channel)
    const ccMap = new Map<string, MidiMapping>();
    for (const m of existing.ccMappings) ccMap.set(`${m.cc}:${m.channel}`, m);
    for (const m of envelope.ccMappings) {
      const k = `${m.cc}:${m.channel}`;
      if (ccMap.has(k)) replacedCount++;
      else addedCount++;
      ccMap.set(k, { ...m });
    }
    cc = Array.from(ccMap.values());

    const noteMap = new Map<string, MidiNoteMapping>();
    for (const m of existing.noteMappings)
      noteMap.set(`${m.note}:${m.channel}`, m);
    for (const m of envelope.noteMappings) {
      const k = `${m.note}:${m.channel}`;
      if (noteMap.has(k)) replacedCount++;
      else addedCount++;
      noteMap.set(k, { ...m });
    }
    notes = Array.from(noteMap.values());
  }

  // Missing-Part-Check: Note-Mappings die einen partId referenzieren der nicht
  // im Projekt existiert. UI kann das als "Pattern X nicht da → übersprungen"
  // anzeigen. Wir entfernen die Mappings NICHT — der User kann später
  // entsprechende Parts erstellen.
  const known = new Set(knownPartIds);
  const missingSet = new Set<string>();
  if (known.size > 0) {
    for (const n of notes) {
      if (!known.has(n.partId)) missingSet.add(n.partId);
    }
  }

  return {
    ccMappings: cc,
    noteMappings: notes,
    missingPartIds: Array.from(missingSet),
    addedCount,
    replacedCount,
  };
}
