/**
 * Synthstudio – keyboardActionDefs.ts
 *
 * Registry aller konfigurierbaren Keyboard-Aktionen.
 * Jede Action hat eine ID, ein Label, eine Kategorie und eine Standard-Taste.
 * Über useKeyboardBindingsStore können User eigene Tasten zuweisen.
 */

export interface ActionDef {
  id: string;
  label: string;
  category: string;
  /** Lesbare Darstellung der Standard-Taste (z.B. "Space", "Ctrl+R", "F5") */
  defaultKey: string;
  /** event.code oder event.key-Kombination für die Standard-Taste */
  defaultCombo: KeyCombo;
}

export interface KeyCombo {
  code: string;   // event.code (z.B. "Space", "KeyR", "F5")
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const ACTIONS: ActionDef[] = [
  // ── Transport ─────────────────────────────────────────────────────────────
  { id: "play-stop",     label: "Play / Stop",          category: "Transport", defaultKey: "Space",       defaultCombo: { code: "Space" } },
  { id: "record",        label: "Record ein/aus",        category: "Transport", defaultKey: "Ctrl+R",      defaultCombo: { code: "KeyR", ctrl: true } },
  { id: "tap-tempo",     label: "Tap Tempo",             category: "Transport", defaultKey: "T",           defaultCombo: { code: "KeyT" } },
  { id: "bpm-up",        label: "BPM +1",                category: "Transport", defaultKey: "+",           defaultCombo: { code: "Equal" } },
  { id: "bpm-down",      label: "BPM -1",                category: "Transport", defaultKey: "-",           defaultCombo: { code: "Minus" } },
  { id: "bpm-up-10",     label: "BPM +10",               category: "Transport", defaultKey: "Shift++",     defaultCombo: { code: "Equal", shift: true } },
  { id: "bpm-down-10",   label: "BPM -10",               category: "Transport", defaultKey: "Shift+-",     defaultCombo: { code: "Minus", shift: true } },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  { id: "tab-sequencer",    label: "Tab: Sequencer",     category: "Navigation", defaultKey: "F1",  defaultCombo: { code: "F1" } },
  { id: "tab-mixer",        label: "Tab: Mixer",         category: "Navigation", defaultKey: "F2",  defaultCombo: { code: "F2" } },
  { id: "tab-song",         label: "Tab: Song-Modus",    category: "Navigation", defaultKey: "F3",  defaultCombo: { code: "F3" } },
  { id: "tab-humanizer",    label: "Tab: Humanizer",     category: "Navigation", defaultKey: "F4",  defaultCombo: { code: "F4" } },
  { id: "tab-tools",        label: "Tab: Tools",         category: "Navigation", defaultKey: "F5",  defaultCombo: { code: "F5" } },
  { id: "tab-collab",       label: "Tab: Kollaboration", category: "Navigation", defaultKey: "F6",  defaultCombo: { code: "F6" } },

  // ── Panels & Dialoge ─────────────────────────────────────────────────────
  { id: "open-midi",        label: "MIDI-Einstellungen", category: "Panels",    defaultKey: "Ctrl+M",     defaultCombo: { code: "KeyM", ctrl: true } },
  { id: "open-shortcuts",   label: "Shortcuts-Hilfe",    category: "Panels",    defaultKey: "?",          defaultCombo: { code: "Slash", shift: true } },
  { id: "open-settings",    label: "Design-Einstellungen",category:"Panels",    defaultKey: "Ctrl+,",     defaultCombo: { code: "Comma", ctrl: true } },
  { id: "toggle-note-repeat",label: "Note Repeat ein/aus",category: "Panels",   defaultKey: "Alt+R",      defaultCombo: { code: "KeyR", alt: true } },
  { id: "toggle-morph",     label: "Pattern Morph ein/aus",category:"Panels",   defaultKey: "Alt+M",      defaultCombo: { code: "KeyM", alt: true } },
  { id: "toggle-spectrum",  label: "Spectrum ein/aus",   category: "Panels",    defaultKey: "Alt+S",      defaultCombo: { code: "KeyS", alt: true } },

  // ── Pattern ───────────────────────────────────────────────────────────────
  { id: "pattern-next",     label: "Nächstes Pattern",   category: "Pattern",   defaultKey: "Ctrl+→",     defaultCombo: { code: "ArrowRight", ctrl: true } },
  { id: "pattern-prev",     label: "Vorheriges Pattern", category: "Pattern",   defaultKey: "Ctrl+←",     defaultCombo: { code: "ArrowLeft",  ctrl: true } },
  { id: "pattern-duplicate",label: "Pattern duplizieren",category: "Pattern",   defaultKey: "Ctrl+D",     defaultCombo: { code: "KeyD", ctrl: true } },
  { id: "pattern-clear",    label: "Pattern leeren",     category: "Pattern",   defaultKey: "Ctrl+Del",   defaultCombo: { code: "Delete", ctrl: true } },
  { id: "pattern-fill",     label: "Pattern füllen",     category: "Pattern",   defaultKey: "Ctrl+F",     defaultCombo: { code: "KeyF", ctrl: true } },
  { id: "pattern-randomize",label: "Pattern randomisieren",category:"Pattern",  defaultKey: "Ctrl+Shift+R",defaultCombo:{ code:"KeyR",ctrl:true,shift:true }},
  { id: "pattern-copy-samples-from-prev", label: "Sampler vom vorherigen Pattern übernehmen", category: "Pattern", defaultKey: "Ctrl+Shift+S", defaultCombo: { code: "KeyS", ctrl: true, shift: true } },

  // ── Part & Modus ──────────────────────────────────────────────────────────
  { id: "part-up",          label: "Part hoch",          category: "Part",      defaultKey: "↑",          defaultCombo: { code: "ArrowUp" } },
  { id: "part-down",        label: "Part runter",        category: "Part",      defaultKey: "↓",          defaultCombo: { code: "ArrowDown" } },
  { id: "velocity-mode",    label: "Velocity-Modus",     category: "Part",      defaultKey: "V",          defaultCombo: { code: "KeyV" } },
  { id: "pitch-mode",       label: "Pitch-Modus",        category: "Part",      defaultKey: "P",          defaultCombo: { code: "KeyP" } },

  // ── Bearbeiten ────────────────────────────────────────────────────────────
  { id: "undo",             label: "Rückgängig",         category: "Bearbeiten",defaultKey: "Ctrl+Z",     defaultCombo: { code: "KeyZ", ctrl: true } },
  { id: "redo",             label: "Wiederholen",        category: "Bearbeiten",defaultKey: "Ctrl+Y",     defaultCombo: { code: "KeyY", ctrl: true } },
  { id: "save",             label: "Speichern",          category: "Bearbeiten",defaultKey: "Ctrl+S",     defaultCombo: { code: "KeyS", ctrl: true } },
];

export const ACTION_BY_ID = new Map(ACTIONS.map(a => [a.id, a]));

/** Konvertiert ein KeyboardEvent zu einer Combo-Beschreibung zum Vergleich. */
export function eventToCombo(e: KeyboardEvent): KeyCombo {
  return { code: e.code, ctrl: e.ctrlKey || e.metaKey || undefined, shift: e.shiftKey || undefined, alt: e.altKey || undefined };
}

/** Vergleicht zwei KeyCombos. */
export function combosMatch(a: KeyCombo, b: KeyCombo): boolean {
  return a.code === b.code &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt;
}

/** Erstellt einen lesbaren String aus einem KeyCombo. */
export function comboToLabel(c: KeyCombo): string {
  const parts: string[] = [];
  if (c.ctrl)  parts.push("Ctrl");
  if (c.alt)   parts.push("Alt");
  if (c.shift) parts.push("Shift");
  const key = c.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("Slash", "/")
    .replace("Comma", ",")
    .replace("Equal", "+")
    .replace("Minus", "-")
    .replace("Delete", "Del");
  parts.push(key);
  return parts.join("+");
}
