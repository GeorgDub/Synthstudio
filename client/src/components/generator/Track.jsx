import React from 'react';
import MixerControls from './MixerControls.jsx';
import StepGrid from './StepGrid.jsx';
import TrackMicroControls from './TrackMicroControls.jsx';

export default function Track({
  trackName,
  trackData,
  mixerChannel,
  trackControls,
  onMixerChange,
  onTrackControlChange,
  patternLength,
}) {
  return (
    <div className="track flex items-center p-2 bg-bg-panel rounded-md border border-border-color hover:border-border-subtle transition-colors">
      <div className="w-1/4">
        <h3 className="text-sm font-semibold capitalize text-text-primary">{trackName}</h3>
        <MixerControls
          trackName={trackName}
          channel={mixerChannel}
          onChange={onMixerChange}
        />
        <TrackMicroControls
            trackName={trackName}
            controls={trackControls}
            onChange={onTrackControlChange}
        />
      </div>
      <div className="w-3/4">
        <StepGrid
          trackData={trackData}
          numSteps={patternLength}
        />
      </div>
    </div>
  );
}
