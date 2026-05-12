/**
 * Synthstudio – useMidiStepInput
 *
 * MIDI Step Input: Noten per MIDI-Keyboard step-weise in den Piano Roll eingeben.
 * Wenn aktiv, setzt jede eingehende MIDI-Note im Piano Roll den nächsten Step aktiv
 * und rückt den Cursor automatisch vor.
 *
 * Integration:
 *  - Lauscht auf das bestehende onNoteOn-Event des useMidi-Hooks via CustomEvent
 *  - Schreibt in den useMelodicPartStore
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface UseMidiStepInputOptions {
  partId: string | null;
  stepCount: number;
  enabled: boolean;
}

export function useMidiStepInput({ partId, stepCount, enabled }: UseMidiStepInputOptions) {
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const handleNoteOn = useCallback((note: number, velocity: number) => {
    if (!enabled || !partId) return;

    const step = cursorRef.current;
    // Dispatch ein CustomEvent das MelodicPartStore oder PianoRoll-Modal aufgreift
    window.dispatchEvent(new CustomEvent("stepinput:note", {
      detail: { partId, stepIndex: step, note, velocity },
    }));

    // Cursor vorrücken (wrap-around)
    const next = (step + 1) % stepCount;
    setCursor(next);
    cursorRef.current = next;
  }, [enabled, partId, stepCount]);

  // Lauscht auf MIDI NoteOn via CustomEvent (von useMidi dispatched)
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: Event) => {
      const { note, velocity } = (e as CustomEvent<{ note: number; velocity: number }>).detail;
      handleNoteOn(note, velocity);
    };

    window.addEventListener("stepinput:noteon", handler);
    return () => window.removeEventListener("stepinput:noteon", handler);
  }, [enabled, handleNoteOn]);

  const resetCursor = useCallback(() => setCursor(0), []);
  const moveCursor  = useCallback((delta: number) => {
    setCursor(prev => ((prev + delta) % stepCount + stepCount) % stepCount);
  }, [stepCount]);

  return { cursor, resetCursor, moveCursor };
}
