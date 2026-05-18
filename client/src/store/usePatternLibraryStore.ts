/**
 * Synthstudio – usePatternLibraryStore
 *
 * Lokale Pattern-Bibliothek: Patterns speichern, suchen, importieren.
 * Persistiert in localStorage. Export/Import als JSON-Datei.
 *
 * Zukünftig: Cloud-Sync über die Synthstudio Cloud API.
 */
import { useEffect, useReducer } from "react";
import type { PatternData } from "@/audio/AudioEngine";

const STORAGE_KEY = "ss-pattern-library:v1";
const MAX_ENTRIES = 200;

export interface PatternLibraryEntry {
  id: string;
  name: string;
  genre: string;
  tags: string[];
  bpm: number;
  stepCount: 16 | 32 | 64;
  /** Serialisiertes PatternData */
  patternJson: string;
  createdAt: number;
  /** Eigene Bewertung (0–5) */
  rating: number;
}

type Listener = () => void;

function makeId() { return `lib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

function load(): PatternLibraryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persist(entries: PatternLibraryEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* ignore */ }
}

let _entries: PatternLibraryEntry[] = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function savePatternToLibrary(
  pattern: PatternData,
  opts: { name?: string; genre?: string; tags?: string[]; rating?: number } = {}
): string {
  const id = makeId();
  const entry: PatternLibraryEntry = {
    id,
    name: opts.name ?? pattern.name,
    genre: opts.genre ?? "Unbekannt",
    tags: opts.tags ?? [],
    bpm: pattern.bpm ?? 120,
    stepCount: pattern.stepCount,
    patternJson: JSON.stringify(pattern),
    createdAt: Date.now(),
    rating: opts.rating ?? 0,
  };
  _entries = [entry, ..._entries].slice(0, MAX_ENTRIES);
  persist(_entries);
  notify();
  return id;
}

export function deleteLibraryEntry(id: string): void {
  _entries = _entries.filter(e => e.id !== id);
  persist(_entries);
  notify();
}

export function updateLibraryEntry(id: string, changes: Partial<PatternLibraryEntry>): void {
  _entries = _entries.map(e => e.id === id ? { ...e, ...changes } : e);
  persist(_entries);
  notify();
}

export function getLibraryEntry(id: string): PatternLibraryEntry | undefined {
  return _entries.find(e => e.id === id);
}

export function searchLibrary(query: string, genre?: string): PatternLibraryEntry[] {
  const q = query.toLowerCase();
  return _entries.filter(e => {
    const matchQuery = !q || e.name.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q)) ||
      e.genre.toLowerCase().includes(q);
    const matchGenre = !genre || e.genre === genre;
    return matchQuery && matchGenre;
  });
}

export function exportLibrary(): string {
  return JSON.stringify({ version: "1.0", entries: _entries }, null, 2);
}

export function importLibrary(json: string, merge = true): void {
  const data = JSON.parse(json);
  const imported: PatternLibraryEntry[] = data.entries ?? [];
  _entries = merge
    ? [...imported.filter(e => !_entries.find(x => x.id === e.id)), ..._entries].slice(0, MAX_ENTRIES)
    : imported.slice(0, MAX_ENTRIES);
  persist(_entries);
  notify();
}

export function usePatternLibraryStore(): { entries: PatternLibraryEntry[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { entries: _entries };
}
