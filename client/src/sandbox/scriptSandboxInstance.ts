/**
 * Synthstudio – scriptSandboxInstance.ts
 *
 * Co-owned by C1 (ScriptRunner) + C2 (useScriptKeyBindings).
 * Contents must match in both PRs — keep this file as the *single* source of
 * truth for the module-scope ScriptSandbox singleton.
 *
 * ─── Was diese Datei macht ───────────────────────────────────────────────────
 * - Hält einen Modul-Singleton der `ScriptSandbox`-Klasse, dessen Bridge zur
 *   Laufzeit mutiert werden kann.
 * - App.tsx ruft `configureSandboxBridge(...)` aus einem `useEffect` heraus
 *   auf, sobald die DI-Targets (AudioEngine-Setter, Store-Setter) verfügbar
 *   sind. Dadurch können beide Konsumenten (ScriptRunner UI + Keyboard-Hook)
 *   den gleichen, korrekt verdrahteten Sandbox-Pfad nutzen.
 * - Wer keinen Bridge-Setter setzt, dessen Methode wirft im Sandbox-Worker
 *   einen "X not available"-Fehler (Default-Deny via Allowlist).
 *
 * Warum kein React-Context? — Die Sandbox muss aus Module-Scope-Code (z.B.
 * dem keydown-Handler in useScriptKeyBindings.ts) erreichbar sein. Ein
 * Context-Provider würde nur in der Render-Tree funktionieren.
 */

import { ScriptSandbox, type SandboxBridge } from "./useScriptSandbox";

// ─── Module-Scope Bridge-Objekt ──────────────────────────────────────────────
//
// Wir teilen das Bridge-Objekt als referenz-konstantes Objekt mit der Sandbox.
// `ScriptSandbox` liest aus `this.bridge.xxx` — wenn wir die Properties hier
// mutieren, sieht die Sandbox die neuen Werte beim nächsten Bridge-Call.

const _bridge: SandboxBridge = {};

/**
 * Setzt/aktualisiert die Bridge-Targets. Übergebene Felder werden
 * übernommen, fehlende bleiben unverändert (Partial-Merge).
 *
 * Wird in App.tsx aus einem useEffect heraus aufgerufen, sobald die
 * Setter (z.B. AudioEngine.setBpm, useDrumMachineStore.toggleStep) stabil
 * sind.
 */
export function configureSandboxBridge(patch: SandboxBridge): void {
  if (patch.setBpm)         _bridge.setBpm = patch.setBpm;
  if (patch.play)           _bridge.play = patch.play;
  if (patch.stop)           _bridge.stop = patch.stop;
  if (patch.setStep)        _bridge.setStep = patch.setStep;
  if (patch.dispatchAction) _bridge.dispatchAction = patch.dispatchAction;
  if (patch.getMacroValue)  _bridge.getMacroValue = patch.getMacroValue;
  if (patch.setMacroValue)  _bridge.setMacroValue = patch.setMacroValue;
}

/**
 * Modul-Singleton. Erste Konstruktion bindet das `_bridge`-Objekt
 * persistent in die Klassen-Instanz — alle späteren Bridge-Updates
 * gehen über `_bridge` und sind sofort sichtbar.
 */
export const scriptSandbox = new ScriptSandbox(_bridge);

/** Test-Hook: Bridge-Zustand inspizieren. */
export function __getSandboxBridgeForTesting(): SandboxBridge {
  return _bridge;
}

/** Test-Hook: Bridge-Felder löschen (für deterministische Tests). */
export function __resetSandboxBridgeForTesting(): void {
  delete _bridge.setBpm;
  delete _bridge.play;
  delete _bridge.stop;
  delete _bridge.setStep;
  delete _bridge.dispatchAction;
  delete _bridge.getMacroValue;
  delete _bridge.setMacroValue;
}
