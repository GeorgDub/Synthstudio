/**
 * Synthstudio – midiDeviceDetection.ts (v3.24.0)
 *
 * Auto-Detection für angeschlossene MIDI-Hardware. Matched
 * Web-MIDI-Device-Namen gegen ein Pattern-Set und liefert die passende
 * Template-ID (siehe `midiTemplates.ts`).
 *
 * Plug-and-Play-Flow:
 *   1. User stöpselt z.B. nanoKONTROL2 an → onstatechange feuert
 *   2. useMidi.refreshDevices() enumeriert Inputs
 *   3. detectTemplatesFromDeviceList() liefert pro Device einen TemplateMatch
 *   4. Suggestion-UI fragt User "Template anwenden?" — kein Auto-Apply.
 *
 * Pure Module, isomorph, keine React-/DOM-Abhängigkeit. Browser-Fallback
 * sicher: ohne window/localStorage bleiben Never-List-Funktionen NO-OP.
 */

import { listTemplateIds } from "@/utils/midiTemplates";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceNamePattern {
  /** Regex (case-insensitive empfohlen via /…/i Flag). */
  regex: RegExp;
  /** ID einer existierenden Vorlage in MIDI_TEMPLATES (midiTemplates.ts). */
  templateId: string;
  /** Anzeigename für UI-Suggestion ("nanoKONTROL2", "Launchpad MK2/MK3"). */
  displayName: string;
}

export interface TemplateMatch {
  deviceName: string;
  templateId: string;
  displayName: string;
}

// ─── Pattern-Tabelle ──────────────────────────────────────────────────────────
//
// Reihenfolge ist relevant: spezifischere Patterns zuerst (z.B. Launchpad
// Mini MK3 vor generischem Launchpad MK3 — beide treffen aber die selbe
// `launchpad-mk2`-Vorlage, die für MK2 und MK3 funktioniert).

export const DEVICE_NAME_PATTERNS: readonly DeviceNamePattern[] = [
  // KORG
  { regex: /nanoKONTROL2/i,                  templateId: "nanokontrol2",          displayName: "Korg nanoKONTROL2" },
  { regex: /padKONTROL/i,                    templateId: "korg-padkontrol",       displayName: "Korg padKONTROL" },
  { regex: /Volca\s*Beats/i,                 templateId: "korg-volca-beats",      displayName: "Korg Volca Beats" },
  { regex: /Electribe.*2|electribe.*sampler/i, templateId: "korg-electribe-2",    displayName: "Korg Electribe 2 / 2S" },
  // Novation
  { regex: /Launchpad.*MK2|Launchpad.*MK3|Launchpad.*Mini.*MK3/i,
                                             templateId: "launchpad-mk2",         displayName: "Novation Launchpad MK2/MK3" },
  // Ableton
  { regex: /Push\s*2/i,                      templateId: "push-2",                displayName: "Ableton Push 2" },
  // Akai
  { regex: /MPC.*One|MPC.*Live/i,            templateId: "mpc-one",               displayName: "Akai MPC One / MPC Live" },
  { regex: /MPK.*Mini.*MK3/i,                templateId: "mpk-mini-mk3",          displayName: "Akai MPK Mini MK3" },
  // Native Instruments
  { regex: /Maschine.*Mikro/i,               templateId: "maschine-mikro",        displayName: "NI Maschine Mikro MK3" },
  // Behringer
  { regex: /X-?TOUCH.*MINI/i,                templateId: "behringer-x-touch-mini", displayName: "Behringer X-Touch Mini" },
  // Roland (TR-8/TR-8S) + Behringer RD-8 (1:1 Clone)
  { regex: /TR-?8S?|RD-?8/i,                 templateId: "roland-tr-8",           displayName: "Roland TR-8 / TR-8S / RD-8" },
  // Arturia
  { regex: /BeatStep\s*Pro/i,                templateId: "arturia-beatstep-pro",  displayName: "Arturia BeatStep Pro" },
  // Elektron
  { regex: /Digitakt/i,                      templateId: "elektron-digitakt",     displayName: "Elektron Digitakt" },
];

// ─── Detection-API ────────────────────────────────────────────────────────────

/**
 * Liefert den ersten passenden Template-Match für einen Device-Namen oder
 * `null` wenn keiner trifft. Defensive gegen leere/whitespace-only Strings.
 *
 * Es wird zusätzlich geprüft dass die Template-ID auch wirklich noch in
 * `MIDI_TEMPLATES` existiert — falls jemand ein Template umbenennt oder
 * löscht ohne hier zu syncen.
 */
export function detectTemplateFromDeviceName(deviceName: string | null | undefined): TemplateMatch | null {
  if (!deviceName) return null;
  const trimmed = deviceName.trim();
  if (!trimmed) return null;

  const validIds = new Set(listTemplateIds());

  for (const entry of DEVICE_NAME_PATTERNS) {
    if (entry.regex.test(trimmed)) {
      if (!validIds.has(entry.templateId)) {
        // Pattern verweist auf nicht-existentes Template — log & skip
        // (passiert nur wenn jemand Templates renamed ohne hier zu syncen).
        // eslint-disable-next-line no-console
        console.warn(`[midi-detect] Pattern ${entry.regex} verweist auf unbekanntes Template "${entry.templateId}"`);
        continue;
      }
      return {
        deviceName: trimmed,
        templateId: entry.templateId,
        displayName: entry.displayName,
      };
    }
  }
  return null;
}

/**
 * Wendet `detectTemplateFromDeviceName` auf eine Geräte-Liste an und
 * filtert Null-Treffer + bereits in der Never-List enthaltene Devices.
 */
export function detectTemplatesFromDeviceList(
  deviceNames: ReadonlyArray<string | null | undefined>,
  neverList?: ReadonlySet<string>,
): TemplateMatch[] {
  const out: TemplateMatch[] = [];
  const seen = new Set<string>();
  for (const name of deviceNames) {
    const match = detectTemplateFromDeviceName(name);
    if (!match) continue;
    // Dedupe pro Device-Name (Input + Output erscheinen oft beide mit
    // ähnlichem Namen → User soll nur 1× gefragt werden).
    if (seen.has(match.deviceName)) continue;
    if (neverList?.has(match.deviceName)) continue;
    seen.add(match.deviceName);
    out.push(match);
  }
  return out;
}

// ─── Never-List Persistenz (localStorage) ────────────────────────────────────
//
// User kann pro Device-Name "Nie wieder fragen" wählen. Persistierter
// Eintrag verhindert dass die Suggestion bei Re-Connect wieder hochpoppt.

const NEVER_LIST_KEY = "synthstudio:midi-auto-detect:never:v1";
const AUTO_DETECT_ENABLED_KEY = "synthstudio:midi-auto-detect:enabled:v1";

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Lädt die Never-List aus localStorage. Defensiv gegen korrupten JSON. */
export function loadNeverList(): Set<string> {
  if (!hasLocalStorage()) return new Set();
  try {
    const raw = window.localStorage.getItem(NEVER_LIST_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

/** Persistiert die Never-List in localStorage. */
export function saveNeverList(list: ReadonlySet<string>): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(NEVER_LIST_KEY, JSON.stringify([...list]));
  } catch {
    /* Quota oder Private-Mode — silent fail */
  }
}

/** Fügt ein Device zur Never-List hinzu. */
export function addToNeverList(deviceName: string): void {
  const list = loadNeverList();
  list.add(deviceName);
  saveNeverList(list);
}

/** Prüft, ob ein Device in der Never-List steht. */
export function isInNeverList(deviceName: string): boolean {
  return loadNeverList().has(deviceName);
}

/** Entfernt ein Device aus der Never-List (Settings-Reset). */
export function removeFromNeverList(deviceName: string): void {
  const list = loadNeverList();
  list.delete(deviceName);
  saveNeverList(list);
}

/** Clear-Helper für Tests. */
export function clearNeverList(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(NEVER_LIST_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Auto-Detection Master-Toggle ────────────────────────────────────────────

/** True wenn Auto-Detection aktiv (Default true). */
export function isAutoDetectionEnabled(): boolean {
  if (!hasLocalStorage()) return true;
  try {
    const raw = window.localStorage.getItem(AUTO_DETECT_ENABLED_KEY);
    if (raw === null) return true; // Default ON
    return raw === "true";
  } catch {
    return true;
  }
}

/** Setzt Auto-Detection-Toggle. */
export function setAutoDetectionEnabled(enabled: boolean): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(AUTO_DETECT_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore */
  }
}

// ─── CustomEvent für UI-Suggestion ───────────────────────────────────────────

export const MIDI_TEMPLATE_SUGGESTED_EVENT = "midi:template-suggested";

export interface MidiTemplateSuggestedDetail {
  deviceName: string;
  templateId: string;
  displayName: string;
}

/**
 * Feuert ein window-CustomEvent mit dem Match-Detail. UI-Layer
 * (z.B. MidiSettings oder ein globaler Toast-Listener) konsumiert es
 * und zeigt eine "Template anwenden?"-Aufforderung.
 *
 * NO-OP wenn auto-detection disabled ist oder window nicht vorhanden
 * (SSR). Berücksichtigt Never-List.
 */
export function dispatchTemplateSuggestion(match: TemplateMatch): boolean {
  if (typeof window === "undefined") return false;
  if (!isAutoDetectionEnabled()) return false;
  if (isInNeverList(match.deviceName)) return false;

  const detail: MidiTemplateSuggestedDetail = {
    deviceName: match.deviceName,
    templateId: match.templateId,
    displayName: match.displayName,
  };
  window.dispatchEvent(new CustomEvent(MIDI_TEMPLATE_SUGGESTED_EVENT, { detail }));
  return true;
}
