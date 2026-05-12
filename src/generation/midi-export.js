// A simple library to write Standard MIDI Files (SMF)
// Based on the MIDI specification and examples.

const textEncoder = new TextEncoder();

function writeString(str) {
  return Array.from(textEncoder.encode(str));
}

function writeInt32(num) {
  return [(num >> 24) & 0xff, (num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

function writeInt16(num) {
  return [(num >> 8) & 0xff, num & 0xff];
}

// Variable-length quantity for delta-times
function writeVarInt(num) {
  let buffer = [];
  let value = num;
  buffer.push(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    buffer.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return buffer;
}

/**
 * Converts a generated pattern object into a Standard MIDI File (SMF) buffer.
 * Each track in the pattern is written to a separate MIDI channel.
 *
 * @param {import('./data-structures.js').Pattern} pattern
 * @param {number} [ticksPerQuarterNote=480] - The time resolution.
 * @returns {Uint8Array} A byte array representing the MIDI file.
 */
export function exportPatternToMidi(pattern, ticksPerQuarterNote = 480) {
  const trackNames = Object.keys(pattern);
  const numTracks = trackNames.length;
  const ticksPerBeat = 4; // Our generator works with 1/16th notes
  const tickConversionFactor = ticksPerQuarterNote / ticksPerBeat;

  const header = [
    ...writeString('MThd'),
    ...writeInt32(6), // Header length
    ...writeInt16(1), // Format 1 (multiple tracks)
    ...writeInt16(numTracks + 1), // Number of tracks (plus one for tempo)
    ...writeInt16(ticksPerQuarterNote),
  ];

  // --- Tempo Track ---
  const tempoTrack = [
    ...writeString('MTrk'),
    ...writeInt32(11), // Placeholder for length, will be updated
    ...writeVarInt(0), 0xff, 0x51, 0x03, ...writeInt32(500000).slice(1), // 120 BPM
    ...writeVarInt(0), 0xff, 0x2f, 0x00, // End of track
  ];
  tempoTrack.splice(4, 4, ...writeInt32(tempoTrack.length - 8));


  const midiTracks = trackNames.map((trackName, index) => {
    const events = pattern[trackName];
    events.sort((a, b) => a.tick - b.tick);

    let trackData = [];
    let lastTick = 0;

    for (const event of events) {
      const midiTick = Math.round(event.tick * tickConversionFactor);
      const delta = midiTick - lastTick;

      // Note On
      trackData.push(...writeVarInt(delta));
      trackData.push(0x90 | index); // Note On on channel `index`
      trackData.push(event.note);
      trackData.push(event.velocity);

      lastTick = midiTick;

      const noteLengthTicks = Math.round(event.length * tickConversionFactor);
      const noteOffDelta = noteLengthTicks;

      // Note Off
      trackData.push(...writeVarInt(noteOffDelta));
      trackData.push(0x80 | index); // Note Off on channel `index`
      trackData.push(event.note);
      trackData.push(0); // Velocity 0

      lastTick += noteOffDelta;
    }
    
    // End of track event
    trackData.push(...writeVarInt(0), 0xff, 0x2f, 0x00);

    const trackHeader = [
        ...writeString('MTrk'),
        ...writeInt32(trackData.length)
    ];

    return [...trackHeader, ...trackData];
  });

  const fileBytes = [
      ...header,
      ...tempoTrack,
      ...midiTracks.flat()
  ];

  return new Uint8Array(fileBytes);
}
