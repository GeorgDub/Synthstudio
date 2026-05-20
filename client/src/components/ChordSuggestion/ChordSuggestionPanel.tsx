/**
 * Synthstudio – ChordSuggestionPanel.tsx (v3.176.0)
 *
 * Visueller Standalone-Wrapper um den v3.175 randomChordGenerator-Pure-Helper.
 * Liefert eine eigenständige UI-Insel mit Mood- + Root-Controls, Reroll-Button
 * und einer Liste klickbarer Chord-Cards. Funktioniert komplett ohne externe
 * Stores — alle State-Mutationen sind lokal via useState.
 *
 * Wire-Up:
 *  - Embed in DrumMachine, Performance-Mode oder OmniTribe-Editor:
 *    v3.177-Caveat (siehe agents/INDEX.js bugs).
 *  - onChordSelected-Callback ist optional; ohne Callback sind die Cards
 *    disabled + ein Hint wird angezeigt.
 *
 * Public Surface:
 *  - ChordSuggestionPanel (default-exportierbar via named export)
 *  - ChordSuggestionPanelProps
 *
 * Semantic-Theme-Klassen only — keine hardcoded Tailwind-Farben.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  generateRandomChords,
  MOOD_PRESETS,
  midiNoteToName,
  type MoodPreset,
  type GeneratedChord,
} from "@/utils/randomChordGenerator";

export interface ChordSuggestionPanelProps {
  /** Default mood. */
  initialMood?: MoodPreset;
  /** Default root MIDI note. */
  initialRootMidi?: number;
  /** Anzahl Chords. Default 4. */
  count?: number;
  /** Optional: onChordSelected callback wenn User einen Chord klickt. */
  onChordSelected?: (chord: GeneratedChord) => void;
  /** Sichtbar — kontrolliert vom parent. Default true. */
  visible?: boolean;
}

export function ChordSuggestionPanel({
  initialMood = "happy",
  initialRootMidi = 60,
  count = 4,
  onChordSelected,
  visible = true,
}: ChordSuggestionPanelProps): React.ReactElement | null {
  const [mood, setMood] = useState<MoodPreset>(initialMood);
  const [rootMidi, setRootMidi] = useState<number>(initialRootMidi);
  const [seed, setSeed] = useState<number>(1);

  const chords = useMemo(() => {
    return generateRandomChords({ mood, rootMidi, seed, count });
  }, [mood, rootMidi, seed, count]);

  const handleReroll = useCallback(() => {
    setSeed(Date.now());
  }, []);

  if (!visible) return null;

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-3 space-y-2"
      data-testid="chord-suggestion-panel"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">Chord Suggestions</h4>
        <button
          type="button"
          onClick={handleReroll}
          data-testid="chord-suggestion-reroll"
          className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-primary/30 hover:text-accent-primary text-text-muted transition-colors"
          title="Neue Chords generieren"
        >
          🎲 Reroll
        </button>
      </div>

      {/* Mood + Root Controls */}
      <div className="flex items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Mood:</span>
          <select
            value={mood}
            onChange={(e) => setMood(e.target.value as MoodPreset)}
            className="bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-[10px] text-text-muted hover:text-text-primary focus:outline-none"
            data-testid="chord-suggestion-mood"
          >
            {Object.keys(MOOD_PRESETS).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Root:</span>
          <input
            type="range"
            min={48}
            max={72}
            value={rootMidi}
            onChange={(e) => setRootMidi(parseInt(e.target.value, 10))}
            className="w-16 accent-accent-secondary"
            data-testid="chord-suggestion-root"
          />
          <span className="font-mono text-text-muted w-8">{midiNoteToName(rootMidi)}</span>
        </label>
      </div>

      {/* Chord-Cards */}
      <div className="grid grid-cols-2 gap-2" data-testid="chord-suggestion-list">
        {chords.map((chord, idx) => (
          <button
            key={`${chord.rootNote}-${chord.quality}-${idx}`}
            type="button"
            onClick={() => onChordSelected?.(chord)}
            data-testid={`chord-suggestion-card-${idx}`}
            className="flex flex-col gap-0.5 px-2 py-1.5 rounded border border-border-color bg-bg-elevated hover:border-accent-primary hover:bg-accent-primary/10 transition-colors text-left"
            disabled={!onChordSelected}
          >
            <span className="text-xs font-semibold text-text-primary">{chord.name}</span>
            <span className="text-[10px] text-text-dim font-mono">
              {chord.notes.map((n) => midiNoteToName(n)).join(" · ")}
            </span>
          </button>
        ))}
      </div>

      {!onChordSelected && (
        <div className="text-[10px] text-text-dim italic">
          Klick-Apply pending — onChordSelected-Wire ist v3.177-Caveat.
        </div>
      )}
    </div>
  );
}
