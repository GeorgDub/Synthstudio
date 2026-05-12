/**
 * Synthstudio – useGlobalKeyBindings
 *
 * Globaler Keydown-Listener der konfigurierbare Actions als CustomEvents dispatcht.
 * Andere Komponenten (App.tsx) hören auf "kb:action" und reagieren darauf.
 *
 * Belegungsreihenfolge: user-override > default combo.
 * Pad-Tasten (Q-K, Z-,, 1-8) werden NIE durch diesen Hook abgefangen
 * (das macht weiterhin useKeyboardShortcuts).
 */
import { useEffect } from "react";
import { ACTIONS, eventToCombo, combosMatch } from "./keyboardActionDefs";
import { getAllBindings } from "@/store/useKeyboardBindingsStore";

export const KB_ACTION_EVENT = "kb:action";

export function useGlobalKeyBindings(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Keine Action in Eingabefeldern
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) return;

      const pressed = eventToCombo(e);
      const overrides = getAllBindings();

      for (const action of ACTIONS) {
        const combo = overrides[action.id] ?? action.defaultCombo;
        if (combosMatch(pressed, combo)) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(KB_ACTION_EVENT, { detail: action.id }));
          return; // Nur eine Action pro Keystroke
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
