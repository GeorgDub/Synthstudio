/**
 * A simple MIDI file parser.
 * This parser is not exhaustive but handles basic format 0 and 1 MIDI files
 * with noteOn and noteOff events.
 */

class MidiReader {
    constructor(data) {
        this.data = new Uint8Array(data);
        this.position = 0;
    }

    read(length) {
        const start = this.position;
        this.position += length;
        if (this.position > this.data.length) {
            throw new Error("Reading past end of buffer");
        }
        return this.data.slice(start, this.position);
    }

    readString(length) {
        return String.fromCharCode.apply(null, this.read(length));
    }

    readInt(length) {
        let value = 0;
        for (let i = 0; i < length; i++) {
            const byte = this.data[this.position++];
            if (byte === undefined) {
                throw new Error("Reading past end of buffer");
            }
            value = (value << 8) + byte;
        }
        return value;
    }

    readVarInt() {
        let value = 0;
        let byte;
        do {
            byte = this.readInt(1);
            value = (value << 7) + (byte & 0x7f);
        } while (byte & 0x80);
        return value;
    }
}

/**
 * Parses a MIDI file ArrayBuffer into a simplified structure.
 * @param {ArrayBuffer} arrayBuffer The MIDI file data.
 * @returns {{ticksPerQuarterNote: number, tracks: Array<Array<{type: string, deltaTime: number, channel: number, note?: number, velocity?: number}>>}}
 */
export function parseMidiFile(arrayBuffer) {
    const reader = new MidiReader(arrayBuffer);

    // Header
    const headerId = reader.readString(4);
    if (headerId !== 'MThd') throw new Error('Invalid MIDI file header');
    reader.readInt(4); // header length
    const format = reader.readInt(2);
    const numTracks = reader.readInt(2);
    const ticksPerQuarterNote = reader.readInt(2);

    const tracks = [];

    for (let i = 0; i < numTracks; i++) {
        const trackId = reader.readString(4);
        if (trackId !== 'MTrk') throw new Error(`Invalid MIDI track header for track ${i}`);
        const trackLength = reader.readInt(4);
        const trackEnd = reader.position + trackLength;
        
        const trackEvents = [];
        let lastEventType = 0;

        while (reader.position < trackEnd) {
            const deltaTime = reader.readVarInt();
            let eventType = reader.readInt(1);

            if (eventType === 0xff) { // Meta Event
                const metaType = reader.readInt(1);
                const metaLength = reader.readVarInt();
                if (metaType === 0x2F) { // End of Track
                    reader.position = trackEnd; // Jump to the end of the chunk
                    break; 
                }
                reader.read(metaLength); // Skip other meta events
                continue;
            }
            
            if (eventType === 0xf0 || eventType === 0xf7) { // Sysex
                const length = reader.readVarInt();
                reader.read(length);
                continue;
            }

            if ((eventType & 0x80) === 0) { // Running status
                eventType = lastEventType;
                reader.position--;
            }
            lastEventType = eventType;

            const event = {
                deltaTime,
                type: 'unknown',
                channel: eventType & 0x0f,
            };

            const eventCode = eventType >> 4;

            if (eventCode === 0x9) { // Note On
                event.type = 'noteOn';
                event.note = reader.readInt(1);
                event.velocity = reader.readInt(1);
                if (event.velocity === 0) {
                    event.type = 'noteOff';
                }
            } else if (eventCode === 0x8) { // Note Off
                event.type = 'noteOff';
                event.note = reader.readInt(1);
                event.velocity = reader.readInt(1);
            } else {
                // Skip other channel events like program change, control change etc.
                const paramsToSkip = [0, 0, 2, 2, 2, 1, 1, 2]; // for event codes 8-F
                reader.position += paramsToSkip[eventCode - 8] || 0;
                continue;
            }
            
            trackEvents.push(event);
        }
        tracks.push(trackEvents);
    }

    return { ticksPerQuarterNote, tracks };
}
