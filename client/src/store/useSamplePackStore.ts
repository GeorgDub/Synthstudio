/**
 * Synthstudio – useSamplePackStore (v3.106.0)
 *
 * Splice-style lokaler Sample-Pack-Manager.
 * Persistiert NUR Metadaten (kein Audio) in localStorage 'ss-sample-packs:v1'.
 *
 * Pattern: Modul-Singleton + React useReducer (analog useSceneStore).
 */

import { useEffect, useReducer } from "react";
import type { SampleCategory } from "@/utils/sampleClassifier";
import type { ScannedSample } from "@/components/SamplePackBrowser/importLogic";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface SamplePackSample {
  id: string;
  packId: string;
  filename: string;
  relPath: string;
  parentFolder: string;
  category: SampleCategory;
  tags: string[];
  bpm: number | null;
  duration: number | null;
  sizeBytes: number | null;
}

export interface SamplePack {
  id: string;
  name: string;
  rootPath: string;
  samples: SamplePackSample[];
  importedAt: number;
}

export interface SamplePackFilter {
  category?: SampleCategory | "all";
  tags?: string[];
  bpmMin?: number | null;
  bpmMax?: number | null;
  query?: string;
  packId?: string | null;
}

interface PackState {
  packs: SamplePack[];
}

type Listener = () => void;

// ─── Konstanten ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-sample-packs:v1";

// ─── Persistence ─────────────────────────────────────────────────────────────

function _load(): PackState {
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { packs: [] };
    const parsed = JSON.parse(raw) as { packs?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.packs)) {
      return { packs: [] };
    }
    // Defensive: validate top-level pack-shape
    const packs: SamplePack[] = [];
    for (const p of parsed.packs as Array<Partial<SamplePack>>) {
      if (
        p && typeof p.id === "string" && typeof p.name === "string" &&
        Array.isArray(p.samples)
      ) {
        packs.push({
          id: p.id,
          name: p.name,
          rootPath: typeof p.rootPath === "string" ? p.rootPath : "",
          samples: p.samples as SamplePackSample[],
          importedAt: typeof p.importedAt === "number" ? p.importedAt : Date.now(),
        });
      }
    }
    return { packs };
  } catch {
    return { packs: [] };
  }
}

function _persist(s: PackState): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
  } catch { /* ignore */ }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _state: PackState = _load();
const _listeners = new Set<Listener>();
function _notify(): void { _listeners.forEach((l) => l()); }

function _makePackId(): string {
  return `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getSamplePackState(): PackState {
  return _state;
}

/**
 * Fügt einen neuen Pack hinzu. Liefert die Pack-ID zurück.
 * Samples werden mit packId verknüpft (überschreibt evtl. existierende packId).
 */
export function addPack(
  name: string,
  rootPath: string,
  scanned: ScannedSample[],
): string {
  const packId = _makePackId();
  const samples: SamplePackSample[] = scanned.map((s) => ({
    id: s.id,
    packId,
    filename: s.filename,
    relPath: s.relPath,
    parentFolder: s.parentFolder,
    category: s.category,
    tags: s.tags,
    bpm: s.bpm,
    duration: null,
    sizeBytes: s.sizeBytes,
  }));
  const pack: SamplePack = {
    id: packId,
    name: name.trim() || "Pack",
    rootPath,
    samples,
    importedAt: Date.now(),
  };
  _state = { ..._state, packs: [..._state.packs, pack] };
  _persist(_state);
  _notify();
  return packId;
}

export function removePack(packId: string): void {
  _state = { ..._state, packs: _state.packs.filter((p) => p.id !== packId) };
  _persist(_state);
  _notify();
}

export function renamePack(packId: string, name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  _state = {
    ..._state,
    packs: _state.packs.map((p) => (p.id === packId ? { ...p, name: trimmed } : p)),
  };
  _persist(_state);
  _notify();
}

export function updateSampleDuration(sampleId: string, duration: number): void {
  if (!isFinite(duration) || duration < 0) return;
  let changed = false;
  const packs = _state.packs.map((p) => {
    const idx = p.samples.findIndex((s) => s.id === sampleId);
    if (idx < 0) return p;
    const newSamples = p.samples.slice();
    newSamples[idx] = { ...newSamples[idx], duration };
    changed = true;
    return { ...p, samples: newSamples };
  });
  if (!changed) return;
  _state = { ..._state, packs };
  _persist(_state);
  _notify();
}

/**
 * Sammelt alle Samples (über alle Packs) als flachen Array.
 */
export function getAllSamples(): SamplePackSample[] {
  const out: SamplePackSample[] = [];
  for (const p of _state.packs) {
    for (const s of p.samples) out.push(s);
  }
  return out;
}

/**
 * Liefert alle eindeutigen Tags (sortiert) über alle Packs.
 */
export function getAllTags(): string[] {
  const set = new Set<string>();
  for (const p of _state.packs) {
    for (const s of p.samples) {
      for (const t of s.tags) set.add(t);
    }
  }
  return Array.from(set).sort();
}

/**
 * Filtert Samples nach Kombi-Kriterien.
 *  - category 'all' / undefined → ignoriert
 *  - tags []                    → ignoriert (AND-Modus: alle tags müssen vorkommen)
 *  - bpmMin/Max null            → ignoriert
 *  - query ''                   → ignoriert
 *  - packId null/undefined      → alle packs
 */
export function filterSamples(opts: SamplePackFilter = {}): SamplePackSample[] {
  const { category, tags, bpmMin, bpmMax, query, packId } = opts;
  const all = getAllSamples();
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";

  return all.filter((s) => {
    if (packId && s.packId !== packId) return false;
    if (category && category !== "all" && s.category !== category) return false;
    if (Array.isArray(tags) && tags.length > 0) {
      const own = new Set(s.tags);
      for (const t of tags) {
        if (!own.has(t)) return false;
      }
    }
    if (typeof bpmMin === "number" && isFinite(bpmMin)) {
      if (s.bpm === null || s.bpm < bpmMin) return false;
    }
    if (typeof bpmMax === "number" && isFinite(bpmMax)) {
      if (s.bpm === null || s.bpm > bpmMax) return false;
    }
    if (q.length > 0) {
      if (s.filename.toLowerCase().includes(q)) return true;
      if (s.parentFolder.toLowerCase().includes(q)) return true;
      for (const t of s.tags) {
        if (t.toLowerCase().includes(q)) return true;
      }
      return false;
    }
    return true;
  });
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSamplePackStore(): {
  packs: SamplePack[];
  addPack: typeof addPack;
  removePack: typeof removePack;
  renamePack: typeof renamePack;
  filterSamples: typeof filterSamples;
  getAllTags: typeof getAllTags;
  getAllSamples: typeof getAllSamples;
  updateSampleDuration: typeof updateSampleDuration;
} {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return {
    packs: _state.packs,
    addPack,
    removePack,
    renamePack,
    filterSamples,
    getAllTags,
    getAllSamples,
    updateSampleDuration,
  };
}

// ─── Test-Reset ──────────────────────────────────────────────────────────────

export function __resetSamplePackStoreForTests(): void {
  _state = { packs: [] };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* ignore */ }
  _notify();
}
