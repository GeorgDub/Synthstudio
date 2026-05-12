/**
 * @typedef {Object} FxSlot
 * @property {string | null} effectName - The name of the effect in the slot (e.g., 'reverb', 'delay').
 * @property {boolean} bypassed - Whether the effect is bypassed.
 * @property {Object.<string, number>} params - Effect-specific parameters.
 */

/**
 * Represents a single channel strip in the mixer.
 * @typedef {Object} MixerChannel
 * @property {number} volume - The channel volume, typically from 0 (silent) to 1 (unity gain).
 * @property {number} pan - The channel panning, from -1 (left) to 1 (right).
 * @property {boolean} solo - Whether the channel is soloed.
 * @property {boolean} mute - Whether the channel is muted.
 * @property {FxSlot[]} insertFx - An array of insert effects for the channel.
 */

/**
 * Represents the entire mixer state.
 * @typedef {Object.<string, MixerChannel>} MixerState
 *  A map where the key is the track name (e.g., "kick", "bass")
 *  and the value is the MixerChannel state.
 */
