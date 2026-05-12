import React from 'react';

export default function TrackMicroControls({ trackName, controls, onChange }) {
  return (
    <div className="track-micro-controls mt-2 space-y-1 text-xs">
      {[
        { key: 'density',       label: 'Density' },
        { key: 'mutation',      label: 'Mutation' },
        { key: 'velocitySpread',label: 'Vel.Spread' },
      ].map(({ key, label }) => controls[key] !== undefined && (
        <div key={key} className="flex items-center space-x-2">
          <label className="w-20 text-text-dim">{label}:</label>
          <input
            type="range" min="0" max="1" step="0.01"
            className="w-full accent-accent-primary"
            value={controls[key]}
            onChange={(e) => onChange(trackName, key, parseFloat(e.target.value))}
          />
          <span className="text-text-dim w-8 text-right">{Math.round(controls[key] * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
