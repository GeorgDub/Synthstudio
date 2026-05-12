import React, { useState, useMemo, useCallback } from 'react';
import { GeneratorController } from '../../../../src/generation/controller.js';
import MacroControls from './MacroControls.jsx';
import Track from './Track.jsx';
import { exportPatternToMidi } from '../../../../src/generation/midi-export.js';
import { convertGeneratorPatternToDmState } from '../../../../src/utils/patternConverter.js';

// Main component for the Algorithmic Hardtekk Pattern Generator
export default function GeneratorView() {
  // Memoize the controller instance to prevent re-creation on re-renders
  const controller = useMemo(() => new GeneratorController(), []);

  const [pattern, setPattern] = useState(() => controller.getPattern());
  const [mixerState, setMixerState] = useState(() => controller.getMixerState());
  const [generatorState, setGeneratorState] = useState(() => controller.state);

  const regeneratePattern = useCallback(() => {
    setPattern(controller.generatePattern());
  }, [controller]);

  const handleStateChange = useCallback((key, value) => {
    if (key === 'seed') controller.setSeed(value);
    if (key === 'globalChaos') controller.setGlobalChaos(value);
    if (key === 'patternLength') controller.setPatternLength(value);
    setGeneratorState({ ...controller.state });
    regeneratePattern();
  }, [controller, regeneratePattern]);

  const handleTrackControlChange = useCallback((track, control, value) => {
    controller.setTrackControl(track, control, value);
    setGeneratorState({ ...controller.state });
    regeneratePattern();
  }, [controller, regeneratePattern]);
  
  const handleMixerChange = useCallback((track, control, value) => {
    if (control === 'volume') controller.setVolume(track, value);
    if (control === 'pan') controller.setPan(track, value);
    if (control === 'mute') controller.setMute(track, value);
    if (control === 'solo') controller.setSolo(track, value);
    setMixerState({ ...controller.getMixerState() });
  }, [controller]);

  const handleBakeToMidi = () => {
    const midiData = exportPatternToMidi(pattern);
    const blob = new Blob([midiData], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generated-pattern.mid';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyPattern = () => {
    const totalSteps = generatorState.patternLength * 16;
    // We need a BPM value. Let's assume a default of 140 for Hardtekk, or get it from somewhere.
    // For now, a fixed value is fine for the event.
    const bpm = 140; 
    const dmState = convertGeneratorPatternToDmState(pattern, totalSteps, bpm);
    
    window.dispatchEvent(
      new CustomEvent("pattern-generator:apply", { detail: dmState })
    );
    alert("Pattern wurde in den Sequencer übernommen!");
  };

  return (
    <div className="generator-view p-4 bg-bg-base text-text-primary font-sans">
      <h2 className="text-2xl font-bold mb-4 text-text-primary">Algorithmic Pattern Generator</h2>
      
      <MacroControls
        state={generatorState}
        onStateChange={handleStateChange}
        onBakeToMidi={handleBakeToMidi}
        onApplyPattern={handleApplyPattern}
      />

      <div className="tracks-container mt-4 space-y-2">
        {Object.keys(pattern).map(trackName => (
          <Track
            key={trackName}
            trackName={trackName}
            trackData={pattern[trackName]}
            mixerChannel={mixerState[trackName]}
            trackControls={generatorState.trackControls[trackName]}
            onMixerChange={handleMixerChange}
            onTrackControlChange={handleTrackControlChange}
            patternLength={generatorState.patternLength * 16}
          />
        ))}
      </div>
    </div>
  );
}
