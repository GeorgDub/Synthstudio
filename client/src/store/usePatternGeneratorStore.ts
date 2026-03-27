import { useEffect, useReducer } from "react";
import { type Genre, type GeneratedPattern, generatePattern } from "../utils/patternGenerator";

interface PatternGeneratorState {
  selectedGenre: Genre;
  complexity: number;
  lastGenerated: GeneratedPattern | null;
  isGenerating: boolean;
}

type Listener = () => void;

let _state: PatternGeneratorState = {
  selectedGenre: "techno",
  complexity: 0.5,
  lastGenerated: null,
  isGenerating: false,
};

const _listeners = new Set<Listener>();
function notify(): void { _listeners.forEach((l) => l()); }

export function setGenre(genre: Genre): void {
  _state = { ..._state, selectedGenre: genre };
  notify();
}

export function setComplexity(complexity: number): void {
  _state = { ..._state, complexity: Math.max(0, Math.min(1, complexity)) };
  notify();
}

export function generateAndStore(): void {
  _state = { ..._state, isGenerating: true };
  notify();
  setTimeout(() => {
    const pattern = generatePattern({
      genre: _state.selectedGenre,
      complexity: _state.complexity,
      seed: Math.floor(Math.random() * 0xffffffff),
    });
    _state = { ..._state, lastGenerated: pattern, isGenerating: false };
    notify();
  }, 200);
}

export function clearGenerated(): void {
  _state = { ..._state, lastGenerated: null };
  notify();
}

export function __resetForTests(): void {
  _state = { selectedGenre: "techno", complexity: 0.5, lastGenerated: null, isGenerating: false };
  _listeners.clear();
}

export function getPatternGeneratorState(): PatternGeneratorState {
  return _state;
}

export function usePatternGeneratorStore(): PatternGeneratorState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
