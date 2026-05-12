/**
 * @typedef {Object} MidiEvent
 * @property {number} tick - The position in the grid (e.g., 0-63 for a 4-bar loop).
 * @property {number} note - The MIDI note number (e.g., 60 for C4).
 * @property {number} velocity - The note velocity (0-127).
 * @property {number} length - The note length in ticks.
 */

/**
 * @typedef {Object.<string, MidiEvent[]>} MidiTrack
 *  A map where the key is the track name (e.g., "kick", "bass")
 *  and the value is an array of MidiEvents.
 */

/**
 * Represents the entire generated pattern.
 * @typedef {Object.<string, MidiTrack>} Pattern
 */
