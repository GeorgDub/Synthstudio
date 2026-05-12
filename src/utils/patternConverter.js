/**
 * Converts the pattern from the algorithmic generator format to the format
 * expected by the DrumMachine store and the 'pattern-generator:apply' event.
 *
 * @param {import('../generation/data-structures.js').Pattern} generatorPattern
 * @param {number} totalSteps - The total number of steps in the target pattern (e.g., 64).
 * @param {number} bpm - The BPM to include in the event detail.
 * @returns {{bpm: number, parts: Array<{name: string, steps: Array<{active: boolean, velocity: number}>}>}}
 */
export function convertGeneratorPatternToDmState(generatorPattern, totalSteps, bpm) {
  const parts = [];

  for (const trackName in generatorPattern) {
    const trackData = generatorPattern[trackName];
    const steps = Array.from({ length: totalSteps }, () => ({ active: false, velocity: 0 }));

    for (const note of trackData) {
      const stepIndex = Math.floor(note.tick);
      if (stepIndex >= 0 && stepIndex < totalSteps) {
        // If a step is already active, prefer the note with higher velocity
        if (!steps[stepIndex].active || note.velocity > steps[stepIndex].velocity) {
          steps[stepIndex].active = true;
          steps[stepIndex].velocity = note.velocity;
        }
      }
    }

    parts.push({
      name: trackName,
      steps: steps,
    });
  }

  return {
    bpm,
    parts,
  };
}
