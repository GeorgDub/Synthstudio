/**
 * Synthstudio – usePatchStore (v2.16, Hot-Swap-Patches)
 *
 * Library für gespeicherte Sound-Patches. Patches sind portable
 * Sound-Konfigurationen die der User auf jeden Part anwenden kann
 * (Hot-Swap) — siehe utils/patchSerialize.ts für die Datenstruktur.
 *
 * Custom-Observer-Pattern (Modul-Singleton + React-Hook).
 * Persistenz: localStorage Key "ss-patches:v1".
 */
import { useEffect, useReducer } from "react";
import { type Patch, patchToJson, patchFromJson } from "@/utils/patchSerialize";

const STORAGE_KEY = "ss-patches:v1";
const MAX_PATCHES = 200;

let _patches: Patch[] = loadInitial();
const _listeners = new Set<() => void>();

function notify(): void { _listeners.forEach(l => l()); }

function loadInitial(): Patch[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Patch[] = [];
    for (const item of parsed) {
      const p = patchFromJson(JSON.stringify(item));
      if (p) out.push(p);
    }
    return out.slice(0, MAX_PATCHES);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_patches));
  } catch { /* ignore quota / privacy mode */ }
}

// ─── Pure-API ────────────────────────────────────────────────────────────────

export function getPatches(): Patch[] {
  return _patches;
}

export function getPatchById(id: string): Patch | undefined {
  return _patches.find(p => p.id === id);
}

export function savePatch(patch: Patch): void {
  // Update wenn ID schon existiert, sonst append. Ordnen nach createdAt-DESC
  // damit neueste oben in der Library stehen.
  const existing = _patches.findIndex(p => p.id === patch.id);
  if (existing >= 0) {
    _patches = _patches.map((p, i) => i === existing ? patch : p);
  } else {
    _patches = [patch, ..._patches].slice(0, MAX_PATCHES);
  }
  persist();
  notify();
}

export function deletePatch(id: string): void {
  const before = _patches.length;
  _patches = _patches.filter(p => p.id !== id);
  if (_patches.length !== before) {
    persist();
    notify();
  }
}

export function renamePatch(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  let changed = false;
  _patches = _patches.map(p => {
    if (p.id === id && p.name !== trimmed) {
      changed = true;
      return { ...p, name: trimmed };
    }
    return p;
  });
  if (changed) {
    persist();
    notify();
  }
}

export function clearAllPatches(): void {
  if (_patches.length === 0) return;
  _patches = [];
  persist();
  notify();
}

/**
 * Exportiert die gesamte Library als JSON-String (Array von Patches).
 * Wird für Backup / Sharing genutzt.
 */
export function exportLibrary(): string {
  return JSON.stringify(_patches);
}

/**
 * Importiert eine zuvor exportierte Library. `mode="merge"` ergänzt die
 * existierende Library, `mode="replace"` ersetzt sie komplett.
 * Liefert die Anzahl tatsächlich importierter Patches.
 */
export function importLibrary(json: string, mode: "merge" | "replace" = "merge"): number {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return 0; }
  if (!Array.isArray(parsed)) return 0;

  const incoming: Patch[] = [];
  for (const item of parsed) {
    const p = patchFromJson(JSON.stringify(item));
    if (p) incoming.push(p);
  }
  if (incoming.length === 0) return 0;

  if (mode === "replace") {
    _patches = incoming.slice(0, MAX_PATCHES);
  } else {
    // Merge: Patches mit gleicher ID werden überschrieben, neue werden vorne
    // angefügt damit sie sichtbar sind.
    const existingIds = new Set(_patches.map(p => p.id));
    const novel = incoming.filter(p => !existingIds.has(p.id));
    const updated = _patches.map(p => {
      const replacement = incoming.find(n => n.id === p.id);
      return replacement ?? p;
    });
    _patches = [...novel, ...updated].slice(0, MAX_PATCHES);
  }

  persist();
  notify();
  return incoming.length;
}

export function __resetPatchStoreForTests(): void {
  _patches = [];
  try { localStorage?.removeItem?.(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

// `patchToJson` wird re-exported damit Konsumenten genau eine Quelle haben.
export { patchToJson };

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function usePatchStore(): { patches: Patch[] } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return { patches: _patches };
}
