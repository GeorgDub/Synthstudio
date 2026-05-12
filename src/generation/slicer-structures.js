/**
 * @typedef {Object} AudioSlice
 * @property {number} id - The unique ID of the slice.
 * @property {number} startTime - The start time of the slice in seconds within the original audio file.
 * @property {number} endTime - The end time of the slice in seconds.
 */

/**
 * Represents an audio file that has been analyzed and sliced.
 * @typedef {Object} SlicedAudio
 * @property {string} filePath - The absolute path to the original audio file.
 * @property {number} duration - The total duration of the audio file in seconds.
 * @property {AudioSlice[]} slices - An array of detected audio slices.
 */
