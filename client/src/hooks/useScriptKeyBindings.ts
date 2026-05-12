/**
 * Synthstudio – useScriptKeyBindings
 *
 * Globaler Keydown-Listener für Skript-Trigger.
 * Mirror des Patterns aus useGlobalKeyBindings.ts, aber für `useScriptStore`-
 * Einträge mit `keyBinding`-Combo statt für die fixen ACTIONS.
 *
 * ─── Konflikt-Auflösung ──────────────────────────────────────────────────────
 * Reihenfolge: **action wins, script loses**.
 *
 * Begründung: ACTIONS sind die First-Class Citizens der App (z.B. Space →
 * Play/Stop). Wenn ein User ein Skript an dieselbe Combo bindet, soll das
 * Skript NICHT feuern — sonst überschreibt ein gespeichertes User-Skript
 * Kern-Funktionalität.
 *
 * Implementierung: Bevor wir das Skript via Sandbox triggern, prüfen wir
 * ZUSÄTZLICH ob die Combo eine ACTION trifft (entweder via gesetztem User-
 * Override oder via Default). Wenn ja → no-op (die ACTION wurde schon vom
 * existierenden Listener in useGlobalKeyBindings.ts behandelt).
 *
 * ─── Input-Skip ──────────────────────────────────────────────────────────────
 * Skip in <input>, <textarea> und contentEditable-Elementen — identisch zur
 * Logik in useGlobalKeyBindings.ts, damit Tastatureingaben in Formularen
 * nie Skripte triggern.
 */
import { useEffect } from "react";
import {
  ACTIONS,
  eventToCombo as eventToActionCombo,
  combosMatch as actionCombosMatch,
  type KeyCombo as ActionKeyCombo,
} from "@/hooks/keyboardActionDefs";
import { getAllBindings } from "@/store/useKeyboardBindingsStore";
import {
  findScriptByKeyCombo,
  getAllScripts,
  type Script,
  type KeyCombo as ScriptKeyCombo,
} from "@/store/useScriptStore";
import { scriptSandbox } from "@/sandbox/scriptSandboxInstance";

/**
 * Konvertiert einen KeyboardEvent in die `ScriptKeyCombo`-Form (key-basiert),
 * wie sie in useScriptStore verwendet wird.
 *
 * - `e.key` wird auf lowercase normalisiert (außer Single-Char-Keys wie "ArrowUp"
 *   und Funktionstasten "F1" bleiben unverändert)
 * - Boolean-Modifier als optional gesetzt — nur true wenn aktiv, sonst undefined
 *   (kompatibel zu combosEqual in useScriptStore das undefined ↔ false vergleicht)
 */
export function eventToScriptCombo(e: KeyboardEvent): ScriptKeyCombo {
  // Normalisiere Single-Letter auf lowercase damit Shift+B nicht "B" wird,
  // sondern key="b" + shift=true. Funktionstasten/Spezialkeys bleiben.
  const rawKey = e.key;
  const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
  const combo: ScriptKeyCombo = { key };
  if (e.ctrlKey)  combo.ctrl  = true;
  if (e.shiftKey) combo.shift = true;
  if (e.altKey)   combo.alt   = true;
  if (e.metaKey)  combo.meta  = true;
  return combo;
}

// ─── Konflikt-Detection (pur, exportiert für Tests) ──────────────────────────

export interface KeyConflict {
  kind: "action" | "script";
  id: string;
}

/**
 * Prüft, ob eine ActionKeyCombo (event.code-basiert) eine ACTION mit
 * gesetztem Override oder Default trifft.
 *
 * @param combo  KeyCombo im keyboardActionDefs-Format ({ code, ctrl, shift, alt })
 * @param actionBindings  Map actionId → KeyCombo override aus useKeyboardBindingsStore
 * @returns actionId wenn eine ACTION matched, sonst null
 */
export function findMatchingAction(
  combo: ActionKeyCombo,
  actionBindings: Record<string, ActionKeyCombo>,
): string | null {
  for (const action of ACTIONS) {
    const target = actionBindings[action.id] ?? action.defaultCombo;
    if (actionCombosMatch(combo, target)) return action.id;
  }
  return null;
}

/**
 * Liefert den ersten Konflikt für eine ScriptKeyCombo:
 *   - kind "action"  → wenn eine ACTION (Override ODER Default) matched
 *   - kind "script"  → wenn kein Action-Match aber ein enabled-Script
 *   - null           → kein Konflikt
 *
 * Reihenfolge: action wird ZUERST geprüft. Wenn beide matchen, gewinnt action.
 *
 * @param actionCombo   Die action-Combo (event.code-basiert) für ACTION-Vergleich
 * @param scriptCombo   Die script-Combo (event.key-basiert) für Script-Vergleich
 * @param scripts       Alle Scripts (Filtering nach enabled erfolgt hier)
 * @param actionBindings User-Overrides aus useKeyboardBindingsStore
 */
export function findKeyConflict(
  actionCombo: ActionKeyCombo,
  scriptCombo: ScriptKeyCombo,
  scripts: Script[],
  actionBindings: Record<string, ActionKeyCombo>,
): KeyConflict | null {
  const actionId = findMatchingAction(actionCombo, actionBindings);
  if (actionId !== null) {
    return { kind: "action", id: actionId };
  }
  const script = findScriptByKeyCombo(
    scripts.filter((s) => s.enabled && s.keyBinding !== undefined),
    scriptCombo,
  );
  if (script) {
    return { kind: "script", id: script.id };
  }
  return null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useScriptKeyBindings(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      // Combo in BEIDEN Welten konstruieren (action: code-basiert,
      // script: key-basiert).
      const actionCombo = eventToActionCombo(e);
      const scriptCombo = eventToScriptCombo(e);
      const actionBindings = getAllBindings();
      const allScripts = getAllScripts();

      // Konflikt mit ACTION? → useGlobalKeyBindings hat die Combo bereits
      // gehandled. Wir feuern KEIN Skript.
      if (findMatchingAction(actionCombo, actionBindings) !== null) {
        return;
      }

      // Kein Action-Konflikt → Script-Suche
      const enabledScripts = allScripts.filter(
        (s) => s.enabled && s.keyBinding !== undefined,
      );
      const script = findScriptByKeyCombo(enabledScripts, scriptCombo);
      if (!script) return;

      e.preventDefault();

      // Wenn die Sandbox bereits läuft → silent skip (kein Re-Entrance).
      if (scriptSandbox.isRunning()) return;

      // Fire-and-forget: das Result loggen wir bewusst NICHT in der Konsole
      // (würde User mit "error in untitled script" Nachrichten zubomben).
      // Nur dann wenn ScriptRunner offen ist und einen onLog-Subscriber
      // registriert, kommt etwas in den UI-Log.
      void scriptSandbox.run(script.code, {
        maxRuntimeMs: script.maxRuntimeMs,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
