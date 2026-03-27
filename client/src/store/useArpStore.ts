import { useEffect, useReducer } from "react";
import { type ArpMode, type ArpOctaves, type ArpStep, applyArp } from "../utils/arpeggiator";

interface ArpState {
  enabled: boolean;
  mode: ArpMode;
  octaves: ArpOctaves;
  notes: number[];
  stepCount: number;
}

type Listener = () => void;

let _state: ArpState = {
  enabled: false,
  mode: "up",
  octaves: 1,
  notes: [60, 64, 67],
  stepCount: 16,
};

const _listeners = new Set<Listener>();
function notify(): void { _listeners.forEach((l) => l()); }

export function setArpEnabled(enabled: boolean): void { _state = { ..._state, enabled }; notify(); }
export function setArpMode(mode: ArpMode): void { _state = { ..._state, mode }; notify(); }
export function setArpOctaves(octaves: ArpOctaves): void { _state = { ..._state, octaves }; notify(); }
export function setArpNotes(notes: number[]): void { _state = { ..._state, notes }; notify(); }
export function setArpStepCount(stepCount: number): void { _state = { ..._state, stepCount }; notify(); }

export function getArpSteps(): ArpStep[] {
  return applyArp({
    notes: _state.notes,
    mode: _state.mode,
    octaves: _state.octaves,
    stepCount: _state.stepCount,
  });
}

export function __resetArpForTests(): void {
  _state = { enabled: false, mode: "up", octaves: 1, notes: [60, 64, 67], stepCount: 16 };
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
