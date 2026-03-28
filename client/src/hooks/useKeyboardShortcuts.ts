/**
 * Synthstudio – useKeyboardShortcuts.ts
 *
 * Zentrale Tastatur-Belegung für die gesamte Anwendung:
 *
 * Transport:
 *   Space          → Play / Stop
 *   Ctrl+R         → Record
 *   Ctrl+.         → Stop (immer)
 *   T              → Tap-Tempo
 *   +/-            → BPM +1/-1
 *   Shift++/Shift+- → BPM +10/-10
 *
 * Drum Machine – Pad-Eingabe (Zeile 1 = aktiver Part):
 *   Q W E R T Y U I   → Steps 1-8
 *   A S D F G H J K   → Steps 9-16
 *   Z X C V B N M ,   → Steps 17-24 (bei 32-Step-Modus)
 *   1 2 3 4 5 6 7 8   → Steps 25-32 (bei 32-Step-Modus)
 *
 * Part-Navigation:
 *   ArrowUp/Down   → Part wechseln (vorheriger/nächster)
 *   Ctrl+1..8      → Part direkt wählen
 *
 * Pattern-Shortcuts:
 *   Ctrl+ArrowLeft/Right → Pattern wechseln
 *   Ctrl+D             → Pattern duplizieren
 *   Ctrl+Delete        → Pattern leeren
 *   Ctrl+F             → Pattern füllen (aktiver Part)
 *   Ctrl+Shift+R       → Pattern randomisieren (aktiver Part)
 *   Ctrl+Shift+Left    → Pattern nach links shiften
 *   Ctrl+Shift+Right   → Pattern nach rechts shiften
 *
 * Ansicht:
 *   Ctrl+B         → Sample-Browser ein/aus
 *   Ctrl+M         → MIDI-Einstellungen öffnen
 *   F11            → Vollbild
 *   ?              → Shortcuts-Hilfe
 *
 * Undo/Redo:
 *   Ctrl+Z         → Rückgängig
 *   Ctrl+Y / Ctrl+Shift+Z → Wiederholen
 */

import { useEffect, useRef, useCallback } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";

// ─── Pad-Tasten-Mapping ───────────────────────────────────────────────────────

// Zeile 1: Steps 0-7
const PAD_ROW_1: Record<string, number> = {
  KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3,
  KeyT: 4, KeyY: 5, KeyU: 6, KeyI: 7,
};
// Zeile 2: Steps 8-15
const PAD_ROW_2: Record<string, number> = {
  KeyA: 8, KeyS: 9, KeyD: 10, KeyF: 11,
  KeyG: 12, KeyH: 13, KeyJ: 14, KeyK: 15,
};
// Zeile 3: Steps 16-23 (32-Step-Modus)
const PAD_ROW_3: Record<string, number> = {
  KeyZ: 16, KeyX: 17, KeyC: 18, KeyV: 19,
  KeyB: 20, KeyN: 21, KeyM: 22, Comma: 23,
};
// Zeile 4: Steps 24-31 (32-Step-Modus)
const PAD_ROW_4: Record<string, number> = {
  Digit1: 24, Digit2: 25, Digit3: 26, Digit4: 27,
  Digit5: 28, Digit6: 29, Digit7: 30, Digit8: 31,
};

const ALL_PAD_KEYS = { ...PAD_ROW_1, ...PAD_ROW_2, ...PAD_ROW_3, ...PAD_ROW_4 };

// ─── Tap-Tempo ────────────────────────────────────────────────────────────────

class TapTempo {
  private taps: number[] = [];
  private readonly MAX_GAP = 3000; // ms – nach 3s neu starten
  private readonly MIN_TAPS = 2;
  private readonly MAX_TAPS = 8;

  tap(): number | null {
    const now = Date.now();
    if (this.taps.length > 0 && now - this.taps[this.taps.length - 1] > this.MAX_GAP) {
      this.taps = [];
    }
    this.taps.push(now);
    if (this.taps.length > this.MAX_TAPS) {
      this.taps = this.taps.slice(-this.MAX_TAPS);
    }
    if (this.taps.length < this.MIN_TAPS) return null;

    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i] - this.taps[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(60000 / avg);
    return Math.max(20, Math.min(300, bpm));
  }

  reset() {
    this.taps = [];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseKeyboardShortcutsOptions {
  dm: DrumMachineState & DrumMachineActions;
  isPlaying: boolean;
  bpm: number;
  onPlayStop: () => void;
  onRecord?: () => void;
  onBpmChange: (bpm: number) => void;
  onToggleSampleBrowser?: () => void;
  onToggleMidiSettings?: () => void;
  onToggleShortcutsHelp?: () => void;
  onFullscreen?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  dm,
  isPlaying,
  bpm,
  onPlayStop,
  onRecord,
  onBpmChange,
  onToggleSampleBrowser,
  onToggleMidiSettings,
  onToggleShortcutsHelp,
  onFullscreen,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  const tapTempo = useRef(new TapTempo());
  const optionsRef = useRef({
    dm, isPlaying, bpm, onPlayStop, onRecord, onBpmChange,
    onToggleSampleBrowser, onToggleMidiSettings, onToggleShortcutsHelp, onFullscreen,
  });
  optionsRef.current = {
    dm, isPlaying, bpm, onPlayStop, onRecord, onBpmChange,
    onToggleSampleBrowser, onToggleMidiSettings, onToggleShortcutsHelp, onFullscreen,
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Nicht in Eingabefeldern
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) return;

    const opts = optionsRef.current;
    const { dm } = opts;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const pattern = dm.getActivePattern();
    const parts = pattern?.parts ?? [];

    // ── Transport ────────────────────────────────────────────────────────────

    if (e.code === "Space" && !ctrl) {
      e.preventDefault();
      opts.onPlayStop();
      return;
    }

    if (e.code === "KeyR" && ctrl && !shift) {
      e.preventDefault();
      opts.onRecord?.();
      return;
    }

    if (e.code === "Period" && ctrl) {
      e.preventDefault();
      if (opts.isPlaying) opts.onPlayStop();
      return;
    }

    // Tap-Tempo: T (ohne Modifier)
    if (e.code === "KeyT" && !ctrl && !shift) {
      e.preventDefault();
      const newBpm = tapTempo.current.tap();
      if (newBpm !== null) opts.onBpmChange(newBpm);
      return;
    }

    // BPM +/-
    if (e.code === "Equal" && !ctrl) {
      e.preventDefault();
      opts.onBpmChange(Math.min(300, opts.bpm + (shift ? 10 : 1)));
      return;
    }
    if (e.code === "Minus" && !ctrl) {
      e.preventDefault();
      opts.onBpmChange(Math.max(20, opts.bpm - (shift ? 10 : 1)));
      return;
    }

    // ── Pad-Eingabe ──────────────────────────────────────────────────────────

    if (!ctrl && !shift && e.code in ALL_PAD_KEYS) {
      const stepIndex = ALL_PAD_KEYS[e.code];
      const stepCount = pattern?.stepCount ?? 16;
      if (stepIndex >= stepCount) return;

      // Aktiven Part bestimmen
      const activePartId = dm.activePartId ?? parts[0]?.id;
      if (!activePartId) return;

      e.preventDefault();
      dm.toggleStep(activePartId, stepIndex);
      return;
    }

    // ── Part-Navigation ──────────────────────────────────────────────────────

    if (e.code === "ArrowUp" && !ctrl && !shift) {
      e.preventDefault();
      const currentIndex = parts.findIndex(p => p.id === dm.activePartId);
      if (currentIndex > 0) {
        dm.setActivePart(parts[currentIndex - 1].id);
      }
      return;
    }

    if (e.code === "ArrowDown" && !ctrl && !shift) {
      e.preventDefault();
      const currentIndex = parts.findIndex(p => p.id === dm.activePartId);
      if (currentIndex < parts.length - 1) {
        dm.setActivePart(parts[currentIndex + 1].id);
      }
      return;
    }

    // Ctrl+1..8 → Part direkt wählen
    if (ctrl && !shift && e.code.startsWith("Digit")) {
      const digit = parseInt(e.code.replace("Digit", ""), 10);
      if (digit >= 1 && digit <= 8) {
        e.preventDefault();
        const part = parts[digit - 1];
        if (part) dm.setActivePart(part.id);
        return;
      }
    }

    // ── Pattern-Shortcuts ────────────────────────────────────────────────────

    if (ctrl && !shift && e.code === "ArrowLeft") {
      e.preventDefault();
      const patterns = dm.patterns;
      const idx = patterns.findIndex(p => p.id === dm.activePatternId);
      if (idx > 0) dm.setActivePattern(patterns[idx - 1].id);
      return;
    }

    if (ctrl && !shift && e.code === "ArrowRight") {
      e.preventDefault();
      const patterns = dm.patterns;
      const idx = patterns.findIndex(p => p.id === dm.activePatternId);
      if (idx < patterns.length - 1) dm.setActivePattern(patterns[idx + 1].id);
      return;
    }

    if (ctrl && !shift && e.code === "KeyD") {
      e.preventDefault();
      dm.duplicatePattern(dm.activePatternId);
      return;
    }

    if (ctrl && !shift && e.code === "Delete") {
      e.preventDefault();
      dm.clearPattern();
      return;
    }

    if (ctrl && !shift && e.code === "KeyF") {
      e.preventDefault();
      const activePartId = dm.activePartId ?? parts[0]?.id;
      if (activePartId) dm.fillPattern(activePartId);
      return;
    }

    if (ctrl && shift && e.code === "KeyR") {
      e.preventDefault();
      const activePartId = dm.activePartId ?? parts[0]?.id;
      if (activePartId) dm.randomizePattern(activePartId);
      return;
    }

    if (ctrl && shift && e.code === "ArrowLeft") {
      e.preventDefault();
      const activePartId = dm.activePartId ?? parts[0]?.id;
      if (activePartId) dm.shiftPattern(activePartId, "left");
      return;
    }

    if (ctrl && shift && e.code === "ArrowRight") {
      e.preventDefault();
      const activePartId = dm.activePartId ?? parts[0]?.id;
      if (activePartId) dm.shiftPattern(activePartId, "right");
      return;
    }

    // ── Undo/Redo ────────────────────────────────────────────────────────────

    if (ctrl && !shift && e.code === "KeyZ") {
      e.preventDefault();
      dm.undo();
      return;
    }

    if (ctrl && (e.code === "KeyY" || (shift && e.code === "KeyZ"))) {
      e.preventDefault();
      dm.redo();
      return;
    }

    // ── Ansicht ──────────────────────────────────────────────────────────────

    if (ctrl && !shift && e.code === "KeyB") {
      e.preventDefault();
      opts.onToggleSampleBrowser?.();
      return;
    }

    if (ctrl && !shift && e.code === "KeyM") {
      e.preventDefault();
      opts.onToggleMidiSettings?.();
      return;
    }

    if (e.code === "F11") {
      e.preventDefault();
      opts.onFullscreen?.();
      return;
    }

    if (e.code === "Slash" && shift) {
      // ? = Shift+/
      e.preventDefault();
      opts.onToggleShortcutsHelp?.();
      return;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);

  // Tap-Tempo zurücksetzen wenn BPM manuell geändert wird
  const resetTapTempo = useCallback(() => {
    tapTempo.current.reset();
  }, []);

  return { resetTapTempo };
}

// ─── Shortcut-Definitionen für Hilfe-Dialog ──────────────────────────────────

export interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ keys: string[]; description: string }>;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Transport",
    shortcuts: [
      { keys: ["Space"], description: "Play / Stop" },
      { keys: ["Ctrl", "R"], description: "Record" },
      { keys: ["Ctrl", "."], description: "Stop (immer)" },
      { keys: ["T"], description: "Tap-Tempo" },
      { keys: ["+"], description: "BPM +1" },
      { keys: ["-"], description: "BPM -1" },
      { keys: ["Shift", "+"], description: "BPM +10" },
      { keys: ["Shift", "-"], description: "BPM -10" },
    ],
  },
  {
    title: "Pad-Eingabe (aktiver Part)",
    shortcuts: [
      { keys: ["Q", "W", "E", "R", "T", "Y", "U", "I"], description: "Steps 1–8" },
      { keys: ["A", "S", "D", "F", "G", "H", "J", "K"], description: "Steps 9–16" },
      { keys: ["Z", "X", "C", "V", "B", "N", "M", ","], description: "Steps 17–24 (32-Step)" },
      { keys: ["1", "2", "3", "4", "5", "6", "7", "8"], description: "Steps 25–32 (32-Step)" },
    ],
  },
  {
    title: "Part-Navigation",
    shortcuts: [
      { keys: ["↑"], description: "Vorheriger Part" },
      { keys: ["↓"], description: "Nächster Part" },
      { keys: ["Ctrl", "1–8"], description: "Part direkt wählen" },
    ],
  },
  {
    title: "Pattern",
    shortcuts: [
      { keys: ["Ctrl", "←"], description: "Vorheriges Pattern" },
      { keys: ["Ctrl", "→"], description: "Nächstes Pattern" },
      { keys: ["Ctrl", "D"], description: "Pattern duplizieren" },
      { keys: ["Ctrl", "Del"], description: "Pattern leeren" },
      { keys: ["Ctrl", "F"], description: "Pattern füllen" },
      { keys: ["Ctrl", "Shift", "R"], description: "Pattern randomisieren" },
      { keys: ["Ctrl", "Shift", "←"], description: "Pattern nach links shiften" },
      { keys: ["Ctrl", "Shift", "→"], description: "Pattern nach rechts shiften" },
    ],
  },
  {
    title: "Bearbeiten",
    shortcuts: [
      { keys: ["Ctrl", "Z"], description: "Rückgängig" },
      { keys: ["Ctrl", "Y"], description: "Wiederholen" },
      { keys: ["Ctrl", "S"], description: "Speichern" },
      { keys: ["Ctrl", "O"], description: "Öffnen" },
      { keys: ["Ctrl", "N"], description: "Neues Projekt" },
    ],
  },
  {
    title: "Ansicht",
    shortcuts: [
      { keys: ["Ctrl", "B"], description: "Sample-Browser ein/aus" },
      { keys: ["Ctrl", "M"], description: "MIDI-Einstellungen" },
      { keys: ["F11"], description: "Vollbild" },
      { keys: ["?"], description: "Shortcuts-Hilfe" },
    ],
  },
];
