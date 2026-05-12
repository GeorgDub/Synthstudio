import React from 'react';

export default function StepGrid({ trackData, numSteps }) {
  // Create a map for quick lookup of notes at a given step
  const noteMap = new Map();
  for (const note of trackData) {
    const step = Math.floor(note.tick);
    if (!noteMap.has(step)) {
      noteMap.set(step, []);
    }
    noteMap.get(step).push(note);
  }

  return (
    <div className="step-grid grid grid-cols-32 gap-1 w-full">
      {Array.from({ length: numSteps }).map((_, i) => {
        const notesOnStep = noteMap.get(i);
        const isBeat = i % 4 === 0;
        const isSubBeat = i % 2 === 0;

        let bgColor = 'bg-bg-elevated';
        if (isBeat) bgColor = 'bg-bg-elevated';
        else if (isSubBeat) bgColor = 'bg-bg-elevated/70';

        if (notesOnStep) {
          // Simple visualization: color based on velocity
          const maxVelocity = Math.max(...notesOnStep.map(n => n.velocity));
          const opacity = Math.max(0.3, maxVelocity / 127);
          return (
            <div
              key={i}
              className={`step h-10 rounded ${bgColor} relative`}
              title={`Step ${i + 1}, Vel: ${maxVelocity}`}
            >
                <div className="w-full h-full bg-accent-secondary rounded" style={{ opacity }} />
            </div>
          );
        }

        return (
          <div
            key={i}
            className={`step h-10 rounded ${bgColor}`}
            title={`Step ${i + 1}`}
          />
        );
      })}
    </div>
  );
}
