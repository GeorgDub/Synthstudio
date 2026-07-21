/**
 * Synthstudio — useE2sPresetStore
 *
 * IFX-Preset- & Groove-Template-Manager über hacktribe-RAM-SysEx (0x52/0x54).
 * Reuse der Verbindung aus useE2sDeviceStore (getE2sBridge()).
 *
 * SICHERHEIT (bewusst blob-only): wir kennen das *interne* Feld-Layout eines
 * IFX-Presets (0x20C) / Groove-Templates (0x140) NICHT — das liegt in
 * hacktribe-editor. Deshalb schreiben wir NUR Bytes zurück, die zuvor VOM GERÄT
 * gelesen wurden (Backup/Copy/Restore). Nie hand-authored Bytes → kein
 * "falsches Layout"-Risiko. Writes sind zusätzlich per Bridge auf die IFX/Groove-
 * Adressbereiche begrenzt und bei laufendem Sequencer geblockt. RAM → Power-
 * Cycle stellt wieder her.
 */
import { useEffect, useReducer } from "react";
import { getE2sBridge } from "./useE2sDeviceStore";

export type PresetKind = "ifx" | "groove";

export interface PresetBackup {
  kind: PresetKind;
  index: number;
  bytes: Uint8Array;
  /** Monoton steigende Capture-ID (stabiler React-Key). */
  id: number;
}

export interface E2sPresetState {
  ifxCount: number | null;
  grooveCount: number | null;
  backups: PresetBackup[];
  busy: boolean;
  error: string | null;
  lastAction: string | null;
}

function defaultState(): E2sPresetState {
  return {
    ifxCount: null,
    grooveCount: null,
    backups: [],
    busy: false,
    error: null,
    lastAction: null,
  };
}

let _state: E2sPresetState = defaultState();
let _nextId = 1;
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach(fn => fn());
}
function set(patch: Partial<E2sPresetState>): void {
  _state = { ..._state, ...patch };
  notify();
}

export function getE2sPresetState(): E2sPresetState {
  return _state;
}

async function withBridge<T>(
  action: string,
  fn: (b: NonNullable<ReturnType<typeof getE2sBridge>>) => Promise<T>
): Promise<T | null> {
  const bridge = getE2sBridge();
  if (!bridge) {
    set({ error: "Kein Gerät verbunden" });
    return null;
  }
  set({ busy: true, error: null, lastAction: action });
  try {
    const r = await fn(bridge);
    set({ busy: false });
    return r;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Liest die aktuellen IFX-/Groove-Preset-Zähler vom Gerät. */
export async function refreshE2sPresetCounts(): Promise<void> {
  await withBridge("counts", async b => {
    const ifxCount = await b.readIfxCount();
    const grooveCount = await b.readGrooveCount();
    set({ ifxCount, grooveCount });
  });
}

function pushBackup(kind: PresetKind, index: number, bytes: Uint8Array): void {
  const backup: PresetBackup = { kind, index, bytes, id: _nextId++ };
  set({ backups: [..._state.backups, backup] });
}

/** Liest einen Preset-Slot und legt ihn als Backup ab. */
export async function captureE2sPreset(
  kind: PresetKind,
  index: number
): Promise<void> {
  await withBridge(`capture ${kind} ${index}`, async b => {
    const bytes =
      kind === "ifx"
        ? await b.readIfxPreset(index)
        : await b.readGrooveTemplate(index);
    pushBackup(kind, index, bytes);
  });
}

/** Kopiert einen Preset-Slot auf einen anderen (device-sourced Bytes → sicher). */
export async function copyE2sPreset(
  kind: PresetKind,
  from: number,
  to: number
): Promise<void> {
  if (from === to) return;
  await withBridge(`copy ${kind} ${from}→${to}`, async b => {
    if (kind === "ifx") {
      await b.writeIfxPreset(to, await b.readIfxPreset(from));
    } else {
      await b.writeGrooveTemplate(to, await b.readGrooveTemplate(from));
    }
  });
}

/** Schreibt ein gespeichertes Backup in einen (evtl. anderen) Slot zurück. */
export async function restoreE2sBackup(
  backupId: number,
  toIndex: number
): Promise<void> {
  const backup = _state.backups.find(x => x.id === backupId);
  if (!backup) {
    set({ error: `Backup ${backupId} nicht gefunden` });
    return;
  }
  await withBridge(`restore ${backup.kind} → ${toIndex}`, async b => {
    if (backup.kind === "ifx") await b.writeIfxPreset(toIndex, backup.bytes);
    else await b.writeGrooveTemplate(toIndex, backup.bytes);
  });
}

export function removeE2sBackup(backupId: number): void {
  set({ backups: _state.backups.filter(x => x.id !== backupId) });
}
export function clearE2sBackups(): void {
  set({ backups: [] });
}

/** Test-Hook. */
export function __resetE2sPresetForTests(): void {
  _state = defaultState();
  _nextId = 1;
  notify();
}

// ─── React Hook ────────────────────────────────────────────────────────────────
export interface E2sPresetStoreApi extends E2sPresetState {
  refreshCounts: () => Promise<void>;
  capture: (kind: PresetKind, index: number) => Promise<void>;
  copy: (kind: PresetKind, from: number, to: number) => Promise<void>;
  restore: (backupId: number, toIndex: number) => Promise<void>;
  removeBackup: (backupId: number) => void;
  clearBackups: () => void;
}

export function useE2sPresetStore(): E2sPresetStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    ..._state,
    refreshCounts: refreshE2sPresetCounts,
    capture: captureE2sPreset,
    copy: copyE2sPreset,
    restore: restoreE2sBackup,
    removeBackup: removeE2sBackup,
    clearBackups: clearE2sBackups,
  };
}
