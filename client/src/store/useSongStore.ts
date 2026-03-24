/**
 * Synthstudio – useSongStore
 *
 * Song-Modus: Pattern-Chaining und Song-Timeline.
 * Ermöglicht das Anordnen von Patterns in einer Sequenz für vollständige Songs.
 *
 * Konzept:
 * - Ein Song besteht aus einer geordneten Liste von "Song-Slots"
 * - Jeder Slot referenziert eine Pattern-Bank (A–D) und hat eine Wiederholungsanzahl
 * - Der Song-Player spielt die Slots der Reihe nach ab
 * - Loop-Modus: Gesamten Song oder einzelne Slots wiederholen
 *
 * Isomorph: Funktioniert im Browser und in Electron.
 */
import { useState, useCallback } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export type PatternBank = "A" | "B" | "C" | "D";

export interface SongSlot {
  /** Eindeutige ID des Slots */
  id: string;
  /** Welche Pattern-Bank gespielt wird */
  bank: PatternBank;
  /** Wie oft das Pattern wiederholt wird (1–16) */
  repeats: number;
  /** Optionaler Label für den Slot (z.B. "Intro", "Verse", "Chorus") */
  label?: string;
  /** Ob dieser Slot gemuted ist */
  muted: boolean;
}

export interface SongState {
  /** Liste der Song-Slots in Reihenfolge */
  slots: SongSlot[];
  /** Index des aktuell spielenden Slots (-1 = nicht aktiv) */
  currentSlotIndex: number;
  /** Ob der Song-Modus aktiv ist (vs. Pattern-Loop-Modus) */
  songModeActive: boolean;
  /** Ob der gesamte Song in einer Schleife wiederholt wird */
  loopSong: boolean;
  /** Aktueller Wiederholungs-Zähler für den aktiven Slot */
  currentRepeat: number;
  /** Gesamtanzahl der Pattern-Schritte im Song */
  totalSteps: number;
}

export interface SongActions {
  /** Slot am Ende hinzufügen */
  addSlot: (bank: PatternBank, repeats?: number, label?: string) => void;
  /** Slot an bestimmter Position einfügen */
  insertSlot: (index: number, bank: PatternBank, repeats?: number) => void;
  /** Slot entfernen */
  removeSlot: (id: string) => void;
  /** Slot verschieben (Drag & Drop Reordering) */
  moveSlot: (fromIndex: number, toIndex: number) => void;
  /** Slot-Eigenschaften aktualisieren */
  updateSlot: (id: string, changes: Partial<Pick<SongSlot, "bank" | "repeats" | "label" | "muted">>) => void;
  /** Alle Slots löschen */
  clearSong: () => void;
  /** Song-Modus ein/ausschalten */
  toggleSongMode: () => void;
  /** Song-Loop ein/ausschalten */
  toggleLoopSong: () => void;
  /** Aktuellen Slot setzen (während Wiedergabe) */
  setCurrentSlot: (index: number, repeat: number) => void;
  /** Song zurücksetzen (zum Anfang) */
  resetSong: () => void;
  /** Schnell-Arrangement aus Pattern-Folge erstellen */
  createArrangement: (pattern: Array<{ bank: PatternBank; repeats: number }>) => void;
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function generateId(): string {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function calculateTotalSteps(slots: SongSlot[]): number {
  return slots.reduce((sum, slot) => sum + slot.repeats * 16, 0);
}

// ─── Standard-Song ────────────────────────────────────────────────────────────

const DEFAULT_SONG: SongState = {
  slots: [
    { id: generateId(), bank: "A", repeats: 2, label: "Intro", muted: false },
    { id: generateId(), bank: "B", repeats: 4, label: "Verse", muted: false },
    { id: generateId(), bank: "C", repeats: 2, label: "Chorus", muted: false },
    { id: generateId(), bank: "B", repeats: 4, label: "Verse 2", muted: false },
    { id: generateId(), bank: "C", repeats: 4, label: "Outro", muted: false },
  ],
  currentSlotIndex: -1,
  songModeActive: false,
  loopSong: false,
  currentRepeat: 0,
  totalSteps: 0,
};

DEFAULT_SONG.totalSteps = calculateTotalSteps(DEFAULT_SONG.slots);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSongStore(): SongState & SongActions {
  const [state, setState] = useState<SongState>(DEFAULT_SONG);

  const addSlot = useCallback((bank: PatternBank, repeats = 1, label?: string) => {
    setState((prev) => {
      const newSlot: SongSlot = {
        id: generateId(),
        bank,
        repeats: Math.max(1, Math.min(16, repeats)),
        label,
        muted: false,
      };
      const slots = [...prev.slots, newSlot];
      return { ...prev, slots, totalSteps: calculateTotalSteps(slots) };
    });
  }, []);

  const insertSlot = useCallback((index: number, bank: PatternBank, repeats = 1) => {
    setState((prev) => {
      const newSlot: SongSlot = {
        id: generateId(),
        bank,
        repeats: Math.max(1, Math.min(16, repeats)),
        muted: false,
      };
      const slots = [...prev.slots];
      slots.splice(index, 0, newSlot);
      return { ...prev, slots, totalSteps: calculateTotalSteps(slots) };
    });
  }, []);

  const removeSlot = useCallback((id: string) => {
    setState((prev) => {
      const slots = prev.slots.filter((s) => s.id !== id);
      return { ...prev, slots, totalSteps: calculateTotalSteps(slots) };
    });
  }, []);

  const moveSlot = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      if (fromIndex === toIndex) return prev;
      const slots = [...prev.slots];
      const [moved] = slots.splice(fromIndex, 1);
      slots.splice(toIndex, 0, moved);
      return { ...prev, slots };
    });
  }, []);

  const updateSlot = useCallback(
    (id: string, changes: Partial<Pick<SongSlot, "bank" | "repeats" | "label" | "muted">>) => {
      setState((prev) => {
        const slots = prev.slots.map((s) =>
          s.id === id
            ? {
                ...s,
                ...changes,
                repeats: changes.repeats
                  ? Math.max(1, Math.min(16, changes.repeats))
                  : s.repeats,
              }
            : s
        );
        return { ...prev, slots, totalSteps: calculateTotalSteps(slots) };
      });
    },
    []
  );

  const clearSong = useCallback(() => {
    setState((prev) => ({ ...prev, slots: [], totalSteps: 0, currentSlotIndex: -1 }));
  }, []);

  const toggleSongMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      songModeActive: !prev.songModeActive,
      currentSlotIndex: -1,
      currentRepeat: 0,
    }));
  }, []);

  const toggleLoopSong = useCallback(() => {
    setState((prev) => ({ ...prev, loopSong: !prev.loopSong }));
  }, []);

  const setCurrentSlot = useCallback((index: number, repeat: number) => {
    setState((prev) => ({ ...prev, currentSlotIndex: index, currentRepeat: repeat }));
  }, []);

  const resetSong = useCallback(() => {
    setState((prev) => ({ ...prev, currentSlotIndex: -1, currentRepeat: 0 }));
  }, []);

  const createArrangement = useCallback(
    (pattern: Array<{ bank: PatternBank; repeats: number }>) => {
      setState((prev) => {
        const slots: SongSlot[] = pattern.map(({ bank, repeats }) => ({
          id: generateId(),
          bank,
          repeats: Math.max(1, Math.min(16, repeats)),
          muted: false,
        }));
        return { ...prev, slots, totalSteps: calculateTotalSteps(slots) };
      });
    },
    []
  );

  return {
    ...state,
    addSlot,
    insertSlot,
    removeSlot,
    moveSlot,
    updateSlot,
    clearSong,
    toggleSongMode,
    toggleLoopSong,
    setCurrentSlot,
    resetSong,
    createArrangement,
  };
}
