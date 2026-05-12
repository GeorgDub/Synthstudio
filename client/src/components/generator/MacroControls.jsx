import React from 'react';

export default function MacroControls({ state, onStateChange, onBakeToMidi, onApplyPattern }) {
  return (
    <div className="macro-controls p-3 bg-bg-elevated rounded-lg flex items-center space-x-4 border border-border-color">
      <button
        className="px-4 py-2 bg-accent-primary hover:opacity-80 text-white rounded font-bold transition-opacity"
        onClick={() => onStateChange('seed', Date.now())}
      >
        🎲 Generate
      </button>

      <div className="flex items-center space-x-2">
        <label htmlFor="patternLength" className="text-text-muted text-sm">Length (Bars):</label>
        <select
          id="patternLength"
          className="bg-bg-panel border border-border-color rounded px-2 py-1 text-text-primary text-sm"
          value={state.patternLength}
          onChange={(e) => onStateChange('patternLength', parseInt(e.target.value, 10))}
        >
          {[1, 2, 4, 8].map(len => <option key={len} value={len}>{len}</option>)}
        </select>
      </div>

      <div className="flex items-center space-x-2 w-48">
        <label htmlFor="globalChaos" className="text-text-muted text-sm whitespace-nowrap">Chaos:</label>
        <input
          type="range"
          id="globalChaos"
          min="0"
          max="1"
          step="0.01"
          className="w-full accent-accent-secondary"
          value={state.globalChaos}
          onChange={(e) => onStateChange('globalChaos', parseFloat(e.target.value))}
        />
        <span className="text-text-muted text-sm">{Math.round(state.globalChaos * 100)}%</span>
      </div>

      <div className="flex-grow" />

      <button
        className="px-4 py-2 bg-accent-primary hover:opacity-80 text-white rounded font-bold transition-opacity"
        onClick={onApplyPattern}
      >
        Übernehmen
      </button>

      <button
        className="px-4 py-2 bg-accent-success hover:opacity-80 text-white rounded font-bold transition-opacity"
        onClick={onBakeToMidi}
      >
        Bake to MIDI
      </button>
    </div>
  );
}
