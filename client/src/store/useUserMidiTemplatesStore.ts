/**
 * Synthstudio – useUserMidiTemplatesStore (v1.96)
 *
 * Persistenter Store für benutzerdefinierte MIDI-Templates. User kann seine
 * aktuelle Mappings-Konfiguration unter einem Namen speichern und später
 * wieder laden — ohne JSON-Datei-Download/Upload.
 *
 * Komplementär zu:
 *   - midiTemplates.ts (eingebaute Hardware-Vorlagen, read-only)
 *   - midiLayoutImport/Export.ts (JSON-Datei-basiert, für Sharing)
 *
 * Persistenz: localStorage `synthstudio:user-midi-templates:v1`.
 * Maximale Anzahl: 50 (UI-Cap damit die Liste übersichtlich bleibt).
 *
 * Muster: Modul-Singleton + React useState/useReducer-Hook (analog
 * useThemeStore + useApiSettingsStore).
 */
import { useEffect, useReducer } from "react";
import type { MidiMapping, MidiNoteMapping } from "@/hooks/useMidi";

export interface UserMidiTemplate {
  id: string;
  name: string;
  /** Unix-ms Timestamp der letzten Speicherung. */
  updatedAt: number;
  /** Optional: bei welchem Device das Layout erstellt wurde (Anzeigehilfe). */
  deviceName?: string;
  ccMappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
}

const STORAGE_KEY = "synthstudio:user-midi-templates:v1";
const MAX_TEMPLATES = 50;

type Listener = () => void;

let _templates: UserMidiTemplate[] = loadFromStorage();
const _listeners = new Set<Listener>();

function loadFromStorage(): UserMidiTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidUserTemplate).slice(0, MAX_TEMPLATES);
  } catch {
    return [];
  }
}

function isValidUserTemplate(v: unknown): v is UserMidiTemplate {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === "string" &&
         typeof t.name === "string" &&
         typeof t.updatedAt === "number" &&
         Array.isArray(t.ccMappings) &&
         Array.isArray(t.noteMappings);
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_templates));
  } catch {
    // ignore quota errors etc
  }
}

function notify(): void {
  _listeners.forEach((fn) => fn());
}

function makeId(): string {
  return `usertpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Module-level API (testbar ohne React) ──────────────────────────────────

/** Liefert eine flache Kopie aller User-Templates, neueste zuerst. */
export function getUserMidiTemplates(): UserMidiTemplate[] {
  return [..._templates].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Liefert ein Template per ID oder undefined. */
export function getUserMidiTemplate(id: string): UserMidiTemplate | undefined {
  return _templates.find((t) => t.id === id);
}

/**
 * Speichert ein neues Template (oder updated wenn ID bereits existiert).
 * Returnt das neu erstellte/aktualisierte Template.
 *
 * Wenn die Maximalzahl überschritten wird, wird das älteste gelöscht.
 */
export function saveUserMidiTemplate(
  input: { id?: string; name: string; deviceName?: string; ccMappings: MidiMapping[]; noteMappings: MidiNoteMapping[] },
): UserMidiTemplate {
  const trimmedName = input.name.trim() || "Unbenannt";
  const existingIdx = input.id ? _templates.findIndex((t) => t.id === input.id) : -1;
  const tpl: UserMidiTemplate = {
    id: input.id ?? makeId(),
    name: trimmedName,
    deviceName: input.deviceName,
    updatedAt: Date.now(),
    ccMappings: input.ccMappings,
    noteMappings: input.noteMappings,
  };
  if (existingIdx >= 0) {
    _templates = [..._templates.slice(0, existingIdx), tpl, ..._templates.slice(existingIdx + 1)];
  } else {
    _templates = [tpl, ..._templates];
    if (_templates.length > MAX_TEMPLATES) {
      // Älteste löschen
      _templates.sort((a, b) => b.updatedAt - a.updatedAt);
      _templates = _templates.slice(0, MAX_TEMPLATES);
    }
  }
  persist();
  notify();
  return tpl;
}

/** Löscht ein Template per ID. No-op wenn unbekannt. */
export function deleteUserMidiTemplate(id: string): void {
  const before = _templates.length;
  _templates = _templates.filter((t) => t.id !== id);
  if (_templates.length !== before) {
    persist();
    notify();
  }
}

/** Benennt ein Template um. No-op wenn unbekannt oder neuer Name leer. */
export function renameUserMidiTemplate(id: string, newName: string): void {
  const trimmed = newName.trim();
  if (trimmed.length === 0) return;
  const idx = _templates.findIndex((t) => t.id === id);
  if (idx < 0) return;
  _templates = [
    ..._templates.slice(0, idx),
    { ..._templates[idx], name: trimmed, updatedAt: Date.now() },
    ..._templates.slice(idx + 1),
  ];
  persist();
  notify();
}

/** Reset für Tests. */
export function __resetUserMidiTemplatesForTests(): void {
  _templates = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

// ─── React-Hook ─────────────────────────────────────────────────────────────

/** React-Hook der die aktuelle Template-Liste returned + rerendert bei Änderungen. */
export function useUserMidiTemplates(): UserMidiTemplate[] {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return getUserMidiTemplates();
}
