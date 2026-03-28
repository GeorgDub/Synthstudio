/**
 * smfParser.ts
 *
 * Standard MIDI File (SMF) Parser – pure TypeScript, reines Uint8Array.
 * Unterstützt Type 0 und Type 1, extrahiert GM-Drum-Noten (Channel 9).
 * Kein Node.js/Buffer-Abhängigkeit – läuft auch im Browser-Context.
 */

// ─── Öffentliche Typen ────────────────────────────────────────────────────────

export interface ParsedMidiNote {
  /** MIDI-Noten-Nummer (typischerweise 35–81 für GM-Drums) */
  note: number;
  /** Auf 16 Steps quantisierter Step-Index (0–15) */
  stepIndex: number;
  /** MIDI-Velocity (0–127) */
  velocity: number;
}

export interface ParsedMidiFile {
  /** Tempo in BPM aus Set-Tempo-Meta-Event; null wenn kein Tempo-Event vorhanden */
  bpm: number | null;
  /** Ticks pro Viertelrnote (PPQN) aus dem MIDI-Header */
  ticksPerQuarterNote: number;
  /** Maximaler Tick-Zeitstempel über alle Tracks */
  totalTicks: number;
  /** Alle gefundenen Drum-Noten (Channel 9, Note-On, Velocity > 0) */
  notes: ParsedMidiNote[];
  /** Anzahl erfolgreich geparster Tracks */
  trackCount: number;
}

// ─── Interne Helfer ───────────────────────────────────────────────────────────

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

function readUint16(data: Uint8Array, offset: number): number {
  return ((data[offset] << 8) | data[offset + 1]) & 0xffff;
}

/**
 * Dekodiert einen Variable-Length-Quantity-Wert (VLQ).
 * VLQ: jedes Byte enthält 7 Nutzbits; MSB=1 → weitere Bytes folgen.
 */
function readVlq(
  data: Uint8Array,
  offset: number,
): { value: number; bytesRead: number } {
  let value = 0;
  let bytesRead = 0;
  let b: number;
  do {
    if (bytesRead >= 4) {
      throw new Error("VLQ-Wert überschreitet maximale Länge von 4 Bytes");
    }
    b = data[offset + bytesRead];
    value = (value << 7) | (b & 0x7f);
    bytesRead++;
  } while (b & 0x80);
  return { value, bytesRead };
}

/**
 * Quantisiert einen absoluten Tick-Zeitstempel auf einen 16-Step-Index.
 * Formel: stepIndex = round((tick / tpq) × (16 / 4)) mod 16
 * → 4 Steps pro Viertelrnote, 16 Steps pro Takt (ein Takt = 4 Beats).
 */
function quantizeToStep(tick: number, ticksPerQuarterNote: number): number {
  return Math.round((tick / ticksPerQuarterNote) * 4) % 16;
}

// ─── Haupt-Parser ─────────────────────────────────────────────────────────────

/**
 * Parst eine SMF-Datei (Uint8Array) und gibt alle GM-Drum-Noten zurück.
 *
 * @throws Error wenn Magic-Bytes fehlen, Format nicht Type 0/1 ist,
 *               oder SMPTE-Zeitbasis erkannt wird.
 */
export function parseMidiFile(data: Uint8Array): ParsedMidiFile {
  // ── Header-Chunk validieren ──────────────────────────────────────────────
  if (
    data.length < 14 ||
    data[0] !== 0x4d ||
    data[1] !== 0x54 ||
    data[2] !== 0x68 ||
    data[3] !== 0x64
  ) {
    throw new Error(
      "Ungültige MIDI-Datei: MThd-Magic-Bytes fehlen oder Datei zu kurz",
    );
  }

  const headerLength = readUint32(data, 4);
  if (headerLength < 6) {
    throw new Error(
      "Ungültige MIDI-Datei: Header-Chunk-Länge kleiner als 6 Bytes",
    );
  }

  const format = readUint16(data, 8);
  if (format > 1) {
    throw new Error(
      `Nicht unterstütztes MIDI-Format: ${format}. Nur Type 0 und Type 1 werden unterstützt.`,
    );
  }

  const numTracks = readUint16(data, 10);
  const timeDivision = readUint16(data, 12);

  // SMPTE-Zeitbasis (MSB gesetzt) wird nicht unterstützt
  if (timeDivision & 0x8000) {
    throw new Error(
      "SMPTE-Zeitbasis wird nicht unterstützt; nur PPQN (Ticks/Quarternote)",
    );
  }
  if (timeDivision === 0) {
    throw new Error(
      "Ungültige MIDI-Datei: ticksPerQuarterNote ist 0",
    );
  }

  const ticksPerQuarterNote = timeDivision;

  // ── Tracks parsen ─────────────────────────────────────────────────────────
  let chunkOffset = 8 + headerLength; // Erste Position nach dem Header-Chunk
  let bpm: number | null = null;
  const notes: ParsedMidiNote[] = [];
  let totalTicks = 0;
  let parsedTracks = 0;

  while (chunkOffset + 8 <= data.length && parsedTracks < numTracks) {
    // MTrk-Magic prüfen
    if (
      data[chunkOffset] !== 0x4d ||
      data[chunkOffset + 1] !== 0x54 ||
      data[chunkOffset + 2] !== 0x72 ||
      data[chunkOffset + 3] !== 0x6b
    ) {
      // Unbekannter Chunk-Typ → überspringen
      const unknownLength = readUint32(data, chunkOffset + 4);
      chunkOffset += 8 + unknownLength;
      continue;
    }

    const trackLength = readUint32(data, chunkOffset + 4);
    const trackStart = chunkOffset + 8;
    const trackEnd = trackStart + trackLength;

    let pos = trackStart;
    let currentTick = 0;
    let runningStatus = 0;

    while (pos < trackEnd && pos < data.length) {
      // Delta-Zeit lesen
      const { value: delta, bytesRead: deltaBytes } = readVlq(data, pos);
      pos += deltaBytes;
      currentTick += delta;

      if (pos >= trackEnd) break;
      const firstByte = data[pos];

      if (firstByte === 0xff) {
        // ── Meta-Event ──────────────────────────────────────────────────────
        pos++; // 0xFF konsumieren
        const metaType = data[pos++];
        const { value: metaLength, bytesRead: metaLenBytes } = readVlq(
          data,
          pos,
        );
        pos += metaLenBytes;

        if (metaType === 0x51 && metaLength === 3 && pos + 2 < data.length) {
          // Set Tempo: 3 Bytes µs/Beat
          const microsPerBeat =
            (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
          if (microsPerBeat > 0) {
            bpm = Math.round(60_000_000 / microsPerBeat);
          }
        }

        pos += metaLength;
        // Meta-Events unterbrechen Running Status nicht im praktischen Einsatz,
        // aber per Spec sicherheitshalber beibehalten.
      } else if (firstByte === 0xf0 || firstByte === 0xf7) {
        // ── SysEx-Event ─────────────────────────────────────────────────────
        pos++;
        const { value: sysexLength, bytesRead: sysexLenBytes } = readVlq(
          data,
          pos,
        );
        pos += sysexLenBytes + sysexLength;
        runningStatus = 0;
      } else {
        // ── Channel-Message ──────────────────────────────────────────────────
        let status: number;

        if (firstByte & 0x80) {
          // Explizites Status-Byte
          status = firstByte;
          runningStatus = status;
          pos++;
        } else {
          // Running Status: firstByte ist bereits das erste Daten-Byte
          if (runningStatus === 0) {
            // Fehlerhafter Stream ohne Running Status → Byte überspringen
            pos++;
            continue;
          }
          status = runningStatus;
          // pos NICHT erhöhen – firstByte wird als d1 gelesen
        }

        const messageType = (status >> 4) & 0x0f;
        const channel = status & 0x0f;

        // Nachrichten mit zwei Daten-Bytes: Note Off (8), Note On (9),
        // Aftertouch (A), Control Change (B), Pitch Bend (E)
        if (
          messageType === 0x8 ||
          messageType === 0x9 ||
          messageType === 0xa ||
          messageType === 0xb ||
          messageType === 0xe
        ) {
          const d1 = data[pos++];
          const d2 = data[pos++];

          // Note-On auf Channel 9 (= MIDI-Channel 10, GM-Drum-Channel)
          // Velocity 0 gilt als Note-Off → ignorieren
          if (messageType === 0x9 && channel === 9 && d2 > 0) {
            const stepIndex = quantizeToStep(currentTick, ticksPerQuarterNote);
            notes.push({ note: d1, stepIndex, velocity: d2 });
          }
        } else if (messageType === 0xc || messageType === 0xd) {
          // Program Change (C), Channel Aftertouch (D): ein Daten-Byte
          pos++;
        }
        // System-Messages (0xF*) mit MSB gesetzt wurden bereits oben abgefangen
      }

      if (currentTick > totalTicks) {
        totalTicks = currentTick;
      }
    }

    chunkOffset = trackEnd;
    parsedTracks++;
  }

  return { bpm, ticksPerQuarterNote, totalTicks, notes, trackCount: parsedTracks };
}
