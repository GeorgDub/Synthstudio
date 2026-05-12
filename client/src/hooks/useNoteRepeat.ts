/**
 * Synthstudio – useNoteRepeat
 *
 * Live-Pad-Player mit Note-Repeat (MPC-Style).
 * Wenn Note-Repeat aktiv ist und ein Pad gedrückt wird, retriggert
 * der Hook das `trigger`-Callback alle `rateToIntervalMs(rate, bpm)` ms,
 * bis der Pad wieder losgelassen wird.
 *
 * Falls Note-Repeat deaktiviert ist, wird der Trigger genau einmal ausgelöst.
 */
import { useCallback, useEffect, useRef } from "react";
import { useNoteRepeatStore } from "@/store/useNoteRepeatStore";
import { safeIntervalMs } from "@/utils/noteRepeat";

export interface UseNoteRepeatOptions {
  /** Wird bei jedem Trigger aufgerufen (Pad-Down + jeder Repeat-Tick). */
  trigger: (padId: string) => void;
  /** Aktuelles BPM, beeinflusst Repeat-Intervall. */
  bpm: number;
}

export interface UseNoteRepeatApi {
  padDown: (padId: string) => void;
  padUp: (padId: string) => void;
  /** Stoppt alle aktiven Repeats (z.B. bei Unmount oder Disable). */
  stopAll: () => void;
}

export function useNoteRepeat({ trigger, bpm }: UseNoteRepeatOptions): UseNoteRepeatApi {
  const { enabled, rate } = useNoteRepeatStore();
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  const stopAll = useCallback(() => {
    intervalsRef.current.forEach((id) => clearInterval(id));
    intervalsRef.current.clear();
  }, []);

  const padUp = useCallback((padId: string) => {
    const id = intervalsRef.current.get(padId);
    if (id !== undefined) {
      clearInterval(id);
      intervalsRef.current.delete(padId);
    }
  }, []);

  const padDown = useCallback(
    (padId: string) => {
      // Immer sofort triggern (auch wenn Note-Repeat aus ist)
      triggerRef.current(padId);

      if (!enabled) return;

      // Falls bereits ein Interval für diesen Pad läuft: alten aufräumen
      const existing = intervalsRef.current.get(padId);
      if (existing !== undefined) clearInterval(existing);

      const ms = safeIntervalMs(rate, bpm);
      const intervalId = setInterval(() => {
        triggerRef.current(padId);
      }, ms);
      intervalsRef.current.set(padId, intervalId);
    },
    [enabled, rate, bpm]
  );

  // Wenn Note-Repeat global deaktiviert wird → laufende Repeats stoppen
  useEffect(() => {
    if (!enabled) {
      stopAll();
    }
  }, [enabled, stopAll]);

  // Wenn Rate oder BPM sich ändern: laufende Intervals abräumen.
  // Sie laufen sonst mit dem alten Intervall weiter, bis der Nutzer den
  // Pad loslässt – inkonsistent mit der gerade gewählten Rate.
  useEffect(() => {
    stopAll();
  }, [rate, bpm, stopAll]);

  // Aufräumen beim Unmount
  useEffect(() => {
    return stopAll;
  }, [stopAll]);

  return { padDown, padUp, stopAll };
}
