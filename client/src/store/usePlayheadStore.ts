/**
 * Synthstudio – usePlayheadStore (TASK-247)
 *
 * Leichter, dedizierter Observer-Store NUR für den Playback-Step (Playhead).
 *
 * Hintergrund: `dm.currentStep` lebt im geteilten useState-Objekt von
 * useDrumMachineStore. Jeder `setCurrentStep` (8-16×/Sekunde während Playback)
 * erzeugt ein neues dm-Objekt und re-rendert die ~4495-Zeilen-DrumMachine
 * komplett. Dieser Store entkoppelt die Playhead-Anzeige davon: er wird
 * von useTransport ZUSÄTZLICH zu dm.setCurrentStep gespeist und nur von
 * kleinen, memoisierten Kind-Komponenten via useSyncExternalStore konsumiert.
 *
 * Bewusst KEIN localStorage — der Playhead ist flüchtiger Laufzeit-State.
 * Muster: Modul-Singleton + Set<Listener>, kompatibel mit useSyncExternalStore.
 */
import { useSyncExternalStore } from "react";

let _step = 0;
const _listeners = new Set<() => void>();

function _notify(): void {
  _listeners.forEach((fn) => fn());
}

// ─── Exportierte Logik-Funktionen ─────────────────────────────────────────────

/** Aktueller Playhead-Step (Snapshot). */
export function getPlayheadStep(): number {
  return _step;
}

/**
 * Setzt den Playhead-Step. No-op (kein notify) wenn der Wert unverändert ist,
 * um redundante Rerenders der abonnierten Kinder zu vermeiden.
 */
export function setPlayheadStep(step: number): void {
  if (step === _step) return;
  _step = step;
  _notify();
}

/** Abonniert Playhead-Änderungen. Gibt eine Unsubscribe-Funktion zurück. */
export function subscribePlayhead(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Test-Hook: setzt den Modul-State zurück. */
export function __resetPlayheadForTests(): void {
  _step = 0;
  _notify();
}

// ─── React Hook ───────────────────────────────────────────────────────────────

/**
 * Abonniert den Playhead-Step. Nur die Komponente, die diesen Hook aufruft,
 * re-rendert bei Step-Änderung — NICHT der DrumMachine-Parent.
 */
export function usePlayheadStep(): number {
  return useSyncExternalStore(subscribePlayhead, getPlayheadStep, getPlayheadStep);
}
