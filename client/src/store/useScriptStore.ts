/**
 * Synthstudio – useScriptStore.ts
 *
 * State-Management für persistente Skripte mit Keyboard- und Macro-Button-Bindings.
 *
 * - App-globale Scripts (scope: "app") werden in localStorage persistiert
 *   (Key: `ss-scripts:v1`).
 * - Projekt-lokale Scripts (scope: "project") werden ausschließlich in-memory
 *   gehalten und über `loadProjectScripts()` zur Laufzeit gemerged. Die
 *   Persistenz solcher Scripts läuft via projectSerializer in die `.synth`-Datei.
 * - Beim Laden fremder Projekte werden alle scope:"project" Scripts mit
 *   `enabled: false` markiert → User-Consent erforderlich, bevor Code läuft.
 * - Maximal `MAX_SCRIPTS` (= 64) Scripts gesamt, jedes Script max
 *   `MAX_SCRIPT_CODE_BYTES` (= 10.000 Bytes) Code.
 *
 * Module-Singleton-Observer-Pattern (KEIN Zustand-npm-Package),
 * spiegelt useMacroStore.ts / useNoteRepeatStore.ts.
 */

import { useEffect, useReducer } from "react";

// ─── Typen ───────────────────────────────────────────────────────────────────

export type ScriptId = string;
export type ScriptScope = "app" | "project";

export interface KeyCombo {
  /** KeyboardEvent.key (z.B. "b", "Enter", "F2") */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface Script {
  id: ScriptId;
  name: string;
  code: string;
  scope: ScriptScope;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  keyBinding?: KeyCombo;
  /** 0..7 — Index des Macro-Buttons, an den dieses Skript gebunden ist */
  macroButtonIndex?: number;
  /** Maximale Laufzeit in ms (default DEFAULT_MAX_RUNTIME_MS) */
  maxRuntimeMs: number;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const MAX_SCRIPTS = 64;
export const MAX_SCRIPT_CODE_BYTES = 10_000;
export const DEFAULT_MAX_RUNTIME_MS = 5000;

const STORAGE_KEY = "ss-scripts:v1";
const ID_PREFIX = "sc-";

// ─── State + Listener ────────────────────────────────────────────────────────

let _scripts: Script[] = loadFromStorage();

type Listener = () => void;
const _listeners = new Set<Listener>();
function notify(): void {
  _listeners.forEach((l) => l());
}

// ─── ID-Generator ────────────────────────────────────────────────────────────

function makeScriptId(): ScriptId {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ID_PREFIX}${Date.now()}-${rand}`;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function byteLengthOf(str: string): number {
  // UTF-8 byte length; in Node + Browser identisch, ohne TextEncoder als Pflicht.
  if (typeof TextEncoder !== "undefined") {
    try {
      return new TextEncoder().encode(str).length;
    } catch {
      // fall through
    }
  }
  // Fallback: schätze konservativ über encodeURIComponent.
  try {
    return encodeURIComponent(str).replace(/%[0-9A-F]{2}/g, "_").length;
  } catch {
    return str.length;
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function isValidKeyCombo(c: unknown): c is KeyCombo {
  if (!isPlainObject(c)) return false;
  if (typeof c.key !== "string" || c.key.length === 0) return false;
  for (const flag of ["ctrl", "shift", "alt", "meta"] as const) {
    if (c[flag] !== undefined && typeof c[flag] !== "boolean") return false;
  }
  return true;
}

function isValidMacroIndex(idx: unknown): idx is number {
  return (
    typeof idx === "number" &&
    Number.isInteger(idx) &&
    idx >= 0 &&
    idx <= 7
  );
}

/**
 * Validiert ein Script-Objekt vollständig (für externe Eingaben / Datei-Loads).
 * Gibt eine Liste lesbarer Fehler zurück, leer wenn ok.
 */
export function validateScript(s: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(s)) {
    return { ok: false, errors: ["Script is not an object"] };
  }
  if (typeof s.id !== "string" || s.id.length === 0) {
    errors.push("id must be a non-empty string");
  }
  if (typeof s.name !== "string" || s.name.trim().length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (typeof s.code !== "string") {
    errors.push("code must be a string");
  } else if (byteLengthOf(s.code) > MAX_SCRIPT_CODE_BYTES) {
    errors.push(
      `code exceeds maximum size of ${MAX_SCRIPT_CODE_BYTES} bytes`,
    );
  }
  if (s.scope !== "app" && s.scope !== "project") {
    errors.push("scope must be 'app' or 'project'");
  }
  if (typeof s.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }
  if (typeof s.createdAt !== "number" || !Number.isFinite(s.createdAt)) {
    errors.push("createdAt must be a finite number");
  }
  if (typeof s.updatedAt !== "number" || !Number.isFinite(s.updatedAt)) {
    errors.push("updatedAt must be a finite number");
  }
  if (s.keyBinding !== undefined && !isValidKeyCombo(s.keyBinding)) {
    errors.push("keyBinding is invalid (must have non-empty key)");
  }
  if (s.macroButtonIndex !== undefined && !isValidMacroIndex(s.macroButtonIndex)) {
    errors.push("macroButtonIndex must be an integer in 0..7");
  }
  if (
    typeof s.maxRuntimeMs !== "number" ||
    !Number.isFinite(s.maxRuntimeMs) ||
    s.maxRuntimeMs <= 0
  ) {
    errors.push("maxRuntimeMs must be a positive finite number");
  }
  return { ok: errors.length === 0, errors };
}

/** Type-guard für Script-Items aus untrusted JSON. */
export function isValidScriptEntry(s: unknown): s is Script {
  return validateScript(s).ok;
}

// ─── Helpers: Lookup ─────────────────────────────────────────────────────────

function combosEqual(a: KeyCombo, b: KeyCombo): boolean {
  return (
    a.key === b.key &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt &&
    !!a.meta === !!b.meta
  );
}

/**
 * Findet das erste Skript, dessen `keyBinding` zur übergebenen Combo passt.
 * Vergleicht alle 4 Modifier strikt (undefined → false).
 */
export function findScriptByKeyCombo(
  scripts: Script[],
  combo: KeyCombo,
): Script | undefined {
  if (!isValidKeyCombo(combo)) return undefined;
  return scripts.find((s) => s.keyBinding && combosEqual(s.keyBinding, combo));
}

/** Findet das erste Skript mit gebundenem Macro-Button-Index. */
export function findScriptByMacroIndex(
  scripts: Script[],
  idx: number,
): Script | undefined {
  if (!isValidMacroIndex(idx)) return undefined;
  return scripts.find((s) => s.macroButtonIndex === idx);
}

// ─── Persistence Helpers ─────────────────────────────────────────────────────

function loadFromStorage(): Script[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Nur app-scope Scripts können aus localStorage kommen.
    return parsed
      .filter((x): x is Script => isValidScriptEntry(x) && x.scope === "app")
      .slice(0, MAX_SCRIPTS);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    // Nur app-scope Scripts persistieren!
    const appOnly = _scripts.filter((s) => s.scope === "app");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appOnly));
  } catch {
    // Quota voll / nicht verfügbar – ignorieren
  }
}

// ─── Public API: Mutations ──────────────────────────────────────────────────

/**
 * Fügt ein neues Skript hinzu.
 * @throws Error wenn:
 *  - `MAX_SCRIPTS` erreicht ist
 *  - der Code-String > `MAX_SCRIPT_CODE_BYTES` ist
 *  - andere Validierungsfehler vorliegen (siehe `validateScript`)
 * @returns Die generierte ID (Format `sc-<timestamp>-<rand>`)
 */
export function addScript(
  data: Omit<Script, "id" | "createdAt" | "updatedAt">,
): ScriptId {
  if (_scripts.length >= MAX_SCRIPTS) {
    throw new Error(`Maximum number of scripts reached (${MAX_SCRIPTS}).`);
  }
  const now = Date.now();
  const candidate: Script = {
    id: makeScriptId(),
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  const check = validateScript(candidate);
  if (!check.ok) {
    throw new Error(`Invalid script: ${check.errors.join("; ")}`);
  }
  _scripts = [..._scripts, candidate];
  if (candidate.scope === "app") persist();
  notify();
  return candidate.id;
}

/** Entfernt ein Script per ID. No-op wenn ID unbekannt. */
export function removeScript(id: ScriptId): void {
  const next = _scripts.filter((s) => s.id !== id);
  if (next.length === _scripts.length) return;
  const removed = _scripts.find((s) => s.id === id);
  _scripts = next;
  if (removed?.scope === "app") persist();
  notify();
}

/**
 * Patcht ein Script. `id` und `createdAt` können NICHT überschrieben werden.
 * `updatedAt` wird automatisch auf Date.now() gesetzt.
 * No-op wenn ID unbekannt oder Resultat invalid.
 */
export function updateScript(
  id: ScriptId,
  patch: Partial<Omit<Script, "id" | "createdAt">>,
): void {
  const idx = _scripts.findIndex((s) => s.id === id);
  if (idx < 0) return;
  // id/createdAt schützen
  const safePatch: Partial<Script> = { ...patch };
  delete (safePatch as { id?: ScriptId }).id;
  delete (safePatch as { createdAt?: number }).createdAt;
  const merged: Script = {
    ..._scripts[idx],
    ...safePatch,
    updatedAt: Date.now(),
  };
  const check = validateScript(merged);
  if (!check.ok) {
    // Patch wird abgelehnt — Aufrufer muss validateScript vorher prüfen,
    // wenn er sicher mutieren will. Wir crashen hier nicht.
    return;
  }
  const wasApp = _scripts[idx].scope === "app";
  _scripts = [..._scripts.slice(0, idx), merged, ..._scripts.slice(idx + 1)];
  if (wasApp || merged.scope === "app") persist();
  notify();
}

// ─── Public API: Reads ──────────────────────────────────────────────────────

export function getScript(id: ScriptId): Script | null {
  return _scripts.find((s) => s.id === id) ?? null;
}

export function getAllScripts(): Script[] {
  return _scripts.slice();
}

export function getProjectScripts(): Script[] {
  return _scripts.filter((s) => s.scope === "project");
}

export function getAppScripts(): Script[] {
  return _scripts.filter((s) => s.scope === "app");
}

// ─── Public API: Project-Load-Pipeline ──────────────────────────────────────

/**
 * Lädt project-scope Scripts (aus .synth) in den Store.
 *
 * - Ersetzt alle bestehenden scope==="project" Scripts
 * - App-scope Scripts (localStorage) bleiben unangetastet
 * - localStorage wird NICHT verändert (project-scope Items werden niemals
 *   persistiert; sie wandern nur durch die `.synth`-Datei)
 * - Filtert invalide Items, cappt auf MAX_SCRIPTS (zusammen mit app-scope)
 */
export function loadProjectScripts(scripts: Script[]): void {
  const validProject = (scripts ?? []).filter(
    (s): s is Script => isValidScriptEntry(s) && s.scope === "project",
  );
  const appScripts = _scripts.filter((s) => s.scope === "app");
  const capRemaining = Math.max(0, MAX_SCRIPTS - appScripts.length);
  _scripts = [...appScripts, ...validProject.slice(0, capRemaining)];
  // persist() ist nicht nötig: nur app-scope wird gespeichert und der hat
  // sich nicht geändert. Trotzdem aufrufen schadet nicht (idempotent).
  notify();
}

/** Entfernt alle scope==="project" Scripts aus dem Speicher (kein .synth-Touch). */
export function clearProjectScripts(): void {
  const before = _scripts.length;
  _scripts = _scripts.filter((s) => s.scope !== "project");
  if (_scripts.length !== before) notify();
}

/**
 * Markiert alle scope==="project" Scripts als `enabled: false`.
 * Wird beim Laden eines fremden Projekts aufgerufen, damit Code
 * niemals ohne User-Consent läuft.
 */
export function disableAllForeignProject(): void {
  let changed = false;
  _scripts = _scripts.map((s) => {
    if (s.scope === "project" && s.enabled) {
      changed = true;
      return { ...s, enabled: false, updatedAt: Date.now() };
    }
    return s;
  });
  if (changed) notify();
}

/**
 * Reset für Tests. Nicht für Produktiv-Code.
 * @internal
 */
export function __resetForTests(): void {
  _scripts = [];
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export interface ScriptStoreApi {
  scripts: Script[];
  addScript: (data: Omit<Script, "id" | "createdAt" | "updatedAt">) => ScriptId;
  removeScript: (id: ScriptId) => void;
  updateScript: (id: ScriptId, patch: Partial<Omit<Script, "id" | "createdAt">>) => void;
  getScript: (id: ScriptId) => Script | null;
}

export function useScriptStore(): ScriptStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    scripts: _scripts,
    addScript,
    removeScript,
    updateScript,
    getScript,
  };
}
