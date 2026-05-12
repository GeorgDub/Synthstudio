import { Generator } from './engine.js';

/**
 * Manages the state of the generator, pattern, and mixer.
 * This acts as a bridge between the UI and the core generation engine.
 */
export class GeneratorController {
  constructor() {
    this.state = {
      seed: Date.now(),
      patternLength: 4,
      globalChaos: 0.5,
      trackControls: {
        kick: { density: 1, mutation: 0.2, velocitySpread: 0.1 },
        bass: { density: 0.95, mutation: 0.15, velocitySpread: 0.1 },
        snare: { density: 1, mutation: 0.4, velocitySpread: 0.1 },
        hats: { density: 1, mutation: 0.1, velocitySpread: 0.2 },
        fx: { density: 0.2, mutation: 0.5, velocitySpread: 0.1 },
      },
    };
    /** @type {import('./data-structures.js').Pattern | null} */
    this._currentPattern = null;

    /** @type {import('./mixer-structures.js').MixerState} */
    this.mixerState = {};
    this._initializeMixer();

    /** @type {Object.<string, import('./slicer-structures.js').SlicedAudio>} */
    this.slicedAudioCache = {};
  }

  _initializeMixer(trackNames = Object.keys(this.state.trackControls)) {
    for (const trackName of trackNames) {
        if (!this.mixerState[trackName]) {
            this.mixerState[trackName] = {
                volume: 0.8, pan: 0, solo: false, mute: false, insertFx: [],
            };
        }
    }
  }

  // --- Generator Controls ---
  randomizeSeed() { this.state.seed = Date.now(); }
  setSeed(seed) { this.state.seed = seed; }
  setPatternLength(lengthInBars) { this.state.patternLength = lengthInBars; }
  setGlobalChaos(value) { this.state.globalChaos = Math.max(0, Math.min(1, value)); }
  setTrackControl(track, control, value) {
    if (this.state.trackControls[track]?.[control] !== undefined) {
      this.state.trackControls[track][control] = value;
    }
  }

  // --- Pattern Generation & Manipulation ---
  generatePattern() {
    const generator = new Generator(this.state);
    this._currentPattern = generator.generate();
    return this._currentPattern;
  }

  getPattern() {
    if (!this._currentPattern) {
      this.generatePattern();
    }
    return this._currentPattern;
  }

  addNote(trackName, midiEvent) {
    if (this._currentPattern?.[trackName]) {
      this._currentPattern[trackName].push(midiEvent);
      this._currentPattern[trackName].sort((a, b) => a.tick - b.tick);
    }
  }

  removeNote(trackName, midiEventToRemove) {
    if (this._currentPattern?.[trackName]) {
      this._currentPattern[trackName] = this._currentPattern[trackName].filter(event =>
        !(event.tick === midiEventToRemove.tick && event.note === midiEventToRemove.note)
      );
    }
  }

  updateNote(trackName, oldMidiEvent, newMidiEvent) {
    if (this._currentPattern?.[trackName]) {
      const index = this._currentPattern[trackName].findIndex(event =>
        event.tick === oldMidiEvent.tick && event.note === oldMidiEvent.note
      );
      if (index !== -1) {
        this._currentPattern[trackName][index] = newMidiEvent;
        this._currentPattern[trackName].sort((a, b) => a.tick - b.tick);
      }
    }
  }

  // --- Mixer Controls ---
  getMixerState() { return this.mixerState; }
  setVolume(trackName, volume) { if (this.mixerState[trackName]) this.mixerState[trackName].volume = Math.max(0, Math.min(2, volume)); }
  setPan(trackName, pan) { if (this.mixerState[trackName]) this.mixerState[trackName].pan = Math.max(-1, Math.min(1, pan)); }
  setMute(trackName, isMuted) { if (this.mixerState[trackName]) this.mixerState[trackName].mute = isMuted; }
  setSolo(trackName, isSoloed) {
    if (this.mixerState[trackName]) {
      Object.keys(this.mixerState).forEach(key => { this.mixerState[key].solo = (key === trackName) ? isSoloed : false; });
    }
  }

  // --- Beat Slicer ---
  /**
   * Simulates slicing an audio file and generates a pattern from it.
   * @param {string} filePath - Path to the audio file.
   * @param {number} [numSlices=16] - How many slices to create.
   * @param {number} [audioDuration=4] - The simulated duration of the audio file in seconds.
   * @returns {import('./slicer-structures.js').SlicedAudio | null}
   */
  sliceAudioAndGeneratePattern(filePath, numSlices = 16, audioDuration = 4) {
    console.log(`Slicing ${filePath} into ${numSlices} slices.`);
    
    // 1. Simulate slicing
    const sliceDuration = audioDuration / numSlices;
    const slices = Array.from({ length: numSlices }, (_, i) => ({
      id: i,
      startTime: i * sliceDuration,
      endTime: (i + 1) * sliceDuration,
    }));

    const slicedAudio = {
      filePath,
      duration: audioDuration,
      slices,
    };
    this.slicedAudioCache[filePath] = slicedAudio;

    // 2. Create a new track for the slices
    const trackName = `slices_${path.basename(filePath, path.extname(filePath))}`;
    if (!this._currentPattern) this.generatePattern();
    this._currentPattern[trackName] = [];
    this._initializeMixer([trackName]); // Add to mixer

    // 3. Generate a MIDI pattern that plays the slices in order
    const baseNote = 36; // C1
    for (let i = 0; i < numSlices; i++) {
      if (i < this.state.patternLength * 16) { // Only add notes if they fit in the pattern
        this.addNote(trackName, {
          tick: i,
          note: baseNote + i, // Each slice gets a subsequent note
          velocity: 127,
          length: 1,
        });
      }
    }
    
    console.log(`Created new track "${trackName}" with a pattern for the slices.`);
    return slicedAudio;
  }
}

// Node.js path module might not be available in browser, so a simple polyfill
const path = {
    basename: (p, ext = '') => p.split(/[\\/]/).pop().replace(ext, ''),
    extname: (p) => {
        const name = p.split(/[\\/]/).pop();
        const dotIndex = name.lastIndexOf('.');
        return dotIndex > 0 ? name.substring(dotIndex) : '';
    }
};
