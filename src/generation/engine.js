import { PRNG } from './prng.js';

/**
 * The main generative engine.
 */
export class Generator {
  /**
   * @param {object} params
   * @param {number} params.seed - The master seed for the PRNG.
   * @param {number} [params.patternLength=4] - Pattern length in bars.
   * @param {number} [params.globalChaos=0] - Global chaos multiplier (0-1).
   * @param {object} [params.trackControls] - Per-track controls.
   */
  constructor({ seed, patternLength = 4, globalChaos = 0, trackControls = {} }) {
    this.seed = seed;
    this.patternLength = patternLength; // in bars
    this.globalChaos = globalChaos;
    this.prng = new PRNG(this.seed);

    this.controls = {
      kick: { density: 1, mutation: 0.2, velocitySpread: 0.1, ...trackControls.kick },
      bass: { density: 0.95, mutation: 0.15, velocitySpread: 0.1, ...trackControls.bass },
      snare: { density: 1, mutation: 0.4, velocitySpread: 0.1, ...trackControls.snare },
      hats: { density: 1, mutation: 0.1, velocitySpread: 0.2, ...trackControls.hats },
      fx: { density: 0.2, mutation: 0.5, velocitySpread: 0.1, ...trackControls.fx },
    };

    /** @type {import('./data-structures.js').Pattern} */
    this.pattern = {
      kick: [],
      bass: [],
      snare: [],
      hats: [],
      fx: [],
    };

    // State for interactions, e.g., muting hats during snare roll
    this.isSnareRollActive = false;
  }

  /**
   * Generates the full MIDI pattern based on the initial parameters.
   * @returns {import('./data-structures.js').Pattern}
   */
  generate() {
    const totalTicks = this.patternLength * 16;

    this.pattern = { kick: [], bass: [], snare: [], hats: [], fx: [] };
    this.prng = new PRNG(this.seed); // Reset PRNG for deterministic generation

    for (let tick = 0; tick < totalTicks; tick++) {
      const bar = Math.floor(tick / 16);
      const tickInBar = tick % 16;

      // Reset state at the beginning of each bar
      if (tickInBar === 0) {
        this.isSnareRollActive = false;
      }
      
      this.generateSnare(tick, bar, tickInBar); // Snare first to set state for hats
      this.generateKick(tick, bar, tickInBar);
      this.generateBass(tick, bar, tickInBar);
      this.generateHats(tick, bar, tickInBar);
      this.generateFX(tick, bar, tickInBar);
    }

    return this.pattern;
  }

  // --- Track Generation Logic ---

  generateKick(tick, bar, tickInBar) {
    const ctrl = this.controls.kick;
    // Core: 4-on-the-floor
    if (tickInBar % 4 === 0) {
      // Mutation: 20% chance to drop step 61 (Bar 4, step 13)
      if (tick === 60 && this.prng.chance(0.2 * ctrl.mutation)) {
        return;
      }
      this.addNote('kick', tick, 36, 127);
    }

    // Mutation: 5% chance for a 1/32 double-kick before the 1 of a new bar
    if (tickInBar === 15 && this.prng.chance(0.05 * ctrl.mutation)) {
        this.addNote('kick', tick + 0.5, 36, 100, 0.5); // 1/32 note
    }
  }

  generateBass(tick, bar, tickInBar) {
    const ctrl = this.controls.bass;
    // Core: 95% chance on offbeats
    if ((tickInBar + 2) % 4 === 0) {
      if (this.prng.chance(ctrl.density)) {
        // Mutation: Drop-out (15% chance)
        if (this.prng.chance(0.15 * ctrl.mutation)) {
          return;
        }

        // Mutation: Stutter (split into two 1/32 notes, esp. on step 15)
        const stutterChance = (tickInBar === 14 ? 0.3 : 0.1) * ctrl.mutation;
        if (this.prng.chance(stutterChance)) {
          this.addNote('bass', tick, 40, 110, 0.5);
          this.addNote('bass', tick + 0.5, 40, 90, 0.5);
          return;
        }

        // Mutation: Gallop (shift into two 1/16 notes)
        if (this.prng.chance(0.1 * ctrl.mutation)) {
          this.addNote('bass', tick, 40, 110, 0.5);
          this.addNote('bass', tick + 1, 40, 90, 0.5);
          return;
        }
        
        this.addNote('bass', tick, 40, 120);
      }
    }
  }

  generateSnare(tick, bar, tickInBar) {
    const ctrl = this.controls.snare;
    // Core: Steps 5 and 13 (ticks 4 and 12)
    if (tickInBar === 4 || tickInBar === 12) {
      this.addNote('snare', tick, 38, 120);
    }

    // Mutation: Snare roll in Bar 4 (40% chance)
    if (bar === 3 && !this.isSnareRollActive && this.prng.chance(ctrl.mutation)) {
      this.isSnareRollActive = true;
      const rollType = this.prng.nextInt(0, 2);
      if (rollType === 0) { // Rising 1/16 chain
        for (let i = 8; i < 16; i++) {
          this.addNote('snare', bar * 16 + i, 38, 80 + i * 3);
        }
      } else { // Fast 1/32 burst on last two beats
        for (let i = 12; i < 16; i += 0.5) {
          this.addNote('snare', bar * 16 + i, 38, 90 + i * 2, 0.5);
        }
      }
    }
  }

  generateHats(tick, bar, tickInBar) {
    if (this.isSnareRollActive) return; // Mute hats during snare roll

    const ctrl = this.controls.hats;
    // Core: Closed hats on all 16 steps
    this.addNote('hats', tick, 42, 80);

    // Core: Open hat/Ride on offbeats
    if ((tickInBar + 2) % 4 === 0) {
      this.addNote('hats', tick, 46, 90, 2); // Longer length for open hat
    }

    // Mutation: Reduce velocity on kick steps
    if (tickInBar % 4 === 0) {
      const hat = this.pattern.hats[this.pattern.hats.length - 1];
      if (hat && hat.tick === tick) {
        hat.velocity *= 0.4;
      }
    }
  }

  generateFX(tick, bar, tickInBar) {
    const ctrl = this.controls.fx;
    // Core: Pseudo-random placement
    // Bias: Prefer placement on step 8 or 16
    const biasChance = (tickInBar === 7 || tickInBar === 15) ? 0.3 : 0.05;
    if (this.prng.chance(biasChance * ctrl.density * this.globalChaos)) {
        this.addNote('fx', tick, 70, 100, 4);
    }
  }

  /**
   * Helper to add a note to the pattern.
   * @param {string} track
   * @param {number} tick
   * @param {number} note
   * @param {number} velocity
   * @param {number} [length=1]
   */
  addNote(track, tick, note, velocity, length = 1) {
      const ctrl = this.controls[track];
      const velSpread = ctrl.velocitySpread * this.globalChaos * 127;
      const finalVelocity = Math.max(0, Math.min(127, Math.round(velocity + this.prng.nextInt(-velSpread, velSpread))));

      this.pattern[track].push({
          tick,
          note,
          velocity: finalVelocity,
          length
      });
  }
}
