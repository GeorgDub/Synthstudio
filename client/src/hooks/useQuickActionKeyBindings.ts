/**
 * Synthstudio – useQuickActionKeyBindings (v3.68.0)
 *
 * Globaler Keydown-Listener für Quick-Action Macros (useQuickActionStore).
 *
 * Pattern analog zu useScriptKeyBindings.ts:
 *   - Skip in <input>, <textarea>, contentEditable
 *   - Konflikt-Check: ACTION wins (kein Trigger wenn Combo eine
 *     System-ACTION trifft).
 *
 * Aufruf: App.tsx wrappt den Hook mit einem konkretem QuickActionContext
 * (gebunden an den realen DrumMachine + Mixer + Scene + Performance Store).
 */
import { useEffect } from "react";
import {
  ACTIONS,
  eventToCombo as eventToActionCombo,
  combosMatch as actionCombosMatch,
} from "@/hooks/keyboardActionDefs";
import { getAllBindings } from "@/store/useKeyboardBindingsStore";
import {
  getQuickActionMacros,
  eventToKeybind,
  findMacroForKeybind,
} from "@/store/useQuickActionStore";
import {
  executeQuickActionMacro,
  type QuickActionContext,
} from "@/utils/quickActionExecutor";

/**
 * Prüft ob die gegebene action-Combo eine System-ACTION (mit Override oder
 * Default) trifft. Pure-Helper, exportiert für Tests.
 */
export function isActionCombo(e: KeyboardEvent): boolean {
  const combo = eventToActionCombo(e);
  const bindings = getAllBindings();
  for (const action of ACTIONS) {
    const target = bindings[action.id] ?? action.defaultCombo;
    if (actionCombosMatch(combo, target)) return true;
  }
  return false;
}

export function useQuickActionKeyBindings(
  context: QuickActionContext,
  enabled: boolean = true,
): void {
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

      // ACTION-Konflikt → System-ACTIONs gewinnen.
      if (isActionCombo(e)) return;

      const keybind = eventToKeybind(e);
      const macro = findMacroForKeybind(getQuickActionMacros(), keybind);
      if (!macro) return;

      e.preventDefault();
      // Fire-and-forget; Promise wird absichtlich nicht awaited (Listener
      // muss synchron returnen).
      void executeQuickActionMacro(macro, context);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [context, enabled]);
}
