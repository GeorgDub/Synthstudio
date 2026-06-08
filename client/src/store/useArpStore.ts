import { useEffect, useReducer } from "react";
import { type ArpMode, type ArpOctaves, type ArpOutputMode, type ArpStep, type ArpVelocityPattern, applyArp } from "../utils/arpeggiator";

interface ArpState {
  enabled: boolean;
  mode: ArpMode;
  octaves: ArpOctaves;
  notes: number[];
  stepCount: number;
  velocityPattern: ArpVelocityPattern;
  /** Wohin die Arp-Noten gehen (interner Synth / Channel / MIDI-Out). */
  outputMode: ArpOutputMode;
  /** Ziel-Part-ID für outputMode="channel" (null = noch keiner gewählt). */
  targetPartId: string | null;
}

type Listener = () => void;

let _state: ArpState = {
  enabled: false,
  mode: "up",
  octaves: 1,
  notes: [60, 64, 67],
  stepCount: 16,
  velocityPattern: "flat",
  outputMode: "synth",
  targetPartId: null,
};

const _listeners = new Set<Listener>();
function notify(): void { _listeners.forEach((l) => l()); }

export function setArpEnabled(enabled: boolean): void { _state = { ..._state, enabled }; notify(); }
export function setArpMode(mode: ArpMode): void { _state = { ..._state, mode }; notify(); }
export function setArpOctaves(octaves: ArpOctaves): void { _state = { ..._state, octaves }; notify(); }
export function setArpNotes(notes: number[]): void { _state = { ..._state, notes }; notify(); }
export function setArpStepCount(stepCount: number): void { _state = { ..._state, stepCount }; notify(); }
export function setArpVelocityPattern(velocityPattern: ArpVelocityPattern): void { _state = { ..._state, velocityPattern }; notify(); }
export function setArpOutputMode(outputMode: ArpOutputMode): void { _state = { ..._state, outputMode }; notify(); }
export function setArpTargetPartId(targetPartId: string | null): void { _state = { ..._state, targetPartId }; notify(); }

export function getArpSteps(): ArpStep[] {
  return applyArp({
    notes: _state.notes,
    mode: _state.mode,
    octaves: _state.octaves,
    stepCount: _state.stepCount,
    velocityPattern: _state.velocityPattern,
  });
}

const DEFAULT_ARP_STATE: ArpState = {
  enabled: false, mode: "up", octaves: 1, notes: [60, 64, 67],
  stepCount: 16, velocityPattern: "flat", outputMode: "synth", targetPartId: null,
};

/**
 * Produktions-Reset (v3.270): setzt den Arp auf Defaults zurück, OHNE Listener
 * zu entfernen — gemounteten Komponenten re-rendern. Wird von "Neues Projekt"
 * (doFullProjectReset) aufgerufen; vorher leckte der Arp-State ins neue Projekt.
 */
export function resetArp(): void {
  _state = { ...DEFAULT_ARP_STATE };
  notify();
}

export function __resetArpForTests(): void {
  _state = { ...DEFAULT_ARP_STATE };
  _listeners.clear();
}

export function getArpState(): ArpState {
  return _state;
}

export function useArpStore(): ArpState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
