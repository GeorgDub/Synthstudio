import { GeneratorController } from './controller.js';
import { exportPatternToMidi } from './midi-export.js';
import * as fs from 'fs';
import * as path from 'path';

// This is a simple test script to verify the generator's functionality.
// To run it: `node src/generation/test.js`

console.log('--- Starting Hardtekk Pattern Generator Test ---');

// 1. Initialize the controller
const controller = new GeneratorController();

// 2. Generate a base pattern
let pattern = controller.generatePattern();
console.log('\n--- Initial Pattern Tracks ---');
console.log(Object.keys(pattern).join(', '));

// 3. Demonstrate Beat Slicer functionality
console.log('\n--- Beat Slicer Test ---');
const slicedAudio = controller.sliceAudioAndGeneratePattern('/path/to/my/loop.wav', 16);

if (slicedAudio) {
    console.log('Sliced Audio Info:', {
        filePath: slicedAudio.filePath,
        duration: slicedAudio.duration,
        sliceCount: slicedAudio.slices.length
    });
}

// Get the updated pattern
pattern = controller.getPattern();
console.log('\n--- Pattern Tracks After Slicing ---');
console.log(Object.keys(pattern).join(', '));

console.log('\n--- Sliced Track Content ---');
const slicedTrackName = Object.keys(pattern).find(k => k.startsWith('slices_'));
if (slicedTrackName) {
    console.log(pattern[slicedTrackName]);
}


// 4. Export the final pattern to a MIDI file
const midiData = exportPatternToMidi(pattern);
const outputPath = path.resolve(process.cwd(), 'generated-pattern-with-slices.mid');
try {
  fs.writeFileSync(outputPath, midiData);
  console.log(`\nSuccessfully generated and saved MIDI file with slices to: ${outputPath}`);
} catch (error) {
  console.error(`\nError writing MIDI file: ${error.message}`);
}

console.log('\n--- Test Finished ---');
