/**
 * Synthstudio – useDrumPartRecordArmStore.ts (v3.63.0)
 *
 * Runtime-Record-Arm-Flag pro Drum-/Synth-Channel (Mixer-Channel-Strip).
 *
 * **Warum ein separater Store?** Drum-Parts leben in `PatternData.parts` und
 * werden bei jedem `.synth`-Save persistiert. `recordArmed` ist aber ein
 * SESSION-UI-FLAG — es soll NICHT in Projektdateien wandern (sonst lädt jeder
 * Mitarbeiter das Projekt mit zufällig armed Channels). Daher: separater
 * Observer-Store, localStorage-persistiert, partId → boolean.
 *
 * Wenn ein Part später (z.B. via removePart) verschwindet, wirft uns das
 * keinen Fehler — der Store liefert dann einfach `false` für unbekannte IDs.
 * Periodisches Cleanup ist optional (keine Korrektheits-Garantie nötig).
 *
 * Engine-Bridge: App.tsx liest bei `transport:play` armed live-inputs +
 * armed drum-parts und ruft `AudioEngine.startRecordingForChannels()`.
 *
 * Architektur: Custom Observer Store (analog useLiveInputStore.ts).
 * KEIN Zustand-npm-Package.
 */

import { useEffect, useReducer } from "react";

// ─── State ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "synthstudio:drum-recordarm:v1";

let _armedParts: Record<string, boolean> = loadFromStorage();

type Listener = () => void;
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach((l) => {
    try { l(); } catch { /* ignore */ }
  });
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadFromStorage(): Record<string, boolean> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && k.length > 0 && v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_armedParts));
  } catch { /* quota voll – ignore */ }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Setzt das Record-Arm-Flag für einen Drum-/Synth-Channel.
 * Idempotent — kein Notify wenn der Wert bereits identisch ist.
 * Ein leerer Wert (false) wird aus dem Storage entfernt um die Map klein
 * zu halten und Phantom-Entries zu vermeiden.
 */
export function setPartRecordArm(partId: string, armed: boolean): void {
  if (!partId || typeof partId !== "string") return;
  const current = _armedParts[partId] === true;
  if (current === armed) return;
  const next: Record<string, boolean> = { ..._armedParts };
  if (armed) {
    next[partId] = true;
  } else {
    delete next[partId];
  }
  _armedParts = next;
  persist();
  notify();
}

/** True wenn der Part gerade record-armed ist. */
export function isPartRecordArmed(partId: string): boolean {
  return _armedParts[partId] === true;
}

/** Liefert alle Part-IDs die armed=true sind (für Transport-Play-Hook). */
export function getArmedDrumPartIds(): string[] {
  return Object.keys(_armedParts).filter((id) => _armedParts[id] === true);
}

/** Anzahl der gerade armed Drum/Synth-Parts (für UI-Counter). */
export function countArmedDrumParts(): number {
  let n = 0;
  for (const id in _armedParts) if (_armedParts[id] === true) n++;
  return n;
}

/**
 * Bulk-Action: setzt das Arm-Flag für eine Liste von Part-IDs auf den
 * Ziel-Status. Idempotent — wenn der Aufruf nichts ändern würde, gibt es
 * keinen notify/persist. Wird vom Mixer Toolbar Arm-All genutzt.
 */
export function setAllDrumPartRecordArm(
  partIds: readonly string[],
  armed: boolean,
): void {
  if (!Array.isArray(partIds) || partIds.length === 0) return;
  let mutated = false;
  const next: Record<string, boolean> = { ..._armedParts };
  for (const id of partIds) {
    if (!id || typeof id !== "string") continue;
    const current = next[id] === true;
    if (current === armed) continue;
    if (armed) {
      next[id] = true;
    } else {
      delete next[id];
    }
    mutated = true;
  }
  if (!mutated) return;
  _armedParts = next;
  persist();
  notify();
}

/**
 * Entfernt Phantom-Entries für nicht mehr existierende Parts (Cleanup nach
 * removePart). Aufruf optional — der Store ist auch mit Stale-IDs korrekt.
 */
export function pruneArmedDrumParts(validPartIds: readonly string[]): void {
  const valid = new Set(validPartIds);
  let mutated = false;
  const next: Record<string, boolean> = {};
  for (const id in _armedParts) {
    if (_armedParts[id] === true && valid.has(id)) {
      next[id] = true;
    } else {
      mutated = true;
    }
  }
  if (!mutated) return;
  _armedParts = next;
  persist();
  notify();
}

/** Vollständiger Reset (für Tests + 'Neues Projekt'). */
export function __resetDrumPartRecordArmForTests(): void {
  _armedParts = {};
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* ignore */ }
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export interface DrumPartRecordArmStoreApi {
  /** Snapshot der Armed-Map — keys = partIds mit armed=true. */
  armedMap: Readonly<Record<string, boolean>>;
  /** Anzahl der armed Parts (lazy). */
  armedCount: number;
  setRecordArm: (partId: string, armed: boolean) => void;
  setAllRecordArm: (partIds: readonly string[], armed: boolean) => void;
  isArmed: (partId: string) => boolean;
  getArmedIds: () => string[];
}

export function useDrumPartRecordArmStore(): DrumPartRecordArmStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    armedMap: _armedParts,
    armedCount: countArmedDrumParts(),
    setRecordArm: setPartRecordArm,
    setAllRecordArm: setAllDrumPartRecordArm,
    isArmed: isPartRecordArmed,
    getArmedIds: getArmedDrumPartIds,
  };
}
