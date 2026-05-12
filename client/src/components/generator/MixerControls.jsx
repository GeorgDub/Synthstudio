import React from 'react';

export default function MixerControls({ trackName, channel, onChange }) {
  return (
    <div className="mixer-controls mt-2 space-y-2 text-xs">
      <div className="flex items-center space-x-2">
        <label className="w-10 text-text-muted">Vol:</label>
        <input type="range" min="0" max="1.5" step="0.01"
          className="w-full accent-accent-primary" value={channel.volume}
          onChange={(e) => onChange(trackName, 'volume', parseFloat(e.target.value))} />
        <span className="text-text-dim w-8 text-right">{Math.round(channel.volume * 100)}%</span>
      </div>
      <div className="flex items-center space-x-2">
        <label className="w-10 text-text-muted">Pan:</label>
        <input type="range" min="-1" max="1" step="0.01"
          className="w-full accent-accent-secondary" value={channel.pan}
          onChange={(e) => onChange(trackName, 'pan', parseFloat(e.target.value))} />
        <span className="text-text-dim w-4">{channel.pan > 0 ? 'R' : channel.pan < 0 ? 'L' : 'C'}</span>
      </div>
      <div className="flex space-x-1">
        <button
          className={"px-2 py-0.5 text-xs rounded border transition-colors " + (
            channel.mute
              ? 'bg-accent-danger/20 border-accent-danger text-accent-danger'
              : 'bg-bg-elevated border-border-color text-text-dim hover:text-text-primary'
          )}
          onClick={() => onChange(trackName, 'mute', !channel.mute)}
        >Mute</button>
        <button
          className={"px-2 py-0.5 text-xs rounded border transition-colors " + (
            channel.solo
              ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
              : 'bg-bg-elevated border-border-color text-text-dim hover:text-text-primary'
          )}
          onClick={() => onChange(trackName, 'solo', !channel.solo)}
        >Solo</button>
      </div>
    </div>
  );
}
